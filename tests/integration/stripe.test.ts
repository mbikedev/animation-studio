import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { processStripeWebhook } from "@/lib/billing/stripe";
import { makeServices } from "../helpers/services";

const SECRET = "whsec_test_secret";

function setup() {
  const ctx = makeServices({ STRIPE_SECRET_KEY: "sk_test_dummy", STRIPE_WEBHOOK_SECRET: SECRET });
  return ctx;
}

function signed(payload: object) {
  const body = JSON.stringify(payload);
  const header = Stripe.webhooks.generateTestHeaderString({ payload: body, secret: SECRET });
  return { body, header };
}

function sessionEvent(type: string, id: string, purchaseId: string, payment_status: string, amount = 500, eventId = `evt_${crypto.randomUUID()}`) {
  return {
    id: eventId,
    object: "event",
    type,
    livemode: false,
    data: { object: { id, object: "checkout.session", payment_status, amount_total: amount, currency: "eur", metadata: { purchase_id: purchaseId }, client_reference_id: purchaseId } },
  };
}

async function newPurchase(ctx: ReturnType<typeof setup>) {
  const userId = crypto.randomUUID();
  await ctx.store.ensureProfile({ id: userId, email: "a@example.test" }, 0);
  const pack = (await ctx.store.listPacks())[0];
  const purchase = await ctx.store.createPurchase({ userId, pack });
  return { userId, purchase };
}

describe("Stripe webhook", () => {
  it("rejects an invalid signature without crediting", async () => {
    const ctx = setup();
    const { userId, purchase } = await newPurchase(ctx);
    const { body } = signed(sessionEvent("checkout.session.completed", "cs_1", purchase.id, "paid"));
    const res = await processStripeWebhook(ctx.services, body, "t=1,v1=deadbeef");
    expect(res.status).toBe(400);
    expect((await ctx.store.getCreditAccount(userId)).availableCredits).toBe(0);
  });

  it("credits a paid session once, even with duplicate deliveries and two event types", async () => {
    const ctx = setup();
    const { userId, purchase } = await newPurchase(ctx);
    const evt = sessionEvent("checkout.session.completed", "cs_2", purchase.id, "paid");
    const a = signed(evt);
    expect((await processStripeWebhook(ctx.services, a.body, a.header)).result).toBe("credited");
    expect((await processStripeWebhook(ctx.services, a.body, a.header)).result).toMatch(/^duplicate/);
    const other = signed(sessionEvent("checkout.session.async_payment_succeeded", "cs_2", purchase.id, "paid"));
    expect((await processStripeWebhook(ctx.services, other.body, other.header)).result).toBe("already");
    expect((await ctx.store.getCreditAccount(userId)).availableCredits).toBe(100);
  });

  it("does not credit an unpaid (deferred) session until async success", async () => {
    const ctx = setup();
    const { userId, purchase } = await newPurchase(ctx);
    const pending = signed(sessionEvent("checkout.session.completed", "cs_3", purchase.id, "unpaid"));
    expect((await processStripeWebhook(ctx.services, pending.body, pending.header)).result).toBe("pending");
    expect((await ctx.store.getCreditAccount(userId)).availableCredits).toBe(0);
    expect((await ctx.store.getPurchase(purchase.id))?.paymentStatus).toBe("async_pending");
    const ok = signed(sessionEvent("checkout.session.async_payment_succeeded", "cs_3", purchase.id, "paid"));
    expect((await processStripeWebhook(ctx.services, ok.body, ok.header)).result).toBe("credited");
    expect((await ctx.store.getCreditAccount(userId)).availableCredits).toBe(100);
  });

  it("refuses a paid amount that differs from the pack", async () => {
    const ctx = setup();
    const { userId, purchase } = await newPurchase(ctx);
    const evt = signed(sessionEvent("checkout.session.completed", "cs_4", purchase.id, "paid", 1));
    await expect(processStripeWebhook(ctx.services, evt.body, evt.header)).rejects.toMatchObject({ code: "amount_mismatch" });
    expect((await ctx.store.getCreditAccount(userId)).availableCredits).toBe(0);
  });

  it("rejects live-mode events while live payments are disabled", async () => {
    const ctx = setup();
    const { purchase } = await newPurchase(ctx);
    const evt = signed({ ...sessionEvent("checkout.session.completed", "cs_5", purchase.id, "paid"), livemode: true });
    expect((await processStripeWebhook(ctx.services, evt.body, evt.header)).result).toBe("live_disabled");
  });
});
