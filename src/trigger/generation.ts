import { schedules, task, wait } from "@trigger.dev/sdk";
import { buildServices, type Services } from "@/lib/container";
import { getConfig } from "@/lib/config/env";
import { createDispatcher, reconcile } from "@/lib/generation/dispatcher";
import { runGeneration } from "@/lib/generation/worker";

let services: Services | undefined;
function getWorkerServices(): Services {
  services ??= buildServices(getConfig(), createDispatcher);
  return services;
}

/** Drives one generation through its states (submit, poll, store, settle). */
export const processGeneration = task({
  id: "process-generation",
  maxDuration: 3600,
  queue: { concurrencyLimit: 10 },
  run: async (payload: { generationId: string }) => {
    const result = await runGeneration(getWorkerServices(), payload.generationId, {
      sleep: async (ms) => {
        if (ms >= 5_000) await wait.for({ seconds: Math.ceil(ms / 1000) });
        else await new Promise((r) => setTimeout(r, ms));
      },
      deadlineMs: 55 * 60_000,
    });
    return { generationId: payload.generationId, status: result?.status ?? "unknown" };
  },
});

/** Safety net: outbox dispatch, stale workers, automatic reconciliation. */
export const reconcileGenerations = schedules.task({
  id: "reconcile-generations",
  cron: "*/5 * * * *",
  run: async () => reconcile(getWorkerServices()),
});
