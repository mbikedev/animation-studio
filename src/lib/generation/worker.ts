import type { Services } from "@/lib/container";
import type { Asset, Generation } from "@/lib/domain";
import { probeBytes } from "@/lib/media/ffmpeg";
import { sha256Hex, sniffType } from "@/lib/media/inspect";
import { ProviderError, type MediaInput, type SubmitVideoInput } from "@/lib/providers/types";
import { safeDownload } from "@/lib/security/safe-fetch";
import { EXTENSION_FOR_MIME, SIGNED_URL_TTL_SECONDS } from "@/lib/storage/types";
import { logger } from "@/lib/logger";
import { isTerminal } from "./state-machine";

/**
 * Background processing of one generation, one step ("tick") at a time.
 * Every step starts with a compare-and-set transition, so concurrent
 * workers cannot submit twice or settle twice. Invariants: docs/architecture.md.
 */

export const LIMITS = {
  maxSubmitAttempts: 5,
  maxPollAttempts: 240,
  maxStoreAttempts: 6,
  maxOutputBytes: 300 * 1024 * 1024,
  downloadTimeoutMs: 120_000,
  /** Grace before the reconciler considers a worker dead. */
  staleAfterMs: 2 * 60_000,
};

export function backoffMs(attempt: number, baseMs = 3_000, maxMs = 60_000): number {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
}

const inMs = (ms: number) => new Date(Date.now() + ms).toISOString();

export function outputStoragePath(g: Generation): string {
  // Deterministic: a retried save reuses the same object and asset row.
  return `${g.ownerId}/video/${g.id}`;
}

async function mediaInput(services: Services, asset: Asset): Promise<MediaInput> {
  return {
    url: await services.storage.signedReadUrl(asset.storagePath, SIGNED_URL_TTL_SECONDS),
    mimeType: asset.mimeType ?? "application/octet-stream",
    load: async () => {
      const bytes = await services.storage.getObject(asset.storagePath);
      if (!bytes) throw new ProviderError("asset_missing", "Fichier source introuvable.", "rejected");
      return bytes;
    },
  };
}

export async function buildSubmitInput(services: Services, g: Generation): Promise<SubmitVideoInput> {
  const image = await services.store.getAssetById(g.imageAssetId);
  const audio = g.audioAssetId ? await services.store.getAssetById(g.audioAssetId) : null;
  if (!image || image.status !== "ready" || image.ownerId !== g.ownerId) throw new ProviderError("asset_invalid", "Image indisponible.", "rejected");
  if (!audio || audio.status !== "ready" || audio.ownerId !== g.ownerId) throw new ProviderError("asset_invalid", "Audio indisponible.", "rejected");
  return {
    generationId: g.id,
    idempotencyKey: `animation-studio:${g.id}`,
    prompt: g.parameters.prompt,
    aspectRatio: g.parameters.aspectRatio,
    resolution: g.parameters.resolution,
    durationMs: g.parameters.durationMs,
    image: await mediaInput(services, image),
    audio: await mediaInput(services, audio),
    simulateFailure: services.config.mode === "demo" ? g.parameters.simulateFailure : undefined,
  };
}

async function fail(services: Services, g: Generation, code: string, message: string, providerCostMinor: number | null = null) {
  logger.warn("generation.failed", { generationId: g.id, code });
  return services.store.failGeneration(g.id, { status: "failed", errorCode: code, errorMessage: message, providerCostMinor });
}

async function toReconciliation(services: Services, g: Generation, code: string, message: string) {
  logger.error("generation.needs_reconciliation", { generationId: g.id, code });
  return services.store.transitionGeneration(g.id, [g.status], "needs_reconciliation", {
    errorCode: code,
    errorMessage: message,
    nextCheckAt: null,
  });
}

/** Performs one step. Returns the updated generation (or null if another worker moved it). */
export async function advanceGeneration(services: Services, generationId: string): Promise<Generation | null> {
  const g = await services.store.getGenerationById(generationId);
  if (!g || isTerminal(g.status) || g.status === "needs_reconciliation") return g;
  const { store } = services;

  switch (g.status) {
    case "queued": {
      if (g.parameters.voiceText && !g.audioAssetId) {
        return store.transitionGeneration(g.id, ["queued"], "preparing_audio", { attempts: 0, nextCheckAt: inMs(0) });
      }
      const claimed = await store.transitionGeneration(
        g.id,
        ["queued"],
        "submitting",
        { attempts: 1, errorCode: null, nextCheckAt: inMs(LIMITS.staleAfterMs) },
      );
      if (!claimed) return null;
      return submit(services, claimed);
    }

    case "preparing_audio":
      return prepareAudio(services, g);

    case "submitting": {
      if (g.providerJobId) {
        return store.transitionGeneration(g.id, ["submitting"], "processing", { nextCheckAt: inMs(0), attempts: 0 });
      }
      // Re-entry (retry or crashed worker). Only resubmit when it is provably
      // safe: documented provider idempotency, or a previous refusal that
      // created nothing.
      const caps = services.video?.capabilities();
      const safe = caps?.supportsIdempotencyKey || g.errorCode === "submit_retry";
      if (!safe) return toReconciliation(services, g, "submit_outcome_unknown", "Soumission interrompue : vérification requise.");
      if (g.attempts >= LIMITS.maxSubmitAttempts) return fail(services, g, "submit_retries_exhausted", "Le fournisseur n'a pas accepté la tâche.");
      const claimed = await store.transitionGeneration(
        g.id,
        ["submitting"],
        "submitting",
        // Clearing the marker: a crash during this attempt is "unknown" again.
        { attempts: g.attempts + 1, errorCode: null, nextCheckAt: inMs(LIMITS.staleAfterMs) },
        { expectedAttempts: g.attempts },
      );
      if (!claimed) return null;
      return submit(services, claimed);
    }

    case "processing":
      return poll(services, g);

    case "storing":
      return storeResult(services, g);

    default:
      return g;
  }
}

async function submit(services: Services, g: Generation): Promise<Generation | null> {
  const provider = services.video;
  if (!provider) return fail(services, g, "generation_disabled", "La génération réelle n'est pas activée.");
  let input: SubmitVideoInput;
  try {
    input = await buildSubmitInput(services, g);
  } catch (error) {
    const code = error instanceof ProviderError ? error.code : "input_preparation_failed";
    return fail(services, g, code, "Impossible de préparer les fichiers.");
  }
  try {
    const { providerJobId } = await provider.submit(input);
    // Persist the provider id immediately.
    return services.store.transitionGeneration(g.id, ["submitting"], "processing", {
      providerJobId,
      attempts: 0,
      errorCode: null,
      errorMessage: null,
      nextCheckAt: inMs(3_000),
    });
  } catch (error) {
    if (!(error instanceof ProviderError)) {
      return toReconciliation(services, g, "submit_unexpected_error", "Erreur inattendue pendant la soumission.");
    }
    if (error.outcome === "unknown") {
      return toReconciliation(services, g, error.code, "Résultat de soumission inconnu : aucune relance automatique.");
    }
    if (error.outcome === "retryable" && g.attempts < LIMITS.maxSubmitAttempts) {
      return services.store.transitionGeneration(g.id, ["submitting"], "submitting", {
        errorCode: "submit_retry",
        errorMessage: error.message,
        nextCheckAt: inMs((error.retryAfterSeconds ?? 0) * 1000 || backoffMs(g.attempts, 10_000)),
      });
    }
    return fail(services, g, error.code, error.message, 0);
  }
}

async function prepareAudio(services: Services, current: Generation): Promise<Generation | null> {
  const speech = services.speech;
  if (!speech || !current.parameters.voiceText) return fail(services, current, "voice_disabled", "La synthèse vocale n'est pas activée.");
  // A previous attempt may have been billed: never synthesize twice blindly.
  if (current.attempts > 0) return toReconciliation(services, current, "voice_outcome_unknown", "Synthèse vocale interrompue : vérification requise.");
  const g = await services.store.transitionGeneration(
    current.id,
    ["preparing_audio"],
    "preparing_audio",
    { attempts: 1, nextCheckAt: inMs(LIMITS.staleAfterMs) },
    { expectedAttempts: 0 },
  );
  if (!g) return null;
  let bytes: Uint8Array;
  let mimeType: string;
  try {
    ({ bytes, mimeType } = await speech.synthesize({ text: g.parameters.voiceText ?? "" }));
  } catch (error) {
    if (error instanceof ProviderError && error.outcome === "rejected") return fail(services, g, error.code, error.message);
    return toReconciliation(services, g, "voice_outcome_unknown", "Synthèse vocale interrompue : vérification requise.");
  }
  const type = sniffType(bytes);
  if (type !== "audio/mpeg" && type !== "audio/wav") return fail(services, g, "voice_invalid_audio", "Audio de synthèse invalide.");
  let durationMs: number | null = null;
  try {
    durationMs = (await probeBytes(services.config.tools.ffprobe, bytes, EXTENSION_FOR_MIME[type])).durationMs;
  } catch {
    return toReconciliation(services, g, "voice_probe_failed", "Impossible de mesurer l'audio généré.");
  }
  const maxMs = services.config.limits.maxVideoDurationSeconds * 1000;
  if (!durationMs || durationMs > maxMs) {
    return fail(services, g, "voice_too_long", `L'audio généré dépasse ${maxMs / 1000} s : raccourcissez le texte.`);
  }
  const path = `${g.ownerId}/audio/${g.id}`;
  await services.storage.putObject(path, bytes, mimeType);
  const asset =
    (await services.store.getAssetByPath(path)) ??
    (await services.store.createAsset({ ownerId: g.ownerId, projectId: g.projectId, kind: "audio", bucket: services.storage.bucket, storagePath: path, mimeType: type }));
  await services.store.updateAsset(asset.id, {
    status: "ready",
    mimeType: type,
    sizeBytes: bytes.length,
    durationMs,
    checksum: await sha256Hex(bytes),
  });
  // Never bill more than the confirmed estimate: the provider trims to durationMs.
  const confirmedMs = Math.min(durationMs, g.parameters.durationMs);
  return services.store.transitionGeneration(g.id, ["preparing_audio"], "submitting", {
    audioAssetId: asset.id,
    parameters: { ...g.parameters, durationMs: confirmedMs },
    attempts: 0,
    nextCheckAt: inMs(0),
  });
}

async function poll(services: Services, g: Generation): Promise<Generation | null> {
  const provider = services.video;
  if (!provider || !g.providerJobId) return toReconciliation(services, g, "provider_unavailable", "Fournisseur indisponible.");
  if (g.attempts >= LIMITS.maxPollAttempts) return toReconciliation(services, g, "poll_timeout", "Délai de suivi dépassé.");
  try {
    const status = await provider.getStatus(g.providerJobId);
    if (status.state === "completed") {
      return services.store.transitionGeneration(g.id, ["processing"], "storing", { attempts: 0, nextCheckAt: inMs(0) });
    }
    if (status.state === "failed") {
      return fail(services, g, status.errorCode ?? "provider_failed", status.errorMessage ?? "La génération a échoué chez le fournisseur.");
    }
    return services.store.transitionGeneration(g.id, ["processing"], "processing", {
      attempts: g.attempts + 1,
      nextCheckAt: inMs(backoffMs(g.attempts + 1, 3_000, 30_000)),
    });
  } catch (error) {
    if (error instanceof ProviderError && error.outcome === "rejected") {
      return toReconciliation(services, g, error.code, error.message);
    }
    return services.store.transitionGeneration(g.id, ["processing"], "processing", {
      attempts: g.attempts + 1,
      nextCheckAt: inMs(backoffMs(g.attempts + 1, 5_000, 60_000)),
    });
  }
}

async function storeResult(services: Services, g: Generation): Promise<Generation | null> {
  const provider = services.video;
  if (!provider || !g.providerJobId) return toReconciliation(services, g, "provider_unavailable", "Fournisseur indisponible.");
  const path = outputStoragePath(g);

  try {
    // Crash after upload but before settlement: reuse the saved object.
    const existing = await services.store.getAssetByPath(path);
    let asset = existing?.status === "ready" ? existing : null;
    let actualCostMinor: number | null = null;

    if (!asset) {
      const result = await provider.getResult(g.providerJobId);
      actualCostMinor = result.actualCostMinor;
      const bytes = result.loadBytes
        ? await result.loadBytes()
        : (await safeDownload(result.url, { maxBytes: LIMITS.maxOutputBytes, timeoutMs: LIMITS.downloadTimeoutMs })).bytes;
      if (bytes.length > LIMITS.maxOutputBytes) throw new Error("output_too_large");
      if (sniffType(bytes) !== "video/mp4") throw new ProviderError("output_not_mp4", "Le résultat n'est pas une vidéo MP4.", "rejected");
      let durationMs = result.durationMs;
      try {
        const probe = await probeBytes(services.config.tools.ffprobe, bytes, ".mp4");
        if (!probe.hasVideo) throw new ProviderError("output_no_video", "Le résultat ne contient pas de vidéo.", "rejected");
        durationMs = probe.durationMs ?? durationMs;
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        // ffprobe unavailable: keep provider metadata, already logged at startup.
      }
      await services.storage.putObject(path, bytes, "video/mp4");
      const row =
        existing ??
        (await services.store.createAsset({
          ownerId: g.ownerId,
          projectId: g.projectId,
          kind: "video",
          bucket: services.storage.bucket,
          storagePath: path,
          mimeType: "video/mp4",
        }));
      asset = await services.store.updateAsset(row.id, {
        status: "ready",
        sizeBytes: bytes.length,
        durationMs,
        width: result.width,
        height: result.height,
        checksum: await sha256Hex(bytes),
      });
    }

    return await services.store.completeGeneration(g.id, asset.id, actualCostMinor);
  } catch (error) {
    // Never re-run the AI generation: only the transfer is retried.
    if (error instanceof ProviderError && error.outcome === "rejected") {
      return toReconciliation(services, g, error.code, error.message);
    }
    if (g.attempts + 1 >= LIMITS.maxStoreAttempts) {
      return toReconciliation(services, g, "store_retries_exhausted", "Sauvegarde du résultat impossible.");
    }
    logger.warn("generation.store_retry", { generationId: g.id, attempt: g.attempts + 1 });
    return services.store.transitionGeneration(g.id, ["storing"], "storing", {
      attempts: g.attempts + 1,
      nextCheckAt: inMs(backoffMs(g.attempts + 1, 5_000, 120_000)),
    });
  }
}

/**
 * Drives a generation until it is terminal, needs reconciliation, or its
 * time budget runs out. `sleep` is injectable (Trigger.dev uses wait.for).
 */
export async function runGeneration(
  services: Services,
  generationId: string,
  options: { sleep?: (ms: number) => Promise<void>; deadlineMs?: number } = {},
): Promise<Generation | null> {
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const deadline = Date.now() + (options.deadlineMs ?? 45 * 60_000);
  let g: Generation | null = null;
  while (Date.now() < deadline) {
    g = await advanceGeneration(services, generationId);
    if (!g || isTerminal(g.status) || g.status === "needs_reconciliation") return g;
    const wait = g.nextCheckAt ? Date.parse(g.nextCheckAt) - Date.now() : 1_000;
    // Long waits (stale guard) are refreshed by the next tick.
    await sleep(Math.max(250, Math.min(wait, 30_000)));
  }
  return g;
}
