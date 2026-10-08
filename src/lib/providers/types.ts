import type { AspectRatio, Resolution } from "@/lib/domain";

/**
 * Internal provider contracts. These method names are ours; they do NOT
 * mirror the external API (see docs/provider-integration.md for the mapping).
 */

export interface VideoCapabilities {
  provider: string;
  modelId: string;
  aspectRatios: AspectRatio[];
  resolutions: Resolution[];
  image: { mimeTypes: string[]; maxBytes: number };
  audio: { mimeTypes: string[]; maxBytes: number; minDurationMs: number; maxDurationMs: number };
  /** Our own V1 cap, never above the provider limit. */
  maxOutputDurationMs: number;
  supportsCancel: boolean;
  reportsProgress: boolean;
  supportsIdempotencyKey: boolean;
}

export interface MediaInput {
  /** Short-lived URL to our private storage object (never a user URL). */
  url: string;
  mimeType: string;
  /** Raw bytes, when the provider wants an upload rather than a URL. */
  load: () => Promise<Uint8Array>;
}

export interface SubmitVideoInput {
  generationId: string;
  idempotencyKey: string;
  prompt: string;
  aspectRatio: AspectRatio;
  resolution: Resolution;
  durationMs: number;
  image: MediaInput;
  audio: MediaInput;
  webhookUrl?: string;
  /** Demo only. */
  simulateFailure?: boolean;
}

export type ProviderJobState = "queued" | "processing" | "completed" | "failed";

export interface ProviderJobStatus {
  state: ProviderJobState;
  /** Real progress 0-1 if and only if the provider reports it. */
  progress?: number;
  errorCode?: string;
  errorMessage?: string;
  retryable?: boolean;
}

export interface ProviderResult {
  /** Temporary download URL from the provider. Validated before fetching. */
  url: string;
  contentType: string | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  /** Actual cost if the provider reports it, in minor units. */
  actualCostMinor: number | null;
  currency: string | null;
  /** Demo provider only: bytes produced locally instead of a remote URL. */
  loadBytes?: () => Promise<Uint8Array>;
}

export class ProviderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    /** "unknown" = we cannot tell whether a billable job was created. */
    public readonly outcome: "rejected" | "retryable" | "unknown",
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface VideoProvider {
  readonly name: string;
  capabilities(): VideoCapabilities;
  submit(input: SubmitVideoInput): Promise<{ providerJobId: string }>;
  getStatus(providerJobId: string): Promise<ProviderJobStatus>;
  getResult(providerJobId: string): Promise<ProviderResult>;
  /**
   * Look up a job created with this idempotency key, after a submit whose
   * outcome is unknown. Returns null if the provider cannot tell.
   */
  findByIdempotencyKey?(idempotencyKey: string, input: SubmitVideoInput): Promise<{ providerJobId: string } | null>;
  cancel?(providerJobId: string): Promise<void>;
}

export interface SpeechProvider {
  readonly name: string;
  synthesize(input: { text: string; voiceId?: string }): Promise<{ bytes: Uint8Array; mimeType: string }>;
}
