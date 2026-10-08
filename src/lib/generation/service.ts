import type { Services } from "@/lib/container";
import { AppError, type Asset, type Generation, type UserIdentity } from "@/lib/domain";
import { computeEstimate, creditPolicyFromConfig, priceTableFromConfig, type Estimate } from "@/lib/billing/pricing";
import type { VideoCapabilities } from "@/lib/providers/types";
import type { z } from "zod";
import type { generationOptionsSchema, launchSchema } from "@/lib/validation/schemas";
import { drainOutbox } from "./dispatcher";

type Options = z.infer<typeof generationOptionsSchema>;
type LaunchInput = z.infer<typeof launchSchema>;

export interface StudioAvailability {
  enabled: boolean;
  mode: "demo" | "live";
  blockers: string[];
  capabilities: VideoCapabilities | null;
  voiceEnabled: boolean;
  voiceBlockers: string[];
}

export function getAvailability(services: Services): StudioAvailability {
  const { config, video } = services;
  return {
    enabled: Boolean(video) && Boolean(config.videoPrice),
    mode: config.mode,
    blockers: config.mode === "live" ? config.realGenerationBlockers : [],
    capabilities: video?.capabilities() ?? null,
    voiceEnabled: Boolean(services.speech) && config.flags.voice,
    voiceBlockers: config.voiceBlockers,
  };
}

/** Rough speech duration for estimates before synthesis (~14 chars/s). */
export function estimateSpeechMs(text: string): number {
  return Math.max(1000, Math.ceil((text.length / 14) * 1000));
}

interface ValidatedRequest {
  image: Asset;
  audio: Asset | null;
  durationMs: number;
  estimate: Estimate;
  capabilities: VideoCapabilities;
}

async function validate(services: Services, user: UserIdentity, input: Options): Promise<ValidatedRequest> {
  const availability = getAvailability(services);
  if (!availability.enabled || !availability.capabilities) {
    throw new AppError("generation_disabled", `Génération indisponible : ${availability.blockers.join(" ; ") || "configuration manquante"}.`, 503);
  }
  const caps = availability.capabilities;
  if (!caps.aspectRatios.includes(input.aspectRatio)) throw new AppError("unsupported_option", "Format non disponible pour ce moteur.");
  if (!caps.resolutions.includes(input.resolution)) throw new AppError("unsupported_option", "Résolution non disponible pour ce moteur.");

  const project = await services.store.getProject(user.id, input.projectId);
  if (!project) throw new AppError("not_found", "Projet introuvable.", 404);

  const image = await services.store.getAsset(user.id, input.imageAssetId);
  if (!image || image.kind !== "image" || image.status !== "ready") throw new AppError("invalid_image", "Image manquante ou non validée.");
  if (image.projectId !== project.id) throw new AppError("invalid_image", "L'image n'appartient pas à ce projet.");

  const maxMs = Math.min(services.config.limits.maxVideoDurationSeconds * 1000, caps.maxOutputDurationMs);
  let audio: Asset | null = null;
  let durationMs: number;
  if (input.audioAssetId) {
    audio = await services.store.getAsset(user.id, input.audioAssetId);
    if (!audio || audio.kind !== "audio" || audio.status !== "ready" || !audio.durationMs) {
      throw new AppError("invalid_audio", "Audio manquant ou non validé.");
    }
    if (audio.projectId !== project.id) throw new AppError("invalid_audio", "L'audio n'appartient pas à ce projet.");
    durationMs = audio.durationMs;
  } else if (input.voiceText) {
    if (!availability.voiceEnabled) throw new AppError("voice_disabled", "La synthèse vocale n'est pas activée.");
    durationMs = estimateSpeechMs(input.voiceText);
  } else {
    throw new AppError("missing_audio", "Ajoutez un audio ou un texte.");
  }
  if (durationMs > maxMs) {
    throw new AppError("audio_too_long", `Durée maximale : ${maxMs / 1000} s (actuelle : ${(durationMs / 1000).toFixed(1)} s).`);
  }

  const voiceChars = audio ? 0 : (input.voiceText?.length ?? 0);
  const estimate = computeEstimate(
    { durationMs, resolution: input.resolution, voiceCharacters: voiceChars },
    priceTableFromConfig(services.config),
    creditPolicyFromConfig(services.config),
    services.config.elevenlabs?.costMinorPer1kChars ?? 0,
  );
  const cap = services.config.limits.maxGenerationCostMinor;
  if (cap !== undefined && estimate.estimatedCostMinor > cap) {
    throw new AppError("cost_cap_exceeded", "Le coût estimé dépasse le plafond autorisé par génération.");
  }
  return { image, audio, durationMs, estimate, capabilities: caps };
}

export async function estimateGeneration(services: Services, user: UserIdentity, input: Options) {
  const v = await validate(services, user, input);
  const account = await services.store.getCreditAccount(user.id);
  return {
    estimate: v.estimate,
    durationMs: v.durationMs,
    availableCredits: account.availableCredits,
    enoughCredits: account.availableCredits >= v.estimate.credits,
  };
}

export async function launchGeneration(
  services: Services,
  user: UserIdentity,
  input: LaunchInput,
): Promise<{ generation: Generation; created: boolean }> {
  const v = await validate(services, user, input);
  // Price re-checked at launch: a changed quote needs a new confirmation.
  if (v.estimate.quoteId !== input.quoteId) {
    throw new AppError("quote_changed", "Le prix a changé : vérifiez la nouvelle estimation avant de lancer.", 409, { estimate: v.estimate });
  }

  const result = await services.store.reserveGeneration({
    ownerId: user.id,
    projectId: input.projectId,
    imageAssetId: v.image.id,
    audioAssetId: v.audio?.id ?? null,
    provider: v.capabilities.provider,
    modelId: v.capabilities.modelId,
    parameters: {
      aspectRatio: input.aspectRatio,
      resolution: input.resolution,
      prompt: input.prompt || "A person speaking naturally to the camera",
      voiceText: v.audio ? undefined : input.voiceText,
      durationMs: v.durationMs,
      simulateFailure: services.config.mode === "demo" ? input.simulateFailure : undefined,
    },
    credits: v.estimate.credits,
    priceVersion: v.estimate.priceVersion,
    estimatedCostMinor: v.estimate.estimatedCostMinor,
    currency: v.estimate.currency,
    idempotencyKey: `launch:${input.submissionId}`,
    maxConcurrentJobs: services.config.limits.maxConcurrentJobsPerUser,
    dailyBudgetMinor: services.config.limits.dailyProviderBudgetMinor ?? null,
    budgetDay: new Date().toISOString().slice(0, 10),
  });

  if (!result.ok) {
    const messages = {
      insufficient_credits: ["Crédits insuffisants pour cette génération.", 402],
      too_many_active_jobs: ["Une génération est déjà en cours. Attendez sa fin.", 429],
      daily_budget_exceeded: ["Capacité quotidienne atteinte. Réessayez demain.", 503],
      invalid_assets: ["Fichiers ou projet invalides.", 400],
    } as const;
    const [message, status] = messages[result.reason];
    throw new AppError(result.reason, message, status);
  }

  // Best effort; the scheduled reconciliation dispatches anything left behind.
  await drainOutbox(services).catch(() => undefined);
  return { generation: result.generation, created: result.created };
}

/**
 * User "cancel": only possible before the provider job exists. Once
 * submitted, the provider keeps working and bills; we say so in the UI.
 */
export async function cancelGeneration(services: Services, user: UserIdentity, generationId: string): Promise<Generation> {
  const g = await services.store.getGeneration(user.id, generationId);
  if (!g) throw new AppError("not_found", "Génération introuvable.", 404);
  if (g.status !== "queued") {
    throw new AppError(
      "cannot_cancel",
      "La génération est déjà transmise au moteur : elle ne peut plus être annulée et sera facturée.",
      409,
    );
  }
  return services.store.failGeneration(g.id, {
    status: "canceled",
    errorCode: "user_canceled",
    errorMessage: "Annulée avant transmission au moteur.",
    providerCostMinor: 0,
  });
}
