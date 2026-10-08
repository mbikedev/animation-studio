import type { AppConfig, Resolution } from "@/lib/config/env";
import { AppError, type AspectRatio } from "@/lib/domain";

export interface PriceTable {
  version: string;
  currency: string;
  ratePerSecondMicros: Record<Resolution, number>;
}

export interface CreditPolicy {
  /** Value of one internal credit, in minor units of the cost currency. */
  creditValueMinor: number;
  /** Markup applied to provider cost, in basis points (10000 = x1). */
  markupBps: number;
}

export interface EstimateInput {
  durationMs: number;
  resolution: Resolution;
  voiceCharacters?: number;
}

export interface Estimate {
  priceVersion: string;
  currency: string;
  billableSeconds: number;
  videoCostMinor: number;
  voiceCostMinor: number;
  estimatedCostMinor: number;
  credits: number;
  /** Stable fingerprint the client echoes back when launching. */
  quoteId: string;
}

/** 1 minor unit (e.g. a cent) = 10 000 micro-units (1e-6 of the major unit). */
const MICROS_PER_MINOR = 10_000;

/**
 * Hedra does not document a billing granularity, so we bill conservatively:
 * every started second counts. Revalidate against real invoices.
 */
export function billableSeconds(durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new AppError("invalid_duration", "La durée doit être positive.");
  }
  return Math.ceil(durationMs / 1000);
}

export function videoCostMinor(table: PriceTable, durationMs: number, resolution: Resolution): number {
  const rate = table.ratePerSecondMicros[resolution];
  if (!Number.isSafeInteger(rate) || rate <= 0) {
    throw new AppError("resolution_unavailable", `Résolution ${resolution} non tarifée.`);
  }
  // Integer arithmetic only; round up to the next minor unit.
  return Math.ceil((billableSeconds(durationMs) * rate) / MICROS_PER_MINOR);
}

export function voiceCostMinor(characters: number, costMinorPer1kChars: number): number {
  if (characters <= 0 || costMinorPer1kChars <= 0) return 0;
  return Math.ceil((characters * costMinorPer1kChars) / 1000);
}

export function creditsForCost(costMinor: number, policy: CreditPolicy): number {
  if (costMinor <= 0) return 0;
  const withMarkup = Math.ceil((costMinor * policy.markupBps) / 10_000);
  return Math.max(1, Math.ceil(withMarkup / policy.creditValueMinor));
}

export function computeEstimate(
  input: EstimateInput,
  table: PriceTable,
  policy: CreditPolicy,
  voiceRatePer1k = 0,
): Estimate {
  const seconds = billableSeconds(input.durationMs);
  const video = videoCostMinor(table, input.durationMs, input.resolution);
  const voice = voiceCostMinor(input.voiceCharacters ?? 0, voiceRatePer1k);
  const total = video + voice;
  const credits = creditsForCost(total, policy);
  const quoteId = [
    table.version,
    input.resolution,
    seconds,
    input.voiceCharacters ?? 0,
    total,
    credits,
    policy.creditValueMinor,
    policy.markupBps,
  ].join(":");
  return {
    priceVersion: table.version,
    currency: table.currency,
    billableSeconds: seconds,
    videoCostMinor: video,
    voiceCostMinor: voice,
    estimatedCostMinor: total,
    credits,
    quoteId,
  };
}

export function priceTableFromConfig(config: AppConfig): PriceTable {
  if (!config.videoPrice) {
    throw new AppError(
      "pricing_not_configured",
      "Le tarif du moteur vidéo n'est pas configuré : génération indisponible.",
      503,
    );
  }
  return config.videoPrice;
}

export function creditPolicyFromConfig(config: AppConfig): CreditPolicy {
  return { creditValueMinor: config.credits.creditValueMinor, markupBps: config.credits.markupBps };
}

export function formatMoney(minor: number, currency: string, locale = "fr-BE"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(minor / 100);
}

export type { AspectRatio };
