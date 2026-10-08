import { generateKeyPairSync, sign as edSign, createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { HedraVideoProvider, verifyHedraWebhook } from "@/lib/providers/hedra";
import { ProviderError, type SubmitVideoInput } from "@/lib/providers/types";

/** Contract tests against anonymised responses shaped like the v3 docs. */

type Call = { url: string; init: RequestInit };

function fakeFetch(responses: Array<(call: Call) => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    const call = { url: String(url), init };
    calls.push(call);
    const next = responses.shift();
    if (!next) throw new Error("unexpected call");
    return next(call);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const input: SubmitVideoInput = {
  generationId: "g1",
  idempotencyKey: "animation-studio:g1",
  prompt: "A person speaking",
  aspectRatio: "9:16",
  resolution: "720p",
  durationMs: 12_000,
  image: { url: "memory://img", mimeType: "image/png", load: async () => new Uint8Array([1]) },
  audio: { url: "memory://aud", mimeType: "audio/wav", load: async () => new Uint8Array([2]) },
};

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function provider(fetchImpl: typeof fetch) {
  return new HedraVideoProvider({ apiKey: "kid:secret", modelId: "hedra-character-3", baseUrl: "https://api.hedra.com/v3", maxOutputDurationMs: 30_000, fetchImpl });
}

describe("Hedra adapter (contract)", () => {
  it("uploads files then submits with documented fields and idempotency key", async () => {
    const { impl, calls } = fakeFetch([
      () => json(201, { url: "https://files.hedra.example/img?sig=1", content_type: "image/png", expires_at: "2026-10-08T05:00:00Z" }),
      () => json(201, { url: "https://files.hedra.example/aud?sig=2", content_type: "audio/wav", expires_at: "2026-10-08T05:00:00Z" }),
      () => json(202, { job_id: "job_abc", model: "hedra-character-3", status: "IN_QUEUE", status_url: "/v3/jobs/job_abc/status", result_url: "/v3/jobs/job_abc" }),
    ]);
    const res = await provider(impl).submit(input);
    expect(res.providerJobId).toBe("job_abc");
    expect(calls[0].url).toBe("https://api.hedra.com/v3/files");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Key kid:secret");
    expect(calls[2].url).toBe("https://api.hedra.com/v3/models/hedra-character-3");
    const body = JSON.parse(String(calls[2].init.body));
    expect(body).toEqual({
      input: {
        prompt: "A person speaking",
        aspect_ratio: "9:16",
        resolution: "720p",
        duration_ms: 12000,
        start_image: { source: "url", url: "https://files.hedra.example/img?sig=1" },
        audio: { source: "url", url: "https://files.hedra.example/aud?sig=2" },
      },
      idempotency_key: "animation-studio:g1",
    });
  });

  it("maps a submit 5xx to an unknown outcome (reconcile, do not resubmit)", async () => {
    const { impl } = fakeFetch([
      () => json(201, { url: "https://f/1" }),
      () => json(201, { url: "https://f/2" }),
      () => json(500, { error: { code: "INTERNAL", message: "x" } }),
    ]);
    await expect(provider(impl).submit(input)).rejects.toMatchObject({ outcome: "unknown" });
  });

  it("maps 402, 422 and 429 correctly", async () => {
    for (const [status, outcome] of [[402, "rejected"], [422, "rejected"], [429, "retryable"]] as const) {
      const { impl } = fakeFetch([() => json(201, { url: "https://f/1" }), () => json(201, { url: "https://f/2" }), () => json(status, { error: { code: "X" } }, { "retry-after": "7" })]);
      const err = (await provider(impl).submit(input).catch((e) => e)) as ProviderError;
      expect(err).toBeInstanceOf(ProviderError);
      expect(err.outcome).toBe(outcome);
    }
  });

  it("reads status, real progress and results with cost", async () => {
    const { impl } = fakeFetch([
      () => json(200, { status: "IN_PROGRESS", progress: 0.4, estimated_completion_at: null }),
      () =>
        json(200, {
          job_id: "job_abc",
          model: "hedra-character-3",
          status: "COMPLETED",
          outputs: [{ status: "COMPLETED", url: "https://cdn.hedra.example/out.mp4?X-Amz-Signature=1", content_type: "video/mp4", width: 720, height: 1280, duration_ms: 12000 }],
          cost: 0.6,
          currency: "USD",
        }),
    ]);
    const p = provider(impl);
    expect(await p.getStatus("job_abc")).toEqual({ state: "processing", progress: 0.4, errorCode: undefined, errorMessage: undefined, retryable: undefined });
    expect(await p.getResult("job_abc")).toMatchObject({ contentType: "video/mp4", durationMs: 12000, actualCostMinor: 60, currency: "USD" });
  });

  it("treats an expired output as non-retryable", async () => {
    const { impl } = fakeFetch([() => json(200, { status: "COMPLETED", outputs: [{ status: "EXPIRED", url: null }] })]);
    await expect(provider(impl).getResult("job_x")).rejects.toMatchObject({ code: "hedra_output_expired", outcome: "rejected" });
  });

  it("verifies ed25519 webhook signatures over the canonical string", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const body = JSON.stringify({ job_id: "job_abc", status: "COMPLETED" });
    const ts = String(Math.floor(Date.now() / 1000));
    const canonical = [ts, "job_abc", "job.completed", "false", createHash("sha256").update(body).digest("hex")].join("\n");
    const signature = edSign(null, Buffer.from(canonical), privateKey).toString("hex");
    const headers = new Headers({
      "x-hedra-webhook-signature": signature,
      "x-hedra-webhook-id": "job_abc",
      "x-hedra-webhook-timestamp": ts,
      "x-hedra-webhook-event": "job.completed",
      "x-hedra-webhook-redelivery": "false",
    });
    expect(verifyHedraWebhook({ rawBody: body, headers, publicKey: pem })).toMatchObject({ webhookId: "job_abc" });
    expect(() => verifyHedraWebhook({ rawBody: body + " ", headers, publicKey: pem })).toThrow(/invalid_signature/);
    expect(() => verifyHedraWebhook({ rawBody: body, headers, publicKey: pem, nowMs: Date.now() + 10 * 60_000 })).toThrow(/stale/);
  });
});
