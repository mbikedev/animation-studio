import type { Resolution } from "@/lib/config/env";

export type { Resolution };

export const ASPECT_RATIOS = ["16:9", "9:16", "1:1"] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export const RESOLUTIONS = ["540p", "720p", "1080p"] as const;

export const GENERATION_STATUSES = [
  "queued",
  "preparing_audio",
  "submitting",
  "processing",
  "storing",
  "succeeded",
  "failed",
  "canceled",
  "needs_reconciliation",
] as const;
export type GenerationStatus = (typeof GENERATION_STATUSES)[number];

export const TERMINAL_STATUSES: readonly GenerationStatus[] = ["succeeded", "failed", "canceled"];

export type AssetKind = "image" | "audio" | "video";
export type AssetStatus = "pending_upload" | "ready" | "rejected" | "deleted";

export interface UserIdentity {
  id: string;
  email: string;
  isAdmin: boolean;
  emailConfirmed: boolean;
}

export interface Project {
  id: string;
  ownerId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Asset {
  id: string;
  ownerId: string;
  projectId: string | null;
  kind: AssetKind;
  bucket: string;
  storagePath: string;
  mimeType: string | null;
  sizeBytes: number | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  checksum: string | null;
  status: AssetStatus;
  createdAt: string;
}

export interface GenerationParameters {
  aspectRatio: AspectRatio;
  resolution: Resolution;
  prompt: string;
  /** Text for optional text-to-speech. */
  voiceText?: string;
  /** Measured or estimated output duration in ms. */
  durationMs: number;
  /** Demo only: force a provider failure to exercise the error path. */
  simulateFailure?: boolean;
}

export interface Generation {
  id: string;
  ownerId: string;
  projectId: string;
  provider: string;
  modelId: string;
  providerJobId: string | null;
  status: GenerationStatus;
  parameters: GenerationParameters;
  imageAssetId: string;
  audioAssetId: string | null;
  outputAssetId: string | null;
  reservedCredits: number;
  priceVersion: string;
  estimatedCostMinor: number;
  actualCostMinor: number | null;
  currency: string;
  errorCode: string | null;
  errorMessage: string | null;
  attempts: number;
  nextCheckAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreditAccount {
  userId: string;
  availableCredits: number;
  reservedCredits: number;
}

export type LedgerEventType =
  | "signup_bonus"
  | "purchase"
  | "reserve"
  | "consume"
  | "release"
  | "admin_adjustment"
  | "refund_reversal";

export interface LedgerEntry {
  id: string;
  userId: string;
  generationId: string | null;
  eventType: LedgerEventType;
  availableDelta: number;
  reservedDelta: number;
  idempotencyKey: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface CreditPack {
  id: string;
  name: string;
  credits: number;
  stripePriceId: string | null;
  /** Display price, from the Stripe price or demo config. Not trusted for billing. */
  amountMinor: number;
  currency: string;
  active: boolean;
}

export type PaymentStatus =
  | "pending"
  | "paid"
  | "async_pending"
  | "failed"
  | "expired"
  | "refunded"
  | "disputed";

export interface Purchase {
  id: string;
  userId: string;
  packId: string;
  creditsSnapshot: number;
  stripeSessionId: string | null;
  paymentStatus: PaymentStatus;
  currency: string;
  amountMinor: number;
  creditedAt: string | null;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  sanitizedMetadata: Record<string, unknown>;
  createdAt: string;
}

export interface OutboxItem {
  id: string;
  generationId: string;
  dispatchStatus: "pending" | "dispatched" | "failed";
  attempts: number;
  nextAttemptAt: string;
}

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus = 400,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}
