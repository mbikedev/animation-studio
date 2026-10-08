import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  AppError,
  TERMINAL_STATUSES,
  type Asset,
  type AuditLog,
  type CreditAccount,
  type CreditPack,
  type Generation,
  type GenerationStatus,
  type LedgerEntry,
  type LedgerEventType,
  type OutboxItem,
  type PaymentStatus,
  type Project,
  type Purchase,
} from "@/lib/domain";
import { canTransition } from "@/lib/generation/state-machine";
import type { AdminStats, AdminUserRow, BudgetDay, ReserveGenerationInput, ReserveResult, Store } from "./types";

/**
 * Demo persistence: a JSON file under DEMO_DATA_DIR, every operation
 * serialized through a promise-chain mutex so that credit and status
 * invariants hold exactly like the row-locked SQL functions in live mode.
 * Limited persistence: wiping the folder resets the demo.
 */

export interface DemoUser {
  id: string;
  email: string;
  passwordHash: string;
  emailConfirmed: boolean;
  confirmToken: string | null;
  resetToken: string | null;
  resetTokenExpiresAt: string | null;
  createdAt: string;
}

interface DemoState {
  version: 1;
  users: DemoUser[];
  profiles: Array<{ id: string; email: string; displayName: string | null; locale: string; createdAt: string }>;
  roles: Array<{ userId: string; role: "admin" }>;
  projects: Project[];
  assets: Asset[];
  generations: Array<Generation & { idempotencyKey: string; budgetDay: string; deletedAt: string | null }>;
  accounts: CreditAccount[];
  ledger: LedgerEntry[];
  packs: CreditPack[];
  purchases: Purchase[];
  webhookEvents: Array<{ provider: string; eventId: string; payloadHash: string; processedAt: string }>;
  outbox: OutboxItem[];
  audit: AuditLog[];
  rateLimits: Record<string, { windowStart: number; count: number }>;
  budgetDays: BudgetDay[];
}

const ACTIVE: GenerationStatus[] = ["queued", "preparing_audio", "submitting", "processing", "storing", "needs_reconciliation"];

export const DEMO_PACKS: CreditPack[] = [
  { id: "00000000-0000-4000-8000-000000000101", name: "Découverte", credits: 100, stripePriceId: null, amountMinor: 500, currency: "EUR", active: true },
  { id: "00000000-0000-4000-8000-000000000102", name: "Créateur", credits: 500, stripePriceId: null, amountMinor: 2000, currency: "EUR", active: true },
];

function emptyState(): DemoState {
  return {
    version: 1,
    users: [],
    profiles: [],
    roles: [],
    projects: [],
    assets: [],
    generations: [],
    accounts: [],
    ledger: [],
    packs: DEMO_PACKS.map((p) => ({ ...p })),
    purchases: [],
    webhookEvents: [],
    outbox: [],
    audit: [],
    rateLimits: {},
    budgetDays: [],
  };
}

const nowIso = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();
const clone = <T>(v: T): T => structuredClone(v);

export class DemoStore implements Store {
  readonly kind = "demo" as const;
  private state: DemoState;
  private chain: Promise<unknown> = Promise.resolve();
  private loadedMtime = 0;
  private readonly file: string | null;

  /** `dataDir = null` keeps everything in memory (tests). */
  constructor(dataDir: string | null) {
    this.file = dataDir ? path.join(dataDir, "demo-db.json") : null;
    this.state = emptyState();
    this.reloadIfChanged();
  }

  private reloadIfChanged() {
    if (!this.file) return;
    try {
      const mtime = statSync(this.file).mtimeMs;
      if (mtime > this.loadedMtime) {
        this.state = { ...emptyState(), ...JSON.parse(readFileSync(this.file, "utf8")) };
        this.loadedMtime = mtime;
      }
    } catch {
      // no file yet
    }
  }

  private persist() {
    if (!this.file) return;
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state));
    renameSync(tmp, this.file);
    this.loadedMtime = statSync(this.file).mtimeMs;
  }

  /** Serializes every operation; mutations are persisted atomically. */
  private run<T>(fn: (s: DemoState) => T, mutate = true): Promise<T> {
    const next = this.chain.then(() => {
      this.reloadIfChanged();
      const snapshot = mutate ? clone(this.state) : null;
      try {
        const result = fn(this.state);
        if (mutate) this.persist();
        return clone(result);
      } catch (error) {
        if (snapshot) this.state = snapshot; // rollback
        throw error;
      }
    });
    this.chain = next.catch(() => undefined);
    return next;
  }

  // ---- demo auth helpers (used only by the demo auth module) ----

  demoFindUserByEmail(email: string) {
    return this.run((s) => s.users.find((u) => u.email === email.toLowerCase()) ?? null, false);
  }

  demoFindUserById(id: string) {
    return this.run((s) => s.users.find((u) => u.id === id) ?? null, false);
  }

  demoCreateUser(email: string, passwordHash: string, confirmToken: string) {
    return this.run((s) => {
      const normalized = email.toLowerCase();
      if (s.users.some((u) => u.email === normalized)) throw new AppError("email_taken", "Un compte existe déjà avec cet email.", 409);
      const user: DemoUser = {
        id: uuid(),
        email: normalized,
        passwordHash,
        emailConfirmed: false,
        confirmToken,
        resetToken: null,
        resetTokenExpiresAt: null,
        createdAt: nowIso(),
      };
      s.users.push(user);
      return user;
    });
  }

  demoUpdateUser(id: string, patch: Partial<DemoUser>) {
    return this.run((s) => {
      const user = s.users.find((u) => u.id === id);
      if (!user) throw new AppError("not_found", "Utilisateur introuvable.", 404);
      Object.assign(user, patch);
      return user;
    });
  }

  /** Demo/test helper: grants the admin role to a profile id. */
  grantAdminRole(userId: string) {
    return this.run((s) => {
      if (!s.roles.some((r) => r.userId === userId)) s.roles.push({ userId, role: "admin" });
    });
  }

  demoGrantAdmin(email: string) {
    return this.run((s) => {
      const user = s.users.find((u) => u.email === email.toLowerCase());
      if (!user) throw new AppError("not_found", "Utilisateur introuvable.", 404);
      if (!s.roles.some((r) => r.userId === user.id)) s.roles.push({ userId: user.id, role: "admin" });
      s.audit.push({
        id: uuid(),
        actorId: null,
        action: "role.grant_admin",
        targetType: "user",
        targetId: user.id,
        sanitizedMetadata: { via: "cli" },
        createdAt: nowIso(),
      });
      return user.id;
    });
  }

  // ---- internal helpers ----

  private account(s: DemoState, userId: string): CreditAccount {
    let acc = s.accounts.find((a) => a.userId === userId);
    if (!acc) {
      acc = { userId, availableCredits: 0, reservedCredits: 0 };
      s.accounts.push(acc);
    }
    return acc;
  }

  private ledger(
    s: DemoState,
    entry: { userId: string; generationId: string | null; eventType: LedgerEventType; availableDelta: number; reservedDelta: number; idempotencyKey: string; metadata?: Record<string, unknown> },
  ): boolean {
    if (s.ledger.some((l) => l.idempotencyKey === entry.idempotencyKey)) return false;
    const acc = this.account(s, entry.userId);
    const available = acc.availableCredits + entry.availableDelta;
    const reserved = acc.reservedCredits + entry.reservedDelta;
    if (available < 0 || reserved < 0) throw new AppError("negative_balance", "Opération refusée : solde négatif.", 409);
    acc.availableCredits = available;
    acc.reservedCredits = reserved;
    s.ledger.push({ id: uuid(), createdAt: nowIso(), metadata: {}, ...entry });
    return true;
  }

  private budget(s: DemoState, day: string): BudgetDay {
    let b = s.budgetDays.find((d) => d.day === day);
    if (!b) {
      b = { day, reservedMinor: 0, spentMinor: 0 };
      s.budgetDays.push(b);
    }
    return b;
  }

  private gen(s: DemoState, id: string) {
    const g = s.generations.find((x) => x.id === id);
    if (!g) throw new AppError("not_found", "Génération introuvable.", 404);
    return g;
  }

  private publicGen(g: DemoState["generations"][number]): Generation {
    const rest: Partial<DemoState["generations"][number]> = { ...g };
    delete rest.idempotencyKey;
    delete rest.budgetDay;
    delete rest.deletedAt;
    return rest as Generation;
  }

  // ---- Store implementation ----

  ensureProfile(user: { id: string; email: string }, signupBonus: number) {
    return this.run((s) => {
      if (!s.profiles.some((p) => p.id === user.id)) {
        s.profiles.push({ id: user.id, email: user.email, displayName: null, locale: "fr", createdAt: nowIso() });
      }
      this.account(s, user.id);
      if (signupBonus > 0) {
        this.ledger(s, {
          userId: user.id,
          generationId: null,
          eventType: "signup_bonus",
          availableDelta: signupBonus,
          reservedDelta: 0,
          idempotencyKey: `signup_bonus:${user.id}`,
        });
      }
    });
  }

  isAdmin(userId: string) {
    return this.run((s) => s.roles.some((r) => r.userId === userId && r.role === "admin"), false);
  }

  listUsers(limit: number) {
    return this.run(
      (s) =>
        s.profiles.slice(0, limit).map<AdminUserRow>((p) => {
          const acc = s.accounts.find((a) => a.userId === p.id);
          return {
            userId: p.id,
            email: p.email,
            displayName: p.displayName,
            isAdmin: s.roles.some((r) => r.userId === p.id),
            availableCredits: acc?.availableCredits ?? 0,
            reservedCredits: acc?.reservedCredits ?? 0,
            generations: s.generations.filter((g) => g.ownerId === p.id).length,
            createdAt: p.createdAt,
          };
        }),
      false,
    );
  }

  listProjects(ownerId: string) {
    return this.run(
      (s) => s.projects.filter((p) => p.ownerId === ownerId && !p.deletedAt).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      false,
    );
  }

  getProject(ownerId: string, projectId: string) {
    return this.run((s) => s.projects.find((p) => p.id === projectId && p.ownerId === ownerId && !p.deletedAt) ?? null, false);
  }

  createProject(ownerId: string, title: string) {
    return this.run((s) => {
      const p: Project = { id: uuid(), ownerId, title, createdAt: nowIso(), updatedAt: nowIso(), deletedAt: null };
      s.projects.push(p);
      return p;
    });
  }

  renameProject(ownerId: string, projectId: string, title: string) {
    return this.run((s) => {
      const p = s.projects.find((x) => x.id === projectId && x.ownerId === ownerId && !x.deletedAt);
      if (!p) return null;
      p.title = title;
      p.updatedAt = nowIso();
      return p;
    });
  }

  softDeleteProject(ownerId: string, projectId: string) {
    return this.run((s) => {
      const p = s.projects.find((x) => x.id === projectId && x.ownerId === ownerId && !x.deletedAt);
      if (!p) return false;
      const active = s.generations.some((g) => g.projectId === projectId && ACTIVE.includes(g.status));
      if (active) throw new AppError("project_busy", "Une génération est en cours dans ce projet.", 409);
      p.deletedAt = nowIso();
      return true;
    });
  }

  createAsset(a: Parameters<Store["createAsset"]>[0]) {
    return this.run((s) => {
      if (a.projectId && !s.projects.some((p) => p.id === a.projectId && p.ownerId === a.ownerId && !p.deletedAt)) {
        throw new AppError("invalid_project", "Projet introuvable.", 404);
      }
      const asset: Asset = {
        id: uuid(),
        ownerId: a.ownerId,
        projectId: a.projectId,
        kind: a.kind,
        bucket: a.bucket,
        storagePath: a.storagePath,
        mimeType: a.mimeType ?? null,
        sizeBytes: null,
        durationMs: null,
        width: null,
        height: null,
        checksum: null,
        status: "pending_upload",
        createdAt: nowIso(),
      };
      s.assets.push(asset);
      return asset;
    });
  }

  getAsset(ownerId: string, assetId: string) {
    return this.run((s) => s.assets.find((a) => a.id === assetId && a.ownerId === ownerId) ?? null, false);
  }

  getAssetById(assetId: string) {
    return this.run((s) => s.assets.find((a) => a.id === assetId) ?? null, false);
  }

  getAssetByPath(storagePath: string) {
    return this.run((s) => s.assets.find((a) => a.storagePath === storagePath) ?? null, false);
  }

  updateAsset(assetId: string, patch: Parameters<Store["updateAsset"]>[1]) {
    return this.run((s) => {
      const a = s.assets.find((x) => x.id === assetId);
      if (!a) throw new AppError("not_found", "Fichier introuvable.", 404);
      Object.assign(a, patch);
      return a;
    });
  }

  isAssetInUse(assetId: string) {
    return this.run(
      (s) =>
        s.generations.some(
          (g) => ACTIVE.includes(g.status) && (g.imageAssetId === assetId || g.audioAssetId === assetId || g.outputAssetId === assetId),
        ),
      false,
    );
  }

  listAssets(ownerId: string) {
    return this.run((s) => s.assets.filter((a) => a.ownerId === ownerId && a.status !== "deleted"), false);
  }

  reserveGeneration(input: ReserveGenerationInput) {
    return this.run<ReserveResult>((s) => {
      const existing = s.generations.find((g) => g.ownerId === input.ownerId && g.idempotencyKey === input.idempotencyKey);
      if (existing) return { ok: true, generation: this.publicGen(existing), created: false };

      const project = s.projects.find((p) => p.id === input.projectId && p.ownerId === input.ownerId && !p.deletedAt);
      const image = s.assets.find((a) => a.id === input.imageAssetId && a.ownerId === input.ownerId && a.status === "ready" && a.kind === "image");
      const audioOk =
        input.audioAssetId === null ||
        s.assets.some((a) => a.id === input.audioAssetId && a.ownerId === input.ownerId && a.status === "ready" && a.kind === "audio");
      if (!project || !image || !audioOk) return { ok: false, reason: "invalid_assets" };

      const active = s.generations.filter((g) => g.ownerId === input.ownerId && ACTIVE.includes(g.status)).length;
      if (active >= input.maxConcurrentJobs) return { ok: false, reason: "too_many_active_jobs" };

      const acc = this.account(s, input.ownerId);
      if (acc.availableCredits < input.credits) return { ok: false, reason: "insufficient_credits" };

      const budget = this.budget(s, input.budgetDay);
      if (input.dailyBudgetMinor !== null && budget.reservedMinor + budget.spentMinor + input.estimatedCostMinor > input.dailyBudgetMinor) {
        return { ok: false, reason: "daily_budget_exceeded" };
      }

      const now = nowIso();
      const generation: DemoState["generations"][number] = {
        id: uuid(),
        ownerId: input.ownerId,
        projectId: input.projectId,
        provider: input.provider,
        modelId: input.modelId,
        providerJobId: null,
        status: "queued",
        parameters: input.parameters,
        imageAssetId: input.imageAssetId,
        audioAssetId: input.audioAssetId,
        outputAssetId: null,
        reservedCredits: input.credits,
        priceVersion: input.priceVersion,
        estimatedCostMinor: input.estimatedCostMinor,
        actualCostMinor: null,
        currency: input.currency,
        errorCode: null,
        errorMessage: null,
        attempts: 0,
        nextCheckAt: now,
        createdAt: now,
        updatedAt: now,
        idempotencyKey: input.idempotencyKey,
        budgetDay: input.budgetDay,
        deletedAt: null,
      };
      s.generations.push(generation);
      this.ledger(s, {
        userId: input.ownerId,
        generationId: generation.id,
        eventType: "reserve",
        availableDelta: -input.credits,
        reservedDelta: input.credits,
        idempotencyKey: `reserve:${generation.id}`,
      });
      budget.reservedMinor += input.estimatedCostMinor;
      s.outbox.push({ id: uuid(), generationId: generation.id, dispatchStatus: "pending", attempts: 0, nextAttemptAt: now });
      project.updatedAt = now;
      return { ok: true, generation: this.publicGen(generation), created: true };
    });
  }

  getGeneration(ownerId: string, generationId: string) {
    return this.run((s) => {
      const g = s.generations.find((x) => x.id === generationId && x.ownerId === ownerId && !x.deletedAt);
      return g ? this.publicGen(g) : null;
    }, false);
  }

  getGenerationById(generationId: string) {
    return this.run((s) => {
      const g = s.generations.find((x) => x.id === generationId);
      return g ? this.publicGen(g) : null;
    }, false);
  }

  listGenerations(ownerId: string, opts?: { projectId?: string; limit?: number }) {
    return this.run(
      (s) =>
        s.generations
          .filter((g) => g.ownerId === ownerId && !g.deletedAt && (!opts?.projectId || g.projectId === opts.projectId))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, opts?.limit ?? 100)
          .map((g) => this.publicGen(g)),
      false,
    );
  }

  listAllGenerations(opts: { status?: GenerationStatus; limit: number }) {
    return this.run(
      (s) =>
        s.generations
          .filter((g) => !opts.status || g.status === opts.status)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, opts.limit)
          .map((g) => this.publicGen(g)),
      false,
    );
  }

  transitionGeneration(
    generationId: string,
    from: GenerationStatus[],
    to: GenerationStatus,
    patch?: Parameters<Store["transitionGeneration"]>[3],
    opts?: Parameters<Store["transitionGeneration"]>[4],
  ) {
    return this.run((s) => {
      const g = this.gen(s, generationId);
      if (!from.includes(g.status)) return null;
      if (opts?.expectedAttempts !== undefined && g.attempts !== opts.expectedAttempts) return null;
      if (TERMINAL_STATUSES.includes(to)) throw new Error("use completeGeneration/failGeneration for terminal states");
      if (!canTransition(g.status, to)) throw new AppError("invalid_transition", `Transition ${g.status} -> ${to} refusée.`, 409);
      Object.assign(g, patch ?? {}, { status: to, updatedAt: nowIso() });
      return this.publicGen(g);
    });
  }

  completeGeneration(generationId: string, outputAssetId: string, actualCostMinor: number | null) {
    return this.run((s) => {
      const g = this.gen(s, generationId);
      if (g.status === "succeeded") return this.publicGen(g);
      if (g.status !== "storing") throw new AppError("invalid_transition", `Transition ${g.status} -> succeeded refusée.`, 409);
      this.ledger(s, {
        userId: g.ownerId,
        generationId: g.id,
        eventType: "consume",
        availableDelta: 0,
        reservedDelta: -g.reservedCredits,
        idempotencyKey: `consume:${g.id}`,
      });
      const budget = this.budget(s, g.budgetDay);
      budget.reservedMinor = Math.max(0, budget.reservedMinor - g.estimatedCostMinor);
      budget.spentMinor += actualCostMinor ?? g.estimatedCostMinor;
      Object.assign(g, { status: "succeeded", outputAssetId, actualCostMinor, nextCheckAt: null, updatedAt: nowIso() });
      return this.publicGen(g);
    });
  }

  failGeneration(generationId: string, params: Parameters<Store["failGeneration"]>[1]) {
    return this.run((s) => {
      const g = this.gen(s, generationId);
      if (TERMINAL_STATUSES.includes(g.status)) return this.publicGen(g);
      if (!canTransition(g.status, params.status)) {
        throw new AppError("invalid_transition", `Transition ${g.status} -> ${params.status} refusée.`, 409);
      }
      this.ledger(s, {
        userId: g.ownerId,
        generationId: g.id,
        eventType: "release",
        availableDelta: g.reservedCredits,
        reservedDelta: -g.reservedCredits,
        idempotencyKey: `release:${g.id}`,
        metadata: { errorCode: params.errorCode },
      });
      const budget = this.budget(s, g.budgetDay);
      budget.reservedMinor = Math.max(0, budget.reservedMinor - g.estimatedCostMinor);
      budget.spentMinor += params.providerCostMinor ?? 0;
      Object.assign(g, {
        status: params.status,
        errorCode: params.errorCode,
        errorMessage: params.errorMessage,
        actualCostMinor: params.providerCostMinor,
        nextCheckAt: null,
        updatedAt: nowIso(),
      });
      return this.publicGen(g);
    });
  }

  listDueGenerations(now: string, limit: number) {
    return this.run(
      (s) =>
        s.generations
          .filter((g) => ACTIVE.includes(g.status) && g.status !== "needs_reconciliation" && g.nextCheckAt !== null && g.nextCheckAt <= now)
          .slice(0, limit)
          .map((g) => this.publicGen(g)),
      false,
    );
  }

  softDeleteGeneration(ownerId: string, generationId: string) {
    return this.run((s) => {
      const g = s.generations.find((x) => x.id === generationId && x.ownerId === ownerId && !x.deletedAt);
      if (!g) return false;
      if (!TERMINAL_STATUSES.includes(g.status)) throw new AppError("generation_active", "Génération en cours : suppression impossible.", 409);
      g.deletedAt = nowIso();
      return true;
    });
  }

  claimOutbox(now: string, limit: number) {
    return this.run((s) => {
      const items = s.outbox.filter((o) => o.dispatchStatus !== "dispatched" && o.nextAttemptAt <= now).slice(0, limit);
      for (const item of items) {
        item.attempts += 1;
        // Lease: hide the row for 60s while this dispatcher works on it.
        item.nextAttemptAt = new Date(Date.parse(now) + 60_000).toISOString();
      }
      return items;
    });
  }

  markOutboxDispatched(outboxId: string) {
    return this.run((s) => {
      const o = s.outbox.find((x) => x.id === outboxId);
      if (o) o.dispatchStatus = "dispatched";
    });
  }

  markOutboxFailed(outboxId: string, nextAttemptAt: string) {
    return this.run((s) => {
      const o = s.outbox.find((x) => x.id === outboxId);
      if (o) {
        o.dispatchStatus = "failed";
        o.nextAttemptAt = nextAttemptAt;
      }
    });
  }

  getCreditAccount(userId: string) {
    return this.run((s) => s.accounts.find((a) => a.userId === userId) ?? { userId, availableCredits: 0, reservedCredits: 0 }, false);
  }

  listLedger(userId: string, limit: number) {
    return this.run(
      (s) => s.ledger.filter((l) => l.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit),
      false,
    );
  }

  adminAdjustCredits(params: Parameters<Store["adminAdjustCredits"]>[0]) {
    return this.run((s) => {
      if (params.reason.trim().length < 3) throw new AppError("reason_required", "Motif requis.", 400);
      if (!s.roles.some((r) => r.userId === params.actorId && r.role === "admin")) throw new AppError("forbidden", "Action réservée aux administrateurs.", 403);
      if (!s.profiles.some((p) => p.id === params.userId)) throw new AppError("not_found", "Utilisateur introuvable.", 404);
      const applied = this.ledger(s, {
        userId: params.userId,
        generationId: null,
        eventType: "admin_adjustment",
        availableDelta: params.delta,
        reservedDelta: 0,
        idempotencyKey: params.idempotencyKey,
        metadata: { reason: params.reason, actorId: params.actorId },
      });
      if (applied) {
        s.audit.push({
          id: uuid(),
          actorId: params.actorId,
          action: "credits.adjust",
          targetType: "user",
          targetId: params.userId,
          sanitizedMetadata: { delta: params.delta, reason: params.reason },
          createdAt: nowIso(),
        });
      }
      return this.account(s, params.userId);
    });
  }

  listPacks() {
    return this.run((s) => s.packs.filter((p) => p.active), false);
  }

  getPack(packId: string) {
    return this.run((s) => s.packs.find((p) => p.id === packId && p.active) ?? null, false);
  }

  createPurchase(params: { userId: string; pack: CreditPack }) {
    return this.run((s) => {
      const p: Purchase = {
        id: uuid(),
        userId: params.userId,
        packId: params.pack.id,
        creditsSnapshot: params.pack.credits,
        stripeSessionId: null,
        paymentStatus: "pending",
        currency: params.pack.currency,
        amountMinor: params.pack.amountMinor,
        creditedAt: null,
        createdAt: nowIso(),
      };
      s.purchases.push(p);
      return p;
    });
  }

  attachCheckoutSession(purchaseId: string, sessionId: string) {
    return this.run((s) => {
      const p = s.purchases.find((x) => x.id === purchaseId);
      if (!p) throw new AppError("not_found", "Achat introuvable.", 404);
      if (s.purchases.some((x) => x.stripeSessionId === sessionId && x.id !== purchaseId)) throw new AppError("duplicate_session", "Session déjà utilisée.", 409);
      p.stripeSessionId = sessionId;
    });
  }

  getPurchase(purchaseId: string) {
    return this.run((s) => s.purchases.find((p) => p.id === purchaseId) ?? null, false);
  }

  getPurchaseBySession(sessionId: string) {
    return this.run((s) => s.purchases.find((p) => p.stripeSessionId === sessionId) ?? null, false);
  }

  listPurchases(userId: string) {
    return this.run((s) => s.purchases.filter((p) => p.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), false);
  }

  fulfillPurchase(purchaseId: string, params: { sessionId: string; amountMinor: number; currency: string }) {
    return this.run((s) => {
      const p = s.purchases.find((x) => x.id === purchaseId);
      if (!p) throw new AppError("not_found", "Achat introuvable.", 404);
      if (p.stripeSessionId && p.stripeSessionId !== params.sessionId) throw new AppError("session_mismatch", "Session incohérente.", 409);
      if (p.amountMinor !== params.amountMinor || p.currency.toUpperCase() !== params.currency.toUpperCase()) {
        throw new AppError("amount_mismatch", "Montant payé différent du pack.", 409);
      }
      if (p.creditedAt) return { credited: false };
      const applied = this.ledger(s, {
        userId: p.userId,
        generationId: null,
        eventType: "purchase",
        availableDelta: p.creditsSnapshot,
        reservedDelta: 0,
        idempotencyKey: `purchase:${p.id}`,
        metadata: { packId: p.packId },
      });
      p.stripeSessionId = params.sessionId;
      p.paymentStatus = "paid";
      p.creditedAt = nowIso();
      return { credited: applied };
    });
  }

  setPurchaseStatus(purchaseId: string, status: PaymentStatus) {
    return this.run((s) => {
      const p = s.purchases.find((x) => x.id === purchaseId);
      if (!p) throw new AppError("not_found", "Achat introuvable.", 404);
      // Never downgrade a credited purchase through this path.
      if (p.creditedAt && (status === "pending" || status === "async_pending" || status === "failed" || status === "expired")) return;
      p.paymentStatus = status;
    });
  }

  reversePurchase(purchaseId: string, status: "refunded" | "disputed") {
    return this.run((s) => {
      const p = s.purchases.find((x) => x.id === purchaseId);
      if (!p) throw new AppError("not_found", "Achat introuvable.", 404);
      p.paymentStatus = status;
      if (!p.creditedAt) return { reversedCredits: 0, uncoveredCredits: 0 };
      const key = `reversal:${p.id}`;
      const already = s.ledger.find((l) => l.idempotencyKey === key);
      if (already) return { reversedCredits: -already.availableDelta, uncoveredCredits: Number(already.metadata.uncovered ?? 0) };
      const acc = this.account(s, p.userId);
      const reversed = Math.min(acc.availableCredits, p.creditsSnapshot);
      const uncovered = p.creditsSnapshot - reversed;
      this.ledger(s, {
        userId: p.userId,
        generationId: null,
        eventType: "refund_reversal",
        availableDelta: -reversed,
        reservedDelta: 0,
        idempotencyKey: key,
        metadata: { status, uncovered },
      });
      s.audit.push({
        id: uuid(),
        actorId: null,
        action: `purchase.${status}`,
        targetType: "purchase",
        targetId: p.id,
        sanitizedMetadata: { reversed, uncovered },
        createdAt: nowIso(),
      });
      return { reversedCredits: reversed, uncoveredCredits: uncovered };
    });
  }

  recordWebhookEvent(provider: string, eventId: string, payloadHash: string) {
    return this.run((s) => {
      if (s.webhookEvents.some((e) => e.provider === provider && e.eventId === eventId)) return false;
      s.webhookEvents.push({ provider, eventId, payloadHash, processedAt: nowIso() });
      return true;
    });
  }

  audit(entry: Omit<AuditLog, "id" | "createdAt">) {
    return this.run((s) => {
      s.audit.push({ ...entry, id: uuid(), createdAt: nowIso() });
    });
  }

  listAudit(limit: number) {
    return this.run((s) => [...s.audit].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit), false);
  }

  hitRateLimit(key: string, windowSeconds: number, max: number) {
    return this.run((s) => {
      const now = Date.now();
      const windowStart = Math.floor(now / (windowSeconds * 1000)) * windowSeconds * 1000;
      const entry = s.rateLimits[key];
      if (!entry || entry.windowStart !== windowStart) {
        s.rateLimits[key] = { windowStart, count: 1 };
        return true;
      }
      entry.count += 1;
      return entry.count <= max;
    });
  }

  getBudgetDay(day: string) {
    return this.run((s) => s.budgetDays.find((b) => b.day === day) ?? null, false);
  }

  adminStats(currency: string) {
    return this.run<AdminStats>((s) => {
      const byStatus: Record<string, number> = {};
      let est = 0;
      let actual = 0;
      const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
      for (const g of s.generations) {
        byStatus[g.status] = (byStatus[g.status] ?? 0) + 1;
        est += g.estimatedCostMinor;
        actual += g.actualCostMinor ?? 0;
      }
      const today = new Date().toISOString().slice(0, 10);
      const b = s.budgetDays.find((d) => d.day === today);
      return {
        generationsByStatus: byStatus,
        estimatedCostMinor: est,
        actualCostMinor: actual,
        currency,
        failures24h: s.generations.filter((g) => g.status === "failed" && g.updatedAt >= dayAgo).length,
        needsReconciliation: byStatus.needs_reconciliation ?? 0,
        budgetToday: b ? { day: b.day, reservedMinor: b.reservedMinor, spentMinor: b.spentMinor } : null,
      };
    }, false);
  }

  deleteUserData(userId: string) {
    return this.run((s) => {
      if (s.generations.some((g) => g.ownerId === userId && ACTIVE.includes(g.status))) {
        throw new AppError("generation_active", "Une génération est en cours : réessayez après sa fin.", 409);
      }
      const storagePaths = s.assets.filter((a) => a.ownerId === userId).map((a) => a.storagePath);
      s.assets = s.assets.filter((a) => a.ownerId !== userId);
      s.projects = s.projects.filter((p) => p.ownerId !== userId);
      // Billing/audit records are kept (anonymised by user id only) per policy.
      for (const g of s.generations) {
        if (g.ownerId === userId) {
          g.parameters = { ...g.parameters, prompt: "", voiceText: undefined };
          g.deletedAt = g.deletedAt ?? nowIso();
        }
      }
      s.profiles = s.profiles.filter((p) => p.id !== userId);
      s.roles = s.roles.filter((r) => r.userId !== userId);
      s.users = s.users.filter((u) => u.id !== userId);
      s.audit.push({ id: uuid(), actorId: userId, action: "account.delete", targetType: "user", targetId: userId, sanitizedMetadata: {}, createdAt: nowIso() });
      return { storagePaths };
    });
  }
}
