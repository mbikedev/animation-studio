import { NextResponse } from "next/server";
import { processStripeWebhook } from "@/lib/billing/stripe";
import { getServices } from "@/lib/container";
import { logger } from "@/lib/logger";

/** Stripe webhook: signature verified on the raw body. */
export async function POST(request: Request) {
  const raw = await request.text();
  try {
    const { status, result } = await processStripeWebhook(getServices(), raw, request.headers.get("stripe-signature"));
    return NextResponse.json({ result }, { status });
  } catch (error) {
    // 500 => Stripe retries; processing is idempotent.
    logger.error("billing.webhook_failed", { error });
    return NextResponse.json({ result: "error" }, { status: 500 });
  }
}
