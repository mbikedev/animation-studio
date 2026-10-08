import type {
  Asset,
  AssetKind,
  AuditLog,
  CreditAccount,
  CreditPack,
  Generation,
  GenerationParameters,
  GenerationStatus,
  LedgerEntry,
  OutboxItem,
  PaymentStatus,
  Project,
  Purchase,
} from "@/lib/domain";

/**
 * Persistence contract. Two implementations share these semantics:
 * - DemoStore: in-process, file-backed, serialized by a mutex (APP_MODE=demo)
 * - SupabaseStore: PostgreSQL functions with row locks (APP_MODE=live),
 *   see supabase/migrations.
 *
 * Every user-facing read takes the owner id and filters on it, in addition
 * to RLS in live mode. Money and credit mutations are atomic and idempotent.
 */

export interface ReserveGenerationInput {
  ownerId: string;
  projectId: string;
  imageAssetId: string;
  audioAssetId: string | null;
  provider: string;
  modelId: string;
  parameters: GenerationParameters;
  credits: number;
  priceVersion: string;
  estimatedCostMinor: number;
  currency: string;
  idempotencyKey: string;
  maxConcurrentJobs: number;
  dailyBudgetMinor: number | null;
  /** UTC day (YYYY-MM-DD) the provider spend is booked against. */
  budgetDay: string;
}

export type ReserveFailure =
  | "insufficient_credits"
  | "too_many_active_jobs"
  | "daily_budget_exceeded"
  | "invalid_assets";

export type ReserveResult =
  | { ok: true; generation: Generation; created: boolean }
  | { ok: false; reason: ReserveFailure };

export interface AdminUserRow {
  userId: string;
  email: string | null;
  displayName: string | null;
  isAdmin: boolean;
  availableCredits: number;
  reservedCredits: number;
  generations: number;
  createdAt: string;
}

export interface AdminStats {
  generationsByStatus: Record<string, number>;
  estimatedCostMinor: number;
  actualCostMinor: number;
  currency: string;
  failures24h: number;
  needsReconciliation: number;
  budgetToday: { day: string; reservedMinor: number; spentMinor: number } | null;
}

export interface BudgetDay {
  day: string;
  reservedMinor: number;
  spentMinor: number;
}

export interface Store {
  readonly kind: "demo" | "supabase";

  // Profiles and roles
  ensureProfile(user: { id: string; email: string }, signupBonus: number): Promise<void>;
  isAdmin(userId: string): Promise<boolean>;
  listUsers(limit: number): Promise<AdminUserRow[]>;

  // Projects
  listProjects(ownerId: string): Promise<Project[]>;
  getProject(ownerId: string, projectId: string): Promise<Project | null>;
  createProject(ownerId: string, title: string): Promise<Project>;
  renameProject(ownerId: string, projectId: string, title: string): Promise<Project | null>;
  softDeleteProject(ownerId: string, projectId: string): Promise<boolean>;

  // Assets
  createAsset(asset: {
    ownerId: string;
    projectId: string | null;
    kind: AssetKind;
    bucket: string;
    storagePath: string;
    mimeType?: string | null;
  }): Promise<Asset>;
  getAsset(ownerId: string, assetId: string): Promise<Asset | null>;
  /** Worker/admin only: no owner filter. */
  getAssetById(assetId: string): Promise<Asset | null>;
  getAssetByPath(storagePath: string): Promise<Asset | null>;
  updateAsset(assetId: string, patch: Partial<Omit<Asset, "id" | "ownerId" | "storagePath" | "bucket">>): Promise<Asset>;
  /** Assets referenced by a non-terminal generation. */
  isAssetInUse(assetId: string): Promise<boolean>;
  listAssets(ownerId: string): Promise<Asset[]>;

  // Generations
  reserveGeneration(input: ReserveGenerationInput): Promise<ReserveResult>;
  getGeneration(ownerId: string, generationId: string): Promise<Generation | null>;
  getGenerationById(generationId: string): Promise<Generation | null>;
  listGenerations(ownerId: string, opts?: { projectId?: string; limit?: number }): Promise<Generation[]>;
  listAllGenerations(opts: { status?: GenerationStatus; limit: number }): Promise<Generation[]>;
  /**
   * Compare-and-set transition. Returns the updated row, or null when the
   * current status is not in `from` (another worker moved it).
   */
  transitionGeneration(
    generationId: string,
    from: GenerationStatus[],
    to: GenerationStatus,
    patch?: Partial<Pick<Generation, "providerJobId" | "errorCode" | "errorMessage" | "nextCheckAt" | "attempts" | "audioAssetId" | "parameters">>,
    /** Also require the current attempt counter (claims a retry exactly once). */
    opts?: { expectedAttempts?: number },
  ): Promise<Generation | null>;
  /** storing -> succeeded + consume reserved credits exactly once. */
  completeGeneration(generationId: string, outputAssetId: string, actualCostMinor: number | null): Promise<Generation>;
  /** -> failed/canceled + release reserved credits exactly once. */
  failGeneration(
    generationId: string,
    params: { status: "failed" | "canceled"; errorCode: string; errorMessage: string; providerCostMinor: number | null; actorId?: string | null },
  ): Promise<Generation>;
  listDueGenerations(nowIso: string, limit: number): Promise<Generation[]>;
  softDeleteGeneration(ownerId: string, generationId: string): Promise<boolean>;

  // Outbox
  claimOutbox(nowIso: string, limit: number): Promise<OutboxItem[]>;
  markOutboxDispatched(outboxId: string): Promise<void>;
  markOutboxFailed(outboxId: string, nextAttemptAtIso: string): Promise<void>;

  // Credits
  getCreditAccount(userId: string): Promise<CreditAccount>;
  listLedger(userId: string, limit: number): Promise<LedgerEntry[]>;
  adminAdjustCredits(params: {
    actorId: string;
    userId: string;
    delta: number;
    reason: string;
    idempotencyKey: string;
  }): Promise<CreditAccount>;

  // Packs and purchases
  listPacks(): Promise<CreditPack[]>;
  getPack(packId: string): Promise<CreditPack | null>;
  createPurchase(params: { userId: string; pack: CreditPack }): Promise<Purchase>;
  attachCheckoutSession(purchaseId: string, sessionId: string): Promise<void>;
  getPurchase(purchaseId: string): Promise<Purchase | null>;
  getPurchaseBySession(sessionId: string): Promise<Purchase | null>;
  listPurchases(userId: string): Promise<Purchase[]>;
  /** Credits the purchase exactly once (dedup per purchase, not per event). */
  fulfillPurchase(purchaseId: string, params: { sessionId: string; amountMinor: number; currency: string }): Promise<{ credited: boolean }>;
  setPurchaseStatus(purchaseId: string, status: PaymentStatus): Promise<void>;
  /**
   * Refund or dispute: takes back credits that are still available; never
   * makes the balance negative. Returns the uncovered amount for review.
   */
  reversePurchase(purchaseId: string, status: "refunded" | "disputed"): Promise<{ reversedCredits: number; uncoveredCredits: number }>;

  // Webhooks
  /** Returns true when the event is new (first delivery). */
  recordWebhookEvent(provider: string, eventId: string, payloadHash: string): Promise<boolean>;

  // Audit
  audit(entry: Omit<AuditLog, "id" | "createdAt">): Promise<void>;
  listAudit(limit: number): Promise<AuditLog[]>;

  // Rate limiting (fixed window, distributed in live mode)
  hitRateLimit(key: string, windowSeconds: number, max: number): Promise<boolean>;

  // Budget and admin
  getBudgetDay(day: string): Promise<BudgetDay | null>;
  adminStats(currency: string): Promise<AdminStats>;

  // Account deletion (media files are removed by the caller first)
  deleteUserData(userId: string): Promise<{ storagePaths: string[] }>;
}
