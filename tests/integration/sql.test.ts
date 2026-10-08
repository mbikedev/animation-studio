import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDatabase, createUser } from "../helpers/pglite";

let db: PGlite;

async function seed(db: PGlite, credits: number) {
  const user = await createUser(db, `${crypto.randomUUID()}@example.test`);
  const admin = await createUser(db, `${crypto.randomUUID()}@example.test`);
  await db.query("select public.grant_admin($1)", [admin]);
  if (credits) await db.query("select public.admin_adjust_credits($1, $2, $3, 'seed', $4)", [admin, user, credits, `seed:${user}`]);
  const project = (await db.query<{ id: string }>("insert into public.projects (owner_id, title) values ($1, 'P') returning id", [user])).rows[0].id;
  const image = (
    await db.query<{ id: string }>(
      "insert into public.assets (owner_id, project_id, kind, bucket, storage_path, status) values ($1, $2, 'image', 'media', $3, 'ready') returning id",
      [user, project, `${user}/image/${crypto.randomUUID()}`],
    )
  ).rows[0].id;
  const audio = (
    await db.query<{ id: string }>(
      "insert into public.assets (owner_id, project_id, kind, bucket, storage_path, status, duration_ms) values ($1, $2, 'audio', 'media', $3, 'ready', 3000) returning id",
      [user, project, `${user}/audio/${crypto.randomUUID()}`],
    )
  ).rows[0].id;
  return { user, admin, project, image, audio };
}

function reserveParams(s: Awaited<ReturnType<typeof seed>>, key: string, credits = 5, extra: Record<string, unknown> = {}) {
  return {
    owner_id: s.user,
    project_id: s.project,
    image_asset_id: s.image,
    audio_asset_id: s.audio,
    provider: "demo",
    model_id: "m",
    parameters: { aspectRatio: "16:9" },
    credits,
    price_version: "v1",
    estimated_cost_minor: 15,
    currency: "USD",
    idempotency_key: key,
    max_concurrent_jobs: 3,
    daily_budget_minor: "",
    budget_day: "2026-10-08",
    ...extra,
  };
}

async function reserve(params: object) {
  return (await db.query<{ r: { ok: boolean; reason?: string; created?: boolean; generation_id?: string } }>("select public.reserve_generation($1) r", [params])).rows[0].r;
}

async function account(user: string) {
  return (await db.query<{ available_credits: number; reserved_credits: number }>("select available_credits, reserved_credits from public.credit_accounts where user_id = $1", [user])).rows[0];
}

beforeAll(async () => {
  db = await createTestDatabase();
});

describe("SQL credit functions", () => {
  it("reservation is idempotent per user and submission", async () => {
    const s = await seed(db, 100);
    const a = await reserve(reserveParams(s, "k1"));
    const b = await reserve(reserveParams(s, "k1"));
    expect(a).toMatchObject({ ok: true, created: true });
    expect(b).toMatchObject({ ok: true, created: false, generation_id: a.generation_id });
    expect(await account(s.user)).toEqual({ available_credits: 95, reserved_credits: 5 });
    const outbox = await db.query("select * from public.job_outbox where generation_id = $1", [a.generation_id]);
    expect(outbox.rows).toHaveLength(1);
  });

  it("refuses insufficient credits, foreign assets and budget overrun", async () => {
    const s = await seed(db, 4);
    expect(await reserve(reserveParams(s, "k2"))).toMatchObject({ ok: false, reason: "insufficient_credits" });
    const other = await seed(db, 0);
    expect(await reserve({ ...reserveParams(s, "k3", 1), image_asset_id: other.image })).toMatchObject({ ok: false, reason: "invalid_assets" });
    expect(await reserve(reserveParams(s, "k4", 1, { daily_budget_minor: "10" }))).toMatchObject({ ok: false, reason: "daily_budget_exceeded" });
  });

  it("settles exactly once and keeps terminal states immutable", async () => {
    const s = await seed(db, 100);
    const { generation_id: id } = await reserve(reserveParams(s, "k5"));
    await db.query("select * from public.transition_generation($1, array['queued'], 'submitting', '{}'::jsonb)", [id]);
    await db.query(`select * from public.transition_generation($1, array['submitting'], 'processing', '{"provider_job_id":"job_1"}'::jsonb)`, [id]);
    await db.query("select * from public.transition_generation($1, array['processing'], 'storing', '{}'::jsonb)", [id]);
    const out = (
      await db.query<{ id: string }>(
        "insert into public.assets (owner_id, project_id, kind, bucket, storage_path, status) values ($1, $2, 'video', 'media', $3, 'ready') returning id",
        [s.user, s.project, `${s.user}/video/${id}`],
      )
    ).rows[0].id;
    await db.query("select public.complete_generation($1, $2, 140)", [id, out]);
    await db.query("select public.complete_generation($1, $2, 140)", [id, out]);
    await db.query("select public.fail_generation($1, 'failed', 'late', 'late', null, null)", [id]);
    expect(await account(s.user)).toEqual({ available_credits: 95, reserved_credits: 0 });
    const consumes = await db.query("select * from public.credit_ledger where generation_id = $1 and event_type = 'consume'", [id]);
    expect(consumes.rows).toHaveLength(1);
    await expect(db.query("update public.generations set status = 'failed' where id = $1", [id])).rejects.toThrow(/immutable/);
    const budget = (await db.query<{ reserved_minor: number; spent_minor: number }>("select reserved_minor::int, spent_minor::int from public.budget_days where day = '2026-10-08'")).rows[0];
    expect(budget.spent_minor).toBeGreaterThanOrEqual(140);
  });

  it("releases exactly once on failure and rejects invalid transitions", async () => {
    const s = await seed(db, 100);
    const { generation_id: id } = await reserve(reserveParams(s, "k6"));
    await db.query("select public.fail_generation($1, 'failed', 'x', 'x', 0, null)", [id]);
    await db.query("select public.fail_generation($1, 'failed', 'x', 'x', 0, null)", [id]);
    expect(await account(s.user)).toEqual({ available_credits: 100, reserved_credits: 0 });

    const { generation_id: id2 } = await reserve(reserveParams(s, "k7"));
    await expect(db.query("select * from public.transition_generation($1, array['queued'], 'storing', '{}'::jsonb)", [id2])).rejects.toThrow(/invalid generation transition/);
  });

  it("compare-and-set transition with expected attempts claims a retry once", async () => {
    const s = await seed(db, 100);
    const { generation_id: id } = await reserve(reserveParams(s, "k8"));
    await db.query(`select * from public.transition_generation($1, array['queued'], 'submitting', '{"attempts":1}'::jsonb)`, [id]);
    const first = await db.query(`select * from public.transition_generation($1, array['submitting'], 'submitting', '{"attempts":2}'::jsonb, 1)`, [id]);
    const second = await db.query(`select * from public.transition_generation($1, array['submitting'], 'submitting', '{"attempts":2}'::jsonb, 1)`, [id]);
    expect(first.rows).toHaveLength(1);
    expect(second.rows).toHaveLength(0);
  });

  it("purchases are credited once and reversals never go negative", async () => {
    const s = await seed(db, 0);
    const pack = "00000000-0000-4000-8000-000000000101";
    const purchase = (
      await db.query<{ id: string }>(
        "insert into public.purchases (user_id, pack_id, credits_snapshot, currency, amount_minor) values ($1, $2, 100, 'EUR', 500) returning id",
        [s.user, pack],
      )
    ).rows[0].id;
    await expect(db.query("select public.fulfill_purchase($1, 'cs_1', 400, 'eur')", [purchase])).rejects.toThrow(/amount mismatch/);
    const r1 = (await db.query<{ r: boolean }>("select public.fulfill_purchase($1, 'cs_1', 500, 'eur') r", [purchase])).rows[0].r;
    const r2 = (await db.query<{ r: boolean }>("select public.fulfill_purchase($1, 'cs_1', 500, 'eur') r", [purchase])).rows[0].r;
    expect([r1, r2]).toEqual([true, false]);
    expect(await account(s.user)).toEqual({ available_credits: 100, reserved_credits: 0 });
    // spend 70, then refund: only 30 can be taken back
    await db.query("select public.admin_adjust_credits($1, $2, -70, 'spent elsewhere', 'spend1')", [s.admin, s.user]);
    const rev = (await db.query<{ r: { reversed: number; uncovered: number } }>("select public.reverse_purchase($1, 'refunded') r", [purchase])).rows[0].r;
    expect(rev).toEqual({ reversed: 30, uncovered: 70 });
    const rev2 = (await db.query<{ r: { reversed: number; uncovered: number } }>("select public.reverse_purchase($1, 'refunded') r", [purchase])).rows[0].r;
    expect(rev2).toEqual({ reversed: 30, uncovered: 70 });
    expect(await account(s.user)).toEqual({ available_credits: 0, reserved_credits: 0 });
  });

  it("webhook events are recorded once per provider/event id", async () => {
    const a = (await db.query<{ r: boolean }>("select public.record_webhook_event('stripe', 'evt_1', 'h') r")).rows[0].r;
    const b = (await db.query<{ r: boolean }>("select public.record_webhook_event('stripe', 'evt_1', 'h2') r")).rows[0].r;
    expect([a, b]).toEqual([true, false]);
  });

  it("rate limit window counts hits", async () => {
    const key = `k:${crypto.randomUUID()}`;
    const results = [];
    for (let i = 0; i < 4; i++) results.push((await db.query<{ r: boolean }>("select public.hit_rate_limit($1, 60, 3) r", [key])).rows[0].r);
    expect(results).toEqual([true, true, true, false]);
  });

  it("admin adjustments require an admin actor and a reason", async () => {
    const s = await seed(db, 0);
    await expect(db.query("select public.admin_adjust_credits($1, $1, 10, 'self credit', 'x1')", [s.user])).rejects.toThrow(/not admin/);
    await expect(db.query("select public.admin_adjust_credits($1, $2, 10, '', 'x2')", [s.admin, s.user])).rejects.toThrow(/reason/);
  });
});

describe("RLS isolation", () => {
  it("user A cannot read or modify user B's data", async () => {
    const a = await seed(db, 10);
    const b = await seed(db, 10);
    await asUser(db, a.user, async () => {
      const projects = await db.query<{ owner_id: string }>("select owner_id from public.projects");
      expect(projects.rows.every((p) => p.owner_id === a.user)).toBe(true);
      expect((await db.query("select * from public.assets where owner_id = $1", [b.user])).rows).toHaveLength(0);
      expect((await db.query("select * from public.credit_accounts where user_id = $1", [b.user])).rows).toHaveLength(0);
      const upd = await db.query("update public.projects set title = 'pwned' where owner_id = $1", [b.user]);
      expect(upd.affectedRows ?? 0).toBe(0);
      await expect(db.query("insert into public.projects (owner_id, title) values ($1, 'x')", [b.user])).rejects.toThrow();
      expect((await db.query("select * from storage.objects")).rows).toHaveLength(0);
    });
  });

  it("a client cannot promote itself or credit its balance", async () => {
    const a = await seed(db, 0);
    await asUser(db, a.user, async () => {
      await expect(db.query("insert into public.user_roles (user_id, role) values ($1, 'admin')", [a.user])).rejects.toThrow(/permission denied/);
      await expect(db.query("update public.credit_accounts set available_credits = 9999 where user_id = $1", [a.user])).rejects.toThrow(/permission denied/);
      await expect(db.query("insert into public.credit_ledger (user_id, event_type, available_delta, reserved_delta, idempotency_key) values ($1, 'purchase', 999, 0, 'x')", [a.user])).rejects.toThrow(/permission denied/);
      await expect(db.query("select public.grant_admin($1)", [a.user])).rejects.toThrow(/permission denied/);
      await expect(db.query("select public.admin_adjust_credits($1, $1, 999, 'hack', 'h')", [a.user])).rejects.toThrow(/permission denied/);
      await expect(db.query("update public.purchases set payment_status = 'paid'")).rejects.toThrow(/permission denied/);
      await expect(db.query("update public.generations set actual_cost_minor = 0")).rejects.toThrow(/permission denied/);
      // Allowed: own profile display name.
      await db.query("update public.profiles set display_name = 'Moi' where id = $1", [a.user]);
    });
    const roles = await db.query("select * from public.user_roles where user_id = $1", [a.user]);
    expect(roles.rows).toHaveLength(0);
  });
});
