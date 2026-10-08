import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AppError,
  type Asset,
  type AuditLog,
  type CreditAccount,
  type CreditPack,
  type Generation,
  type GenerationStatus,
  type LedgerEntry,
  type OutboxItem,
  type PaymentStatus,
  type Project,
  type Purchase,
} from "@/lib/domain";
import type { AdminStats, AdminUserRow, BudgetDay, ReserveFailure, ReserveGenerationInput, ReserveResult, Store } from "./types";

/**
 * Live persistence through Supabase with the service role key (server only).
 * Every money/credit/status mutation is a single PostgreSQL function call
 * (supabase/migrations), so atomicity and locking live in the database.
 * Owner filters are applied explicitly on every user-facing query.
 */

type Row = Record<string, unknown>;

const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function mapProject(r: Row): Project {
  return {
    id: String(r.id),
    ownerId: String(r.owner_id),
    title: String(r.title),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    deletedAt: s(r.deleted_at),
  };
}

function mapAsset(r: Row): Asset {
  return {
    id: String(r.id),
    ownerId: String(r.owner_id),
    projectId: s(r.project_id),
    kind: r.kind as Asset["kind"],
    bucket: String(r.bucket),
    storagePath: String(r.storage_path),
    mimeType: s(r.mime_type),
    sizeBytes: n(r.size_bytes),
    durationMs: n(r.duration_ms),
    width: n(r.width),
    height: n(r.height),
    checksum: s(r.checksum),
    status: r.status as Asset["status"],
    createdAt: String(r.created_at),
  };
}

function mapGeneration(r: Row): Generation {
  return {
    id: String(r.id),
    ownerId: String(r.owner_id),
    projectId: String(r.project_id),
    provider: String(r.provider),
    modelId: String(r.model_id),
    providerJobId: s(r.provider_job_id),
    status: r.status as GenerationStatus,
    parameters: r.parameters as Generation["parameters"],
    imageAssetId: String(r.image_asset_id),
    audioAssetId: s(r.audio_asset_id),
    outputAssetId: s(r.output_asset_id),
    reservedCredits: Number(r.reserved_credits),
    priceVersion: String(r.price_version),
    estimatedCostMinor: Number(r.estimated_cost_minor),
    actualCostMinor: n(r.actual_cost_minor),
    currency: String(r.currency),
    errorCode: s(r.error_code),
    errorMessage: s(r.error_message),
    attempts: Number(r.attempts ?? 0),
    nextCheckAt: s(r.next_check_at),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function mapPack(r: Row): CreditPack {
  return {
    id: String(r.id),
    name: String(r.name),
    credits: Number(r.credits),
    stripePriceId: s(r.stripe_price_id),
    amountMinor: Number(r.amount_minor),
    currency: String(r.currency),
    active: Boolean(r.active),
  };
}

function mapPurchase(r: Row): Purchase {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    packId: String(r.pack_id),
    creditsSnapshot: Number(r.credits_snapshot),
    stripeSessionId: s(r.stripe_session_id),
    paymentStatus: r.payment_status as PaymentStatus,
    currency: String(r.currency),
    amountMinor: Number(r.amount_minor),
    creditedAt: s(r.credited_at),
    createdAt: String(r.created_at),
  };
}

function mapAccount(r: Row | null, userId: string): CreditAccount {
  return {
    userId,
    availableCredits: Number(r?.available_credits ?? 0),
    reservedCredits: Number(r?.reserved_credits ?? 0),
  };
}

function check<T>(result: { data: T; error: { message: string; code?: string } | null }, context: string): T {
  if (result.error) {
    // Never include row payloads in errors (may contain personal data).
    throw new AppError("database_error", `${context}: ${result.error.code ?? "error"}`, 500);
  }
  return result.data;
}

const ACTIVE: GenerationStatus[] = ["queued", "preparing_audio", "submitting", "processing", "storing", "needs_reconciliation"];

export class SupabaseStore implements Store {
  readonly kind = "supabase" as const;

  constructor(private readonly db: SupabaseClient) {}

  async ensureProfile(user: { id: string; email: string }, signupBonus: number) {
    check(await this.db.rpc("ensure_profile", { p_user_id: user.id, p_email: user.email, p_bonus: signupBonus }), "ensure_profile");
  }

  async isAdmin(userId: string) {
    const data = check(await this.db.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle(), "isAdmin");
    return Boolean(data);
  }

  async listUsers(limit: number): Promise<AdminUserRow[]> {
    const profiles = check(await this.db.from("profiles").select("id,email,display_name,created_at").order("created_at", { ascending: false }).limit(limit), "listUsers") as Row[];
    const ids = profiles.map((p) => String(p.id));
    if (ids.length === 0) return [];
    const [accounts, roles, gens] = await Promise.all([
      this.db.from("credit_accounts").select("user_id,available_credits,reserved_credits").in("user_id", ids),
      this.db.from("user_roles").select("user_id").in("user_id", ids),
      this.db.from("generations").select("owner_id").in("owner_id", ids),
    ]);
    const accs = check(accounts, "accounts") as Row[];
    const adminIds = new Set((check(roles, "roles") as Row[]).map((r) => String(r.user_id)));
    const counts = new Map<string, number>();
    for (const g of check(gens, "gens") as Row[]) counts.set(String(g.owner_id), (counts.get(String(g.owner_id)) ?? 0) + 1);
    return profiles.map((p) => {
      const acc = accs.find((a) => a.user_id === p.id);
      return {
        userId: String(p.id),
        email: s(p.email),
        displayName: s(p.display_name),
        isAdmin: adminIds.has(String(p.id)),
        availableCredits: Number(acc?.available_credits ?? 0),
        reservedCredits: Number(acc?.reserved_credits ?? 0),
        generations: counts.get(String(p.id)) ?? 0,
        createdAt: String(p.created_at),
      };
    });
  }

  async listProjects(ownerId: string) {
    const data = check(await this.db.from("projects").select("*").eq("owner_id", ownerId).is("deleted_at", null).order("updated_at", { ascending: false }), "listProjects");
    return (data as Row[]).map(mapProject);
  }

  async getProject(ownerId: string, projectId: string) {
    const data = check(await this.db.from("projects").select("*").eq("id", projectId).eq("owner_id", ownerId).is("deleted_at", null).maybeSingle(), "getProject");
    return data ? mapProject(data as Row) : null;
  }

  async createProject(ownerId: string, title: string) {
    const data = check(await this.db.from("projects").insert({ owner_id: ownerId, title }).select("*").single(), "createProject");
    return mapProject(data as Row);
  }

  async renameProject(ownerId: string, projectId: string, title: string) {
    const data = check(
      await this.db.from("projects").update({ title, updated_at: new Date().toISOString() }).eq("id", projectId).eq("owner_id", ownerId).is("deleted_at", null).select("*").maybeSingle(),
      "renameProject",
    );
    return data ? mapProject(data as Row) : null;
  }

  async softDeleteProject(ownerId: string, projectId: string) {
    const active = check(await this.db.from("generations").select("id").eq("project_id", projectId).in("status", ACTIVE).limit(1), "activeGenerations") as Row[];
    if (active.length > 0) throw new AppError("project_busy", "Une génération est en cours dans ce projet.", 409);
    const data = check(
      await this.db.from("projects").update({ deleted_at: new Date().toISOString() }).eq("id", projectId).eq("owner_id", ownerId).is("deleted_at", null).select("id"),
      "softDeleteProject",
    ) as Row[];
    return data.length > 0;
  }

  async createAsset(a: Parameters<Store["createAsset"]>[0]) {
    const data = check(
      await this.db
        .from("assets")
        .insert({ owner_id: a.ownerId, project_id: a.projectId, kind: a.kind, bucket: a.bucket, storage_path: a.storagePath, mime_type: a.mimeType ?? null })
        .select("*")
        .single(),
      "createAsset",
    );
    return mapAsset(data as Row);
  }

  async getAsset(ownerId: string, assetId: string) {
    const data = check(await this.db.from("assets").select("*").eq("id", assetId).eq("owner_id", ownerId).maybeSingle(), "getAsset");
    return data ? mapAsset(data as Row) : null;
  }

  async getAssetById(assetId: string) {
    const data = check(await this.db.from("assets").select("*").eq("id", assetId).maybeSingle(), "getAssetById");
    return data ? mapAsset(data as Row) : null;
  }

  async getAssetByPath(storagePath: string) {
    const data = check(await this.db.from("assets").select("*").eq("storage_path", storagePath).maybeSingle(), "getAssetByPath");
    return data ? mapAsset(data as Row) : null;
  }

  async updateAsset(assetId: string, patch: Parameters<Store["updateAsset"]>[1]) {
    const row: Row = {};
    if (patch.projectId !== undefined) row.project_id = patch.projectId;
    if (patch.kind !== undefined) row.kind = patch.kind;
    if (patch.mimeType !== undefined) row.mime_type = patch.mimeType;
    if (patch.sizeBytes !== undefined) row.size_bytes = patch.sizeBytes;
    if (patch.durationMs !== undefined) row.duration_ms = patch.durationMs;
    if (patch.width !== undefined) row.width = patch.width;
    if (patch.height !== undefined) row.height = patch.height;
    if (patch.checksum !== undefined) row.checksum = patch.checksum;
    if (patch.status !== undefined) row.status = patch.status;
    const data = check(await this.db.from("assets").update(row).eq("id", assetId).select("*").single(), "updateAsset");
    return mapAsset(data as Row);
  }

  async isAssetInUse(assetId: string) {
    const data = check(
      await this.db
        .from("generations")
        .select("id")
        .in("status", ACTIVE)
        .or(`image_asset_id.eq.${assetId},audio_asset_id.eq.${assetId},output_asset_id.eq.${assetId}`)
        .limit(1),
      "isAssetInUse",
    ) as Row[];
    return data.length > 0;
  }

  async listAssets(ownerId: string) {
    const data = check(await this.db.from("assets").select("*").eq("owner_id", ownerId).neq("status", "deleted"), "listAssets");
    return (data as Row[]).map(mapAsset);
  }

  async reserveGeneration(input: ReserveGenerationInput): Promise<ReserveResult> {
    const result = check(
      await this.db.rpc("reserve_generation", {
        p: {
          owner_id: input.ownerId,
          project_id: input.projectId,
          image_asset_id: input.imageAssetId,
          audio_asset_id: input.audioAssetId,
          provider: input.provider,
          model_id: input.modelId,
          parameters: input.parameters,
          credits: input.credits,
          price_version: input.priceVersion,
          estimated_cost_minor: input.estimatedCostMinor,
          currency: input.currency,
          idempotency_key: input.idempotencyKey,
          max_concurrent_jobs: input.maxConcurrentJobs,
          daily_budget_minor: input.dailyBudgetMinor === null ? "" : String(input.dailyBudgetMinor),
          budget_day: input.budgetDay,
        },
      }),
      "reserve_generation",
    ) as { ok: boolean; reason?: ReserveFailure; created?: boolean; generation_id?: string };
    if (!result.ok) return { ok: false, reason: result.reason ?? "invalid_assets" };
    const generation = await this.getGenerationById(String(result.generation_id));
    if (!generation) throw new AppError("database_error", "reserve_generation: missing row", 500);
    return { ok: true, generation, created: Boolean(result.created) };
  }

  async getGeneration(ownerId: string, generationId: string) {
    const data = check(await this.db.from("generations").select("*").eq("id", generationId).eq("owner_id", ownerId).is("deleted_at", null).maybeSingle(), "getGeneration");
    return data ? mapGeneration(data as Row) : null;
  }

  async getGenerationById(generationId: string) {
    const data = check(await this.db.from("generations").select("*").eq("id", generationId).maybeSingle(), "getGenerationById");
    return data ? mapGeneration(data as Row) : null;
  }

  async listGenerations(ownerId: string, opts?: { projectId?: string; limit?: number }) {
    let q = this.db.from("generations").select("*").eq("owner_id", ownerId).is("deleted_at", null);
    if (opts?.projectId) q = q.eq("project_id", opts.projectId);
    const data = check(await q.order("created_at", { ascending: false }).limit(opts?.limit ?? 100), "listGenerations");
    return (data as Row[]).map(mapGeneration);
  }

  async listAllGenerations(opts: { status?: GenerationStatus; limit: number }) {
    let q = this.db.from("generations").select("*");
    if (opts.status) q = q.eq("status", opts.status);
    const data = check(await q.order("created_at", { ascending: false }).limit(opts.limit), "listAllGenerations");
    return (data as Row[]).map(mapGeneration);
  }

  async transitionGeneration(
    generationId: string,
    from: GenerationStatus[],
    to: GenerationStatus,
    patch?: Parameters<Store["transitionGeneration"]>[3],
    opts?: Parameters<Store["transitionGeneration"]>[4],
  ) {
    const p: Row = {};
    if (patch?.providerJobId !== undefined) p.provider_job_id = patch.providerJobId;
    if (patch?.errorCode !== undefined) p.error_code = patch.errorCode;
    if (patch?.errorMessage !== undefined) p.error_message = patch.errorMessage;
    if (patch?.nextCheckAt !== undefined) p.next_check_at = patch.nextCheckAt;
    if (patch?.attempts !== undefined) p.attempts = patch.attempts;
    if (patch?.audioAssetId !== undefined) p.audio_asset_id = patch.audioAssetId;
    if (patch?.parameters !== undefined) p.parameters = patch.parameters;
    const data = check(
      await this.db.rpc("transition_generation", {
        p_id: generationId,
        p_from: from,
        p_to: to,
        p_patch: p,
        p_expected_attempts: opts?.expectedAttempts ?? null,
      }),
      "transition_generation",
    ) as Row[];
    return data.length > 0 ? mapGeneration(data[0]) : null;
  }

  async completeGeneration(generationId: string, outputAssetId: string, actualCostMinor: number | null) {
    const data = check(
      await this.db.rpc("complete_generation", { p_id: generationId, p_output_asset_id: outputAssetId, p_actual_cost_minor: actualCostMinor }),
      "complete_generation",
    );
    return mapGeneration(data as Row);
  }

  async failGeneration(generationId: string, params: Parameters<Store["failGeneration"]>[1]) {
    const data = check(
      await this.db.rpc("fail_generation", {
        p_id: generationId,
        p_status: params.status,
        p_error_code: params.errorCode,
        p_error_message: params.errorMessage,
        p_provider_cost_minor: params.providerCostMinor,
        p_actor: params.actorId ?? null,
      }),
      "fail_generation",
    );
    return mapGeneration(data as Row);
  }

  async listDueGenerations(nowIso: string, limit: number) {
    const data = check(
      await this.db
        .from("generations")
        .select("*")
        .in("status", ["queued", "preparing_audio", "submitting", "processing", "storing"])
        .lte("next_check_at", nowIso)
        .order("next_check_at")
        .limit(limit),
      "listDueGenerations",
    );
    return (data as Row[]).map(mapGeneration);
  }

  async softDeleteGeneration(ownerId: string, generationId: string) {
    const g = await this.getGeneration(ownerId, generationId);
    if (!g) return false;
    if (ACTIVE.includes(g.status)) throw new AppError("generation_active", "Génération en cours : suppression impossible.", 409);
    const data = check(
      await this.db.from("generations").update({ deleted_at: new Date().toISOString() }).eq("id", generationId).eq("owner_id", ownerId).select("id"),
      "softDeleteGeneration",
    ) as Row[];
    return data.length > 0;
  }

  async claimOutbox(nowIso: string, limit: number): Promise<OutboxItem[]> {
    const data = check(await this.db.rpc("claim_outbox", { p_now: nowIso, p_limit: limit }), "claim_outbox") as Row[];
    return data.map((r) => ({
      id: String(r.id),
      generationId: String(r.generation_id),
      dispatchStatus: r.dispatch_status as OutboxItem["dispatchStatus"],
      attempts: Number(r.attempts),
      nextAttemptAt: String(r.next_attempt_at),
    }));
  }

  async markOutboxDispatched(outboxId: string) {
    check(await this.db.from("job_outbox").update({ dispatch_status: "dispatched" }).eq("id", outboxId), "markOutboxDispatched");
  }

  async markOutboxFailed(outboxId: string, nextAttemptAtIso: string) {
    check(await this.db.from("job_outbox").update({ dispatch_status: "failed", next_attempt_at: nextAttemptAtIso }).eq("id", outboxId), "markOutboxFailed");
  }

  async getCreditAccount(userId: string) {
    const data = check(await this.db.from("credit_accounts").select("*").eq("user_id", userId).maybeSingle(), "getCreditAccount");
    return mapAccount(data as Row | null, userId);
  }

  async listLedger(userId: string, limit: number): Promise<LedgerEntry[]> {
    const data = check(await this.db.from("credit_ledger").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(limit), "listLedger");
    return (data as Row[]).map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      generationId: s(r.generation_id),
      eventType: r.event_type as LedgerEntry["eventType"],
      availableDelta: Number(r.available_delta),
      reservedDelta: Number(r.reserved_delta),
      idempotencyKey: String(r.idempotency_key),
      metadata: (r.metadata as Record<string, unknown>) ?? {},
      createdAt: String(r.created_at),
    }));
  }

  async adminAdjustCredits(params: Parameters<Store["adminAdjustCredits"]>[0]) {
    const data = check(
      await this.db.rpc("admin_adjust_credits", {
        p_actor: params.actorId,
        p_user: params.userId,
        p_delta: params.delta,
        p_reason: params.reason,
        p_key: params.idempotencyKey,
      }),
      "admin_adjust_credits",
    );
    return mapAccount(data as Row, params.userId);
  }

  async listPacks() {
    const data = check(await this.db.from("credit_packs").select("*").eq("active", true).order("credits"), "listPacks");
    return (data as Row[]).map(mapPack);
  }

  async getPack(packId: string) {
    const data = check(await this.db.from("credit_packs").select("*").eq("id", packId).eq("active", true).maybeSingle(), "getPack");
    return data ? mapPack(data as Row) : null;
  }

  async createPurchase(params: { userId: string; pack: CreditPack }) {
    const data = check(
      await this.db
        .from("purchases")
        .insert({
          user_id: params.userId,
          pack_id: params.pack.id,
          credits_snapshot: params.pack.credits,
          currency: params.pack.currency,
          amount_minor: params.pack.amountMinor,
        })
        .select("*")
        .single(),
      "createPurchase",
    );
    return mapPurchase(data as Row);
  }

  async attachCheckoutSession(purchaseId: string, sessionId: string) {
    check(await this.db.from("purchases").update({ stripe_session_id: sessionId }).eq("id", purchaseId).is("stripe_session_id", null), "attachCheckoutSession");
  }

  async getPurchase(purchaseId: string) {
    const data = check(await this.db.from("purchases").select("*").eq("id", purchaseId).maybeSingle(), "getPurchase");
    return data ? mapPurchase(data as Row) : null;
  }

  async getPurchaseBySession(sessionId: string) {
    const data = check(await this.db.from("purchases").select("*").eq("stripe_session_id", sessionId).maybeSingle(), "getPurchaseBySession");
    return data ? mapPurchase(data as Row) : null;
  }

  async listPurchases(userId: string) {
    const data = check(await this.db.from("purchases").select("*").eq("user_id", userId).order("created_at", { ascending: false }), "listPurchases");
    return (data as Row[]).map(mapPurchase);
  }

  async fulfillPurchase(purchaseId: string, params: { sessionId: string; amountMinor: number; currency: string }) {
    const credited = check(
      await this.db.rpc("fulfill_purchase", {
        p_purchase_id: purchaseId,
        p_session_id: params.sessionId,
        p_amount_minor: params.amountMinor,
        p_currency: params.currency,
      }),
      "fulfill_purchase",
    );
    return { credited: Boolean(credited) };
  }

  async setPurchaseStatus(purchaseId: string, status: PaymentStatus) {
    let q = this.db.from("purchases").update({ payment_status: status }).eq("id", purchaseId);
    if (["pending", "async_pending", "failed", "expired"].includes(status)) q = q.is("credited_at", null);
    check(await q, "setPurchaseStatus");
  }

  async reversePurchase(purchaseId: string, status: "refunded" | "disputed") {
    const data = check(await this.db.rpc("reverse_purchase", { p_purchase_id: purchaseId, p_status: status }), "reverse_purchase") as {
      reversed: number;
      uncovered: number;
    };
    return { reversedCredits: Number(data.reversed), uncoveredCredits: Number(data.uncovered) };
  }

  async recordWebhookEvent(provider: string, eventId: string, payloadHash: string) {
    const data = check(
      await this.db.rpc("record_webhook_event", { p_provider: provider, p_event_id: eventId, p_payload_hash: payloadHash }),
      "record_webhook_event",
    );
    return Boolean(data);
  }

  async audit(entry: Omit<AuditLog, "id" | "createdAt">) {
    check(
      await this.db.from("audit_logs").insert({
        actor_id: entry.actorId,
        action: entry.action,
        target_type: entry.targetType,
        target_id: entry.targetId,
        sanitized_metadata: entry.sanitizedMetadata,
      }),
      "audit",
    );
  }

  async listAudit(limit: number): Promise<AuditLog[]> {
    const data = check(await this.db.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(limit), "listAudit");
    return (data as Row[]).map((r) => ({
      id: String(r.id),
      actorId: s(r.actor_id),
      action: String(r.action),
      targetType: String(r.target_type),
      targetId: s(r.target_id),
      sanitizedMetadata: (r.sanitized_metadata as Record<string, unknown>) ?? {},
      createdAt: String(r.created_at),
    }));
  }

  async hitRateLimit(key: string, windowSeconds: number, max: number) {
    const data = check(await this.db.rpc("hit_rate_limit", { p_key: key, p_window_seconds: windowSeconds, p_max: max }), "hit_rate_limit");
    return Boolean(data);
  }

  async getBudgetDay(day: string): Promise<BudgetDay | null> {
    const data = check(await this.db.from("budget_days").select("*").eq("day", day).maybeSingle(), "getBudgetDay") as Row | null;
    return data ? { day: String(data.day), reservedMinor: Number(data.reserved_minor), spentMinor: Number(data.spent_minor) } : null;
  }

  async adminStats(currency: string): Promise<AdminStats> {
    const data = check(await this.db.rpc("admin_stats"), "admin_stats") as {
      by_status: Record<string, number>;
      estimated_cost_minor: number;
      actual_cost_minor: number;
      failures_24h: number;
      budget_today: { day: string; reserved_minor: number; spent_minor: number } | null;
    };
    return {
      generationsByStatus: data.by_status ?? {},
      estimatedCostMinor: Number(data.estimated_cost_minor),
      actualCostMinor: Number(data.actual_cost_minor),
      currency,
      failures24h: Number(data.failures_24h),
      needsReconciliation: Number(data.by_status?.needs_reconciliation ?? 0),
      budgetToday: data.budget_today
        ? { day: data.budget_today.day, reservedMinor: Number(data.budget_today.reserved_minor), spentMinor: Number(data.budget_today.spent_minor) }
        : null,
    };
  }

  async deleteUserData(userId: string) {
    const paths = check(await this.db.rpc("delete_user_data", { p_user: userId }), "delete_user_data") as string[];
    return { storagePaths: paths ?? [] };
  }
}
