import { createHash, createPublicKey, verify as cryptoVerify } from "node:crypto";
import {
  ProviderError,
  type ProviderJobStatus,
  type ProviderResult,
  type SubmitVideoInput,
  type VideoCapabilities,
  type VideoProvider,
} from "./types";

/**
 * Hedra adapter, written against the public v3 API documentation consulted
 * on 2026-10-08 (https://www.hedra.com/docs, see docs/provider-integration.md):
 *
 * - Auth: `Authorization: Key <key_id>:<secret>`
 * - Upload: `POST /v3/files` (multipart `file`) -> `{ url, content_type, expires_at }`,
 *   handle valid one hour, upload is free.
 * - Submit: `POST /v3/models/{model}` with `{ input, webhook?, idempotency_key? }`
 *   -> 202 `{ job_id, status, ... }`. Reusing `idempotency_key` returns the
 *   original acknowledgment instead of a duplicate job.
 * - Status: `GET /v3/jobs/{job_id}/status`; result: `GET /v3/jobs/{job_id}`
 *   (`outputs[].url` presigned and temporary, `cost` + `currency` when charged).
 *
 * Status: written and contract-tested with simulated responses only.
 * A real paid run is required to validate it ("à valider en réel").
 */

export interface HedraOptions {
  apiKey: string;
  modelId: string;
  baseUrl: string;
  maxOutputDurationMs: number;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

type HedraStatus = "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED";

interface HedraErrorEnvelope {
  code?: string;
  message?: string;
  retryable?: boolean;
  retry_after?: number | null;
}

const STATE_MAP: Record<HedraStatus, ProviderJobStatus["state"]> = {
  IN_QUEUE: "queued",
  IN_PROGRESS: "processing",
  COMPLETED: "completed",
  FAILED: "failed",
};

const DEFAULT_PROMPT = "A person speaking naturally to the camera, subtle head movement.";

export class HedraVideoProvider implements VideoProvider {
  readonly name = "hedra";
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: HedraOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  capabilities(): VideoCapabilities {
    return {
      provider: this.name,
      modelId: this.options.modelId,
      // Documented enum also includes 4:3, 3:4, 9:21, 21:9: not exposed in V1.
      aspectRatios: ["16:9", "9:16", "1:1"],
      resolutions: ["540p", "720p", "1080p"],
      image: { mimeTypes: ["image/jpeg", "image/png", "image/webp"], maxBytes: 10 * 1024 * 1024 },
      audio: {
        mimeTypes: ["audio/mpeg", "audio/wav"],
        maxBytes: 25 * 1024 * 1024,
        minDurationMs: 500,
        maxDurationMs: Math.min(600_000, this.options.maxOutputDurationMs),
      },
      maxOutputDurationMs: Math.min(600_000, this.options.maxOutputDurationMs),
      supportsCancel: false,
      reportsProgress: true,
      supportsIdempotencyKey: true,
    };
  }

  private url(path: string): string {
    return `${this.options.baseUrl.replace(/\/$/, "")}${path}`;
  }

  private async request(path: string, init: RequestInit & { phase: "submit" | "read" }): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(this.url(path), {
        ...init,
        headers: {
          Authorization: `Key ${this.options.apiKey}`,
          Accept: "application/json",
          ...(init.headers ?? {}),
        },
        signal: controller.signal,
        redirect: "error",
      });
    } catch (error) {
      // Network error or timeout: for a submit we cannot know whether the job
      // was created, so the caller must reconcile instead of retrying blindly.
      const aborted = error instanceof Error && error.name === "AbortError";
      throw new ProviderError(
        aborted ? "provider_timeout" : "provider_network_error",
        aborted ? "Délai dépassé chez le fournisseur." : "Fournisseur injoignable.",
        init.phase === "submit" ? "unknown" : "retryable",
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async toProviderError(res: Response, phase: "submit" | "read"): Promise<ProviderError> {
    let envelope: HedraErrorEnvelope = {};
    try {
      const body = (await res.json()) as { error?: HedraErrorEnvelope };
      envelope = body.error ?? {};
    } catch {
      // ignore unparsable bodies; never log them (may echo inputs)
    }
    const code = `hedra_${(envelope.code ?? String(res.status)).toLowerCase()}`;
    const retryAfter = Number(res.headers.get("retry-after")) || envelope.retry_after || undefined;
    if (res.status === 429 || res.status >= 500) {
      // A 5xx on submit may still have created a job.
      const outcome = phase === "submit" && res.status >= 500 ? "unknown" : "retryable";
      return new ProviderError(code, "Le fournisseur est temporairement indisponible.", outcome, retryAfter);
    }
    const messages: Record<number, string> = {
      400: "Entrée refusée par le fournisseur.",
      401: "Clé API du fournisseur invalide.",
      402: "Solde du compte fournisseur insuffisant.",
      403: "Accès refusé par le fournisseur.",
      404: "Modèle ou tâche introuvable chez le fournisseur.",
      422: "Contenu refusé par la modération du fournisseur.",
    };
    return new ProviderError(code, messages[res.status] ?? "Erreur du fournisseur.", "rejected");
  }

  /** Uploads bytes to Hedra and returns the one-hour file handle URL. */
  private async uploadFile(bytes: Uint8Array, mimeType: string, filename: string): Promise<string> {
    const form = new FormData();
    form.append("file", new Blob([bytes as BlobPart], { type: mimeType }), filename);
    const res = await this.request("/files", { method: "POST", body: form, phase: "read" });
    if (!res.ok) throw await this.toProviderError(res, "read");
    const body = (await res.json()) as { url?: string };
    if (!body.url) throw new ProviderError("hedra_bad_upload_response", "Réponse d'upload inattendue.", "retryable");
    return body.url;
  }

  private async buildBody(input: SubmitVideoInput) {
    const [imageBytes, audioBytes] = await Promise.all([input.image.load(), input.audio.load()]);
    const [imageUrl, audioUrl] = await Promise.all([
      this.uploadFile(imageBytes, input.image.mimeType, "image"),
      this.uploadFile(audioBytes, input.audio.mimeType, "audio"),
    ]);
    return {
      input: {
        // Hedra requires a prompt; keep a neutral one when the user leaves it empty.
        prompt: input.prompt.trim() || DEFAULT_PROMPT,
        aspect_ratio: input.aspectRatio,
        resolution: input.resolution,
        duration_ms: input.durationMs,
        start_image: { source: "url", url: imageUrl },
        audio: { source: "url", url: audioUrl },
      },
      ...(input.webhookUrl ? { webhook: input.webhookUrl } : {}),
      idempotency_key: input.idempotencyKey,
    };
  }

  async submit(input: SubmitVideoInput): Promise<{ providerJobId: string }> {
    // Uploads are free and safe to retry; only the POST below is billable.
    const body = await this.buildBody(input);
    const res = await this.request(`/models/${encodeURIComponent(this.options.modelId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      phase: "submit",
    });
    if (!res.ok) throw await this.toProviderError(res, "submit");
    const ack = (await res.json().catch(() => ({}))) as { job_id?: string };
    if (!ack.job_id) {
      throw new ProviderError("hedra_missing_job_id", "Accusé de réception sans identifiant.", "unknown");
    }
    return { providerJobId: ack.job_id };
  }

  /**
   * Hedra documents that re-sending the same `idempotency_key` returns the
   * original acknowledgment rather than queuing a duplicate job.
   */
  async findByIdempotencyKey(_key: string, input: SubmitVideoInput): Promise<{ providerJobId: string } | null> {
    try {
      return await this.submit(input);
    } catch (error) {
      if (error instanceof ProviderError && error.outcome !== "rejected") return null;
      throw error;
    }
  }

  async getStatus(providerJobId: string): Promise<ProviderJobStatus> {
    const res = await this.request(`/jobs/${encodeURIComponent(providerJobId)}/status`, { method: "GET", phase: "read" });
    if (!res.ok) throw await this.toProviderError(res, "read");
    const body = (await res.json()) as { status?: HedraStatus; progress?: unknown; error?: HedraErrorEnvelope | null };
    const state = body.status ? STATE_MAP[body.status] : undefined;
    if (!state) throw new ProviderError("hedra_unknown_status", "Statut fournisseur inconnu.", "retryable");
    const progress = typeof body.progress === "number" && body.progress >= 0 && body.progress <= 1 ? body.progress : undefined;
    return {
      state,
      progress,
      errorCode: body.error?.code ? `hedra_${body.error.code.toLowerCase()}` : undefined,
      errorMessage: body.error?.message,
      retryable: body.error?.retryable,
    };
  }

  async getResult(providerJobId: string): Promise<ProviderResult> {
    const res = await this.request(`/jobs/${encodeURIComponent(providerJobId)}`, { method: "GET", phase: "read" });
    if (!res.ok) throw await this.toProviderError(res, "read");
    const body = (await res.json()) as {
      status?: HedraStatus;
      outputs?: Array<{
        status?: string;
        url?: string | null;
        content_type?: string | null;
        duration_ms?: number | null;
        width?: number | null;
        height?: number | null;
      }>;
      cost?: number | null;
      currency?: string | null;
    };
    const output = body.outputs?.find((o) => (o.status ?? "COMPLETED") === "COMPLETED" && o.url);
    if (body.status !== "COMPLETED" || !output?.url) {
      const expired = body.outputs?.some((o) => o.status === "EXPIRED");
      throw new ProviderError(
        expired ? "hedra_output_expired" : "hedra_result_unavailable",
        expired ? "Le résultat a expiré chez le fournisseur." : "Résultat pas encore disponible.",
        expired ? "rejected" : "retryable",
      );
    }
    return {
      url: output.url,
      contentType: output.content_type ?? null,
      durationMs: output.duration_ms ?? null,
      width: output.width ?? null,
      height: output.height ?? null,
      actualCostMinor: typeof body.cost === "number" ? Math.round(body.cost * 100) : null,
      currency: body.currency ?? null,
    };
  }
}

/**
 * Verifies a Hedra webhook (ed25519 over five newline-separated fields:
 * timestamp, webhook id, event, redelivery flag, sha256(raw body) hex).
 * The public key comes from `GET /v3/webhooks/public-key`; its exact encoding
 * must be confirmed with a real delivery (PEM or base64/hex raw key accepted).
 */
export function verifyHedraWebhook(params: {
  rawBody: string;
  headers: Headers;
  publicKey: string;
  nowMs?: number;
  toleranceMs?: number;
}): { webhookId: string; event: string; redelivery: boolean } {
  const h = params.headers;
  const signature = h.get("x-hedra-webhook-signature");
  const webhookId = h.get("x-hedra-webhook-id");
  const timestamp = h.get("x-hedra-webhook-timestamp");
  const event = h.get("x-hedra-webhook-event");
  const redelivery = h.get("x-hedra-webhook-redelivery") ?? "false";
  if (!signature || !webhookId || !timestamp || !event) throw new Error("missing_signature_headers");

  const tsNumber = Number(timestamp);
  const tsMs = Number.isFinite(tsNumber) ? (tsNumber < 1e12 ? tsNumber * 1000 : tsNumber) : Date.parse(timestamp);
  const now = params.nowMs ?? Date.now();
  if (!Number.isFinite(tsMs) || Math.abs(now - tsMs) > (params.toleranceMs ?? 5 * 60_000)) {
    throw new Error("stale_timestamp");
  }

  const bodyHash = createHash("sha256").update(params.rawBody, "utf8").digest("hex");
  const canonical = [timestamp, webhookId, event, redelivery, bodyHash].join("\n");
  const key = toEd25519Key(params.publicKey);
  const ok = cryptoVerify(null, Buffer.from(canonical, "utf8"), key, Buffer.from(signature, "hex"));
  if (!ok) throw new Error("invalid_signature");
  return { webhookId, event, redelivery: redelivery === "true" };
}

function toEd25519Key(publicKey: string) {
  const trimmed = publicKey.trim();
  if (trimmed.includes("BEGIN PUBLIC KEY")) return createPublicKey(trimmed);
  const raw = /^[0-9a-f]{64}$/i.test(trimmed) ? Buffer.from(trimmed, "hex") : Buffer.from(trimmed, "base64");
  if (raw.length !== 32) throw new Error("unsupported_public_key_format");
  // SPKI DER prefix for ed25519 raw public keys.
  const der = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw]);
  return createPublicKey({ key: der, format: "der", type: "spki" });
}
