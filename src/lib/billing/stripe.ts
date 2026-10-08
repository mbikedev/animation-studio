import { createHash } from "node:crypto";
import Stripe from "stripe";
import type { Services } from "@/lib/container";
import { AppError, type UserIdentity } from "@/lib/domain";
import { logger } from "@/lib/logger";

/**
 * Credit packs through Stripe Checkout (one-time payments).
 * - The server picks the pack and its price id; the browser only sends a pack id.
 * - Credits are granted ONLY from a verified webhook, never from the return page.
 * - Deduplication: per Stripe event id AND per purchase (ledger key).
 * - Refunds and disputes take back what is still available, never below zero;
 *   any uncovered remainder is audited for manual review.
 */

let client: Stripe | undefined;

export function getStripe(services: Services): Stripe {
  const cfg = services.config.stripe;
  if (!cfg) throw new AppError("billing_disabled", "Paiements non configurés.", 503);
  client ??= new Stripe(cfg.secretKey);
  return client;
}

export function billingMode(services: Services): "stripe" | "demo" | "disabled" {
  if (services.config.stripe) return "stripe";
  return services.config.mode === "demo" ? "demo" : "disabled";
}

export async function createCheckout(services: Services, user: UserIdentity, packId: string): Promise<{ url: string }> {
  const pack = await services.store.getPack(packId);
  if (!pack) throw new AppError("not_found", "Pack introuvable.", 404);
  const mode = billingMode(services);
  if (mode === "disabled") throw new AppError("billing_disabled", "Paiements non configurés.", 503);

  const purchase = await services.store.createPurchase({ userId: user.id, pack });
  if (mode === "demo") {
    return { url: `/credits/demo-checkout?purchase=${purchase.id}` };
  }
  if (!pack.stripePriceId) throw new AppError("pack_not_configured", "Ce pack n'a pas de prix Stripe configuré.", 503);

  const stripe = getStripe(services);
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      line_items: [{ price: pack.stripePriceId, quantity: 1 }],
      client_reference_id: purchase.id,
      metadata: { purchase_id: purchase.id, user_id: user.id },
      payment_intent_data: { metadata: { purchase_id: purchase.id } },
      customer_email: user.email || undefined,
      success_url: `${services.config.baseUrl}/credits?checkout=success`,
      cancel_url: `${services.config.baseUrl}/credits?checkout=canceled`,
    },
    { idempotencyKey: `checkout:${purchase.id}` },
  );
  await services.store.attachCheckoutSession(purchase.id, session.id);
  if (!session.url) throw new AppError("checkout_failed", "Session de paiement indisponible.", 502);
  return { url: session.url };
}

/** Subset of a Checkout Session the fulfillment logic needs (testable). */
export interface SessionLike {
  id: string;
  payment_status: string;
  amount_total: number | null;
  currency: string | null;
  metadata?: Record<string, string> | null;
  client_reference_id?: string | null;
}

async function purchaseForSession(services: Services, session: SessionLike) {
  const bySession = await services.store.getPurchaseBySession(session.id);
  if (bySession) return bySession;
  const id = session.metadata?.purchase_id ?? session.client_reference_id;
  return id ? services.store.getPurchase(id) : null;
}

export async function fulfillFromSession(services: Services, session: SessionLike): Promise<"credited" | "already" | "pending" | "ignored"> {
  const purchase = await purchaseForSession(services, session);
  if (!purchase) {
    logger.warn("billing.unknown_session", { sessionId: session.id });
    return "ignored";
  }
  if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") {
    await services.store.setPurchaseStatus(purchase.id, "async_pending");
    return "pending";
  }
  const { credited } = await services.store.fulfillPurchase(purchase.id, {
    sessionId: session.id,
    amountMinor: session.amount_total ?? -1,
    currency: session.currency ?? "",
  });
  return credited ? "credited" : "already";
}

async function purchaseIdForPaymentIntent(services: Services, paymentIntentId: string | null): Promise<string | null> {
  if (!paymentIntentId) return null;
  const stripe = getStripe(services);
  const sessions = await stripe.checkout.sessions.list({ payment_intent: paymentIntentId, limit: 1 });
  const session = sessions.data[0];
  if (!session) return null;
  return (await purchaseForSession(services, session))?.id ?? null;
}

export async function handleStripeEvent(services: Services, event: Stripe.Event): Promise<string> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return fulfillFromSession(services, event.data.object as unknown as SessionLike);
    case "checkout.session.async_payment_failed":
    case "checkout.session.expired": {
      const purchase = await purchaseForSession(services, event.data.object as unknown as SessionLike);
      if (purchase) await services.store.setPurchaseStatus(purchase.id, event.type.endsWith("expired") ? "expired" : "failed");
      return "status_updated";
    }
    case "charge.refunded":
    case "charge.dispute.created": {
      const obj = event.data.object as { payment_intent?: string | { id: string } | null };
      const pi = typeof obj.payment_intent === "string" ? obj.payment_intent : (obj.payment_intent?.id ?? null);
      const purchaseId = await purchaseIdForPaymentIntent(services, pi);
      if (!purchaseId) return "ignored";
      const result = await services.store.reversePurchase(purchaseId, event.type === "charge.refunded" ? "refunded" : "disputed");
      if (result.uncoveredCredits > 0) {
        logger.error("billing.reversal_uncovered", { purchaseId, uncovered: result.uncoveredCredits });
      }
      return "reversed";
    }
    default:
      return "ignored";
  }
}

/**
 * Verifies the signature on the raw body, processes the event idempotently
 * and only then records it as processed (so a failed attempt is retried).
 */
export async function processStripeWebhook(services: Services, rawBody: string, signature: string | null): Promise<{ status: number; result: string }> {
  const cfg = services.config.stripe;
  if (!cfg) return { status: 503, result: "billing_disabled" };
  if (!signature) return { status: 400, result: "missing_signature" };
  let event: Stripe.Event;
  try {
    event = getStripe(services).webhooks.constructEvent(rawBody, signature, cfg.webhookSecret);
  } catch {
    return { status: 400, result: "invalid_signature" };
  }
  if (event.livemode && !services.config.flags.stripeLive) {
    // Live-mode event while live payments are not explicitly enabled.
    logger.error("billing.live_event_rejected", { eventId: event.id });
    return { status: 400, result: "live_disabled" };
  }
  const payloadHash = createHash("sha256").update(rawBody).digest("hex");
  // Processing is idempotent per purchase; the event record is the second layer.
  const result = await handleStripeEvent(services, event);
  const firstDelivery = await services.store.recordWebhookEvent("stripe", event.id, payloadHash);
  return { status: 200, result: firstDelivery ? result : `duplicate:${result}` };
}
