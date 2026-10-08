import { NextResponse } from "next/server";
import { z } from "zod";
import { fulfillFromSession } from "@/lib/billing/stripe";
import { getServices } from "@/lib/container";
import { AppError } from "@/lib/domain";
import { assertSameOrigin, handle, requireApiUser } from "@/lib/http/api";

/**
 * Demo-only simulated payment. Goes through the same fulfillment code as the
 * Stripe webhook. Unavailable in live mode.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const services = getServices();
    if (services.config.mode !== "demo" || services.config.stripe) throw new AppError("not_found", "Introuvable.", 404);
    assertSameOrigin(request);
    const user = await requireApiUser();
    const { purchaseId, outcome } = z.object({ purchaseId: z.uuid(), outcome: z.enum(["paid", "unpaid"]) }).parse(await request.json());
    const purchase = await services.store.getPurchase(purchaseId);
    if (!purchase || purchase.userId !== user.id) throw new AppError("not_found", "Achat introuvable.", 404);
    const result = await fulfillFromSession(services, {
      id: `demo_cs_${purchase.id}`,
      payment_status: outcome,
      amount_total: purchase.amountMinor,
      currency: purchase.currency.toLowerCase(),
      metadata: { purchase_id: purchase.id },
    });
    return NextResponse.json({ result });
  });
}
