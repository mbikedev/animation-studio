import type { Services } from "@/lib/container";
import { logger } from "@/lib/logger";
import { backoffMs, buildSubmitInput, LIMITS, runGeneration } from "./worker";
import { isTerminal } from "./state-machine";

/**
 * Hands generations to background execution. The database outbox is the
 * source of truth: a crash between the reservation transaction and the
 * dispatch is recovered by `drainOutbox` (called after each launch and by
 * the scheduled reconciliation).
 */
export interface Dispatcher {
  readonly kind: "in-process" | "trigger";
  dispatch(generationId: string): Promise<void>;
}

/** Demo / local: runs the worker loop inside the web process. */
export class InProcessDispatcher implements Dispatcher {
  readonly kind = "in-process" as const;
  private readonly running = new Set<string>();

  constructor(private readonly services: Omit<Services, "dispatcher">) {}

  async dispatch(generationId: string): Promise<void> {
    if (this.running.has(generationId)) return;
    this.running.add(generationId);
    void runGeneration({ ...this.services, dispatcher: this }, generationId)
      .catch((error) => logger.error("worker.crashed", { generationId, error }))
      .finally(() => this.running.delete(generationId));
  }
}

/** Live: triggers the Trigger.dev task `process-generation`. */
export class TriggerDispatcher implements Dispatcher {
  readonly kind = "trigger" as const;

  async dispatch(generationId: string): Promise<void> {
    const { tasks } = await import("@trigger.dev/sdk");
    await tasks.trigger(
      "process-generation",
      { generationId },
      // Trigger.dev deduplicates by idempotency key: one run per generation dispatch.
      { idempotencyKey: `process-generation:${generationId}`, idempotencyKeyTTL: "1h" },
    );
  }
}

export function createDispatcher(services: Omit<Services, "dispatcher">): Dispatcher {
  if (services.config.mode === "demo") return new InProcessDispatcher(services);
  return new TriggerDispatcher();
}

export async function drainOutbox(services: Services, limit = 20): Promise<number> {
  const items = await services.store.claimOutbox(new Date().toISOString(), limit);
  let dispatched = 0;
  for (const item of items) {
    try {
      await services.dispatcher.dispatch(item.generationId);
      await services.store.markOutboxDispatched(item.id);
      dispatched++;
    } catch (error) {
      logger.error("outbox.dispatch_failed", { outboxId: item.id, attempts: item.attempts, error });
      await services.store.markOutboxFailed(item.id, new Date(Date.now() + backoffMs(item.attempts, 10_000, 15 * 60_000)).toISOString());
    }
  }
  return dispatched;
}

/**
 * Scheduled safety net:
 * 1. dispatches outbox rows that never made it to a worker;
 * 2. re-dispatches active generations whose worker stopped (stale check time);
 * 3. tries to resolve `needs_reconciliation` rows automatically when the
 *    provider lets us look the job up; otherwise they wait for an admin.
 */
export async function reconcile(services: Services): Promise<{ outbox: number; stale: number; reconciled: number }> {
  const outbox = await drainOutbox(services);

  const staleBefore = new Date(Date.now() - LIMITS.staleAfterMs).toISOString();
  const stale = await services.store.listDueGenerations(staleBefore, 50);
  for (const g of stale) {
    await services.dispatcher.dispatch(g.id).catch((error) => logger.error("reconcile.redispatch_failed", { generationId: g.id, error }));
  }

  let reconciled = 0;
  const pending = await services.store.listAllGenerations({ status: "needs_reconciliation", limit: 50 });
  for (const g of pending) {
    try {
      if (await reconcileOne(services, g.id)) reconciled++;
    } catch (error) {
      logger.error("reconcile.failed", { generationId: g.id, error });
    }
  }
  return { outbox, stale: stale.length, reconciled };
}

/** Returns true when the generation left needs_reconciliation. */
export async function reconcileOne(services: Services, generationId: string): Promise<boolean> {
  const g = await services.store.getGenerationById(generationId);
  const provider = services.video;
  if (!g || g.status !== "needs_reconciliation" || !provider) return false;

  let providerJobId = g.providerJobId;
  if (!providerJobId && g.audioAssetId && provider.findByIdempotencyKey && provider.capabilities().supportsIdempotencyKey) {
    const input = await buildSubmitInput(services, g);
    providerJobId = (await provider.findByIdempotencyKey(input.idempotencyKey, input))?.providerJobId ?? null;
  }
  if (!providerJobId) return false;

  const status = await provider.getStatus(providerJobId);
  if (status.state === "failed") {
    await services.store.transitionGeneration(g.id, ["needs_reconciliation"], "processing", { providerJobId, attempts: 0 });
    await services.store.failGeneration(g.id, {
      status: "failed",
      errorCode: status.errorCode ?? "provider_failed",
      errorMessage: status.errorMessage ?? "La génération a échoué chez le fournisseur.",
      providerCostMinor: null,
    });
    return true;
  }
  const next = status.state === "completed" ? "storing" : "processing";
  const moved = await services.store.transitionGeneration(g.id, ["needs_reconciliation"], next, {
    providerJobId,
    attempts: 0,
    errorCode: null,
    errorMessage: null,
    nextCheckAt: new Date().toISOString(),
  });
  if (moved && !isTerminal(moved.status)) await services.dispatcher.dispatch(g.id);
  return Boolean(moved);
}
