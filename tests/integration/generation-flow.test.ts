import { describe, expect, it } from "vitest";
import { drainOutbox, reconcile, reconcileOne } from "@/lib/generation/dispatcher";
import { estimateGeneration, launchGeneration, cancelGeneration } from "@/lib/generation/service";
import { advanceGeneration, outputStoragePath, runGeneration } from "@/lib/generation/worker";
import { makeServices, seedUser } from "../helpers/services";

const fastSleep = async () => undefined;

async function launch(ctx: Awaited<ReturnType<typeof setup>>, submissionId = crypto.randomUUID()) {
  const options = {
    projectId: ctx.seed.project.id,
    imageAssetId: ctx.seed.image.id,
    audioAssetId: ctx.seed.audio.id,
    prompt: "",
    aspectRatio: "16:9" as const,
    resolution: "720p" as const,
  };
  const { estimate } = await estimateGeneration(ctx.services, ctx.seed.user, options);
  return launchGeneration(ctx.services, ctx.seed.user, { ...options, quoteId: estimate.quoteId, submissionId });
}

async function setup(credits = 100, overrides: Record<string, string> = {}) {
  const ctx = makeServices(overrides);
  const seed = await seedUser(ctx.services, credits);
  return { ...ctx, seed };
}

describe("launch and credits", () => {
  it("two identical submissions create one generation and one reservation", async () => {
    const ctx = await setup();
    const id = crypto.randomUUID();
    const [a, b] = await Promise.all([launch(ctx, id), launch(ctx, id)]);
    expect(a.generation.id).toBe(b.generation.id);
    expect([a.created, b.created].sort()).toEqual([false, true]);
    const ledger = await ctx.store.listLedger(ctx.seed.userId, 50);
    expect(ledger.filter((l) => l.eventType === "reserve")).toHaveLength(1);
    const acc = await ctx.store.getCreditAccount(ctx.seed.userId);
    expect(acc).toMatchObject({ availableCredits: 95, reservedCredits: 5 });
  });

  it("concurrent submissions exceeding the balance: only one is accepted", async () => {
    const ctx = await setup(5, { MAX_CONCURRENT_JOBS_PER_USER: "5" });
    const results = await Promise.allSettled([launch(ctx), launch(ctx), launch(ctx)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(rejected.every((r) => r.reason.code === "insufficient_credits")).toBe(true);
    expect(await ctx.store.getCreditAccount(ctx.seed.userId)).toMatchObject({ availableCredits: 0, reservedCredits: 5 });
  });

  it("enforces the per-user concurrency limit and the daily provider budget", async () => {
    const ctx = await setup(100);
    await launch(ctx);
    await expect(launch(ctx)).rejects.toMatchObject({ code: "too_many_active_jobs" });

    const budget = await setup(100, { DAILY_PROVIDER_BUDGET_MINOR: "10" });
    await expect(launch(budget)).rejects.toMatchObject({ code: "daily_budget_exceeded" });
  });

  it("refuses a launch whose quote no longer matches the price", async () => {
    const ctx = await setup();
    await expect(
      launchGeneration(ctx.services, ctx.seed.user, {
        projectId: ctx.seed.project.id,
        imageAssetId: ctx.seed.image.id,
        audioAssetId: ctx.seed.audio.id,
        prompt: "",
        aspectRatio: "16:9",
        resolution: "720p",
        quoteId: "stale-quote",
        submissionId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "quote_changed" });
    expect(await ctx.store.getCreditAccount(ctx.seed.userId)).toMatchObject({ availableCredits: 100, reservedCredits: 0 });
  });

  it("refuses options the engine does not support and assets of another user", async () => {
    const ctx = await setup();
    const other = await seedUser(ctx.services, 0);
    await expect(
      estimateGeneration(ctx.services, ctx.seed.user, {
        projectId: ctx.seed.project.id,
        imageAssetId: ctx.seed.image.id,
        audioAssetId: ctx.seed.audio.id,
        prompt: "",
        aspectRatio: "16:9",
        resolution: "1080p",
      }),
    ).rejects.toMatchObject({ code: "unsupported_option" });
    await expect(
      estimateGeneration(ctx.services, ctx.seed.user, {
        projectId: ctx.seed.project.id,
        imageAssetId: other.image.id,
        audioAssetId: ctx.seed.audio.id,
        prompt: "",
        aspectRatio: "16:9",
        resolution: "720p",
      }),
    ).rejects.toMatchObject({ code: "invalid_image" });
  });
});

describe("worker", () => {
  it("happy path: submit once, store the MP4 privately, consume the reserve once", async () => {
    const ctx = await setup();
    const { generation } = await launch(ctx);
    const done = await runGeneration(ctx.services, generation.id, { sleep: fastSleep });
    expect(done?.status).toBe("succeeded");
    expect(ctx.video.submits).toBe(1);
    expect(ctx.storage.objects.has(outputStoragePath(generation))).toBe(true);
    const output = await ctx.store.getAssetById(done!.outputAssetId!);
    expect(output).toMatchObject({ status: "ready", mimeType: "video/mp4", kind: "video" });
    expect(await ctx.store.getCreditAccount(ctx.seed.userId)).toMatchObject({ availableCredits: 95, reservedCredits: 0 });
    expect(done?.actualCostMinor).toBe(150);
    const budget = await ctx.store.getBudgetDay(new Date().toISOString().slice(0, 10));
    expect(budget).toMatchObject({ reservedMinor: 0, spentMinor: 150 });
  });

  it("success or failure received twice settles only once", async () => {
    const ctx = await setup();
    const { generation } = await launch(ctx);
    await runGeneration(ctx.services, generation.id, { sleep: fastSleep });
    const g = await ctx.store.getGenerationById(generation.id);
    await ctx.store.completeGeneration(generation.id, g!.outputAssetId!, 150);
    await ctx.store.failGeneration(generation.id, { status: "failed", errorCode: "late", errorMessage: "late", providerCostMinor: null });
    const ledger = await ctx.store.listLedger(ctx.seed.userId, 50);
    expect(ledger.filter((l) => l.eventType === "consume")).toHaveLength(1);
    expect(ledger.filter((l) => l.eventType === "release")).toHaveLength(0);
    expect((await ctx.store.getGenerationById(generation.id))?.status).toBe("succeeded");

    const ctx2 = await setup();
    const { generation: g2 } = await launch(ctx2);
    ctx2.video.statusSequence = ["failed"];
    await runGeneration(ctx2.services, g2.id, { sleep: fastSleep });
    await ctx2.store.failGeneration(g2.id, { status: "failed", errorCode: "dup", errorMessage: "dup", providerCostMinor: null });
    const ledger2 = await ctx2.store.listLedger(ctx2.seed.userId, 50);
    expect(ledger2.filter((l) => l.eventType === "release")).toHaveLength(1);
    expect(await ctx2.store.getCreditAccount(ctx2.seed.userId)).toMatchObject({ availableCredits: 100, reservedCredits: 0 });
  });

  it("submit timeout goes to reconciliation without a blind resubmit", async () => {
    const ctx = await setup();
    ctx.video.idempotent = false;
    ctx.video.submitBehavior = ["timeout"];
    const { generation } = await launch(ctx);
    const g = await runGeneration(ctx.services, generation.id, { sleep: fastSleep });
    expect(g?.status).toBe("needs_reconciliation");
    expect(ctx.video.submits).toBe(1);
    // Credits stay reserved (no refund that could be followed by a late success).
    expect(await ctx.store.getCreditAccount(ctx.seed.userId)).toMatchObject({ availableCredits: 95, reservedCredits: 5 });
    // Another worker pass does not resubmit.
    await advanceGeneration(ctx.services, generation.id);
    expect(ctx.video.submits).toBe(1);
  });

  it("reconciliation finds the job through documented idempotency and resumes", async () => {
    const ctx = await setup();
    ctx.video.submitBehavior = ["timeout"];
    const { generation } = await launch(ctx);
    await runGeneration(ctx.services, generation.id, { sleep: fastSleep });
    expect(await reconcileOne(ctx.services, generation.id)).toBe(true);
    const g = await runGeneration(ctx.services, generation.id, { sleep: fastSleep });
    expect(g?.status).toBe("succeeded");
    expect(new Set(ctx.video.jobs.values()).size).toBe(1);
  });

  it("crash between the reservation transaction and dispatch is recovered from the outbox", async () => {
    const ctx = await setup();
    ctx.dispatcher.fail = true;
    const { generation } = await launch(ctx);
    expect(ctx.dispatcher.dispatched).toHaveLength(0);
    ctx.dispatcher.fail = false;
    // Lease expires after 60 s; simulate time passing by draining with a future clock.
    const items = await ctx.store.claimOutbox(new Date(Date.now() + 15 * 60_000).toISOString(), 10);
    expect(items.map((i) => i.generationId)).toContain(generation.id);
    for (const item of items) {
      await ctx.services.dispatcher.dispatch(item.generationId);
      await ctx.store.markOutboxDispatched(item.id);
    }
    expect(ctx.dispatcher.dispatched).toContain(generation.id);
    expect(await drainOutbox(ctx.services)).toBe(0);
  });

  it("crash after saving the result but before the ledger resumes idempotently", async () => {
    const ctx = await setup();
    const { generation } = await launch(ctx);
    // Run until storing, then save the object + asset as if the worker died before settling.
    let g = await advanceGeneration(ctx.services, generation.id); // submit -> processing
    g = await advanceGeneration(ctx.services, generation.id); // processing (still)
    g = await advanceGeneration(ctx.services, generation.id); // completed -> storing
    expect(g?.status).toBe("storing");
    const path = outputStoragePath(generation);
    ctx.storage.objects.set(path, new Uint8Array([0]));
    const asset = await ctx.store.createAsset({ ownerId: generation.ownerId, projectId: generation.projectId, kind: "video", bucket: "test", storagePath: path, mimeType: "video/mp4" });
    await ctx.store.updateAsset(asset.id, { status: "ready" });
    const done = await advanceGeneration(ctx.services, generation.id);
    expect(done?.status).toBe("succeeded");
    expect(done?.outputAssetId).toBe(asset.id);
    expect(ctx.video.getResultCalls).toBe(0);
    expect((await ctx.store.listLedger(ctx.seed.userId, 50)).filter((l) => l.eventType === "consume")).toHaveLength(1);
  });

  it("a failed transfer is retried without a new generation cost", async () => {
    const ctx = await setup();
    ctx.storage.putFailures = 2;
    const { generation } = await launch(ctx);
    const g = await runGeneration(ctx.services, generation.id, { sleep: fastSleep });
    expect(g?.status).toBe("succeeded");
    expect(ctx.video.submits).toBe(1);
    expect(ctx.video.getResultCalls).toBe(3);
  });

  it("provider refusal releases the credits once", async () => {
    const ctx = await setup();
    ctx.video.submitBehavior = ["reject"];
    const { generation } = await launch(ctx);
    const g = await runGeneration(ctx.services, generation.id, { sleep: fastSleep });
    expect(g).toMatchObject({ status: "failed", errorCode: "fake_rejected" });
    expect(await ctx.store.getCreditAccount(ctx.seed.userId)).toMatchObject({ availableCredits: 100, reservedCredits: 0 });
  });

  it("rate-limited submit is retried (nothing was created) and still submits once", async () => {
    const ctx = await setup();
    ctx.video.idempotent = false;
    ctx.video.submitBehavior = ["retryable", "ok"];
    const { generation } = await launch(ctx);
    const g = await runGeneration(ctx.services, generation.id, { sleep: fastSleep });
    expect(g?.status).toBe("succeeded");
    expect(ctx.video.submits).toBe(1);
  });

  it("cancel is only possible before the provider job exists", async () => {
    const ctx = await setup();
    const { generation } = await launch(ctx);
    const canceled = await cancelGeneration(ctx.services, ctx.seed.user, generation.id);
    expect(canceled.status).toBe("canceled");
    expect(await ctx.store.getCreditAccount(ctx.seed.userId)).toMatchObject({ availableCredits: 100, reservedCredits: 0 });

    const ctx2 = await setup();
    const { generation: g2 } = await launch(ctx2);
    await advanceGeneration(ctx2.services, g2.id);
    await expect(cancelGeneration(ctx2.services, ctx2.seed.user, g2.id)).rejects.toMatchObject({ code: "cannot_cancel" });
  });

  it("reconcile() re-dispatches stale workers", async () => {
    const ctx = await setup();
    const { generation } = await launch(ctx);
    await ctx.store.transitionGeneration(generation.id, ["queued"], "submitting", { nextCheckAt: new Date(Date.now() - 10 * 60_000).toISOString() });
    ctx.dispatcher.dispatched = [];
    const r = await reconcile(ctx.services);
    expect(r.stale).toBe(1);
    expect(ctx.dispatcher.dispatched).toContain(generation.id);
  });
});
