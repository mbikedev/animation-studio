import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getServices } from "@/lib/container";
import { logger } from "@/lib/logger";
import { verifyHedraWebhook } from "@/lib/providers/hedra";

/**
 * Optional Hedra completion webhook. Polling remains the source of truth:
 * a verified delivery only wakes the worker for that job (no state is taken
 * from the payload). Requires HEDRA_WEBHOOK_PUBLIC_KEY.
 */
export async function POST(request: Request) {
  const services = getServices();
  const publicKey = process.env.HEDRA_WEBHOOK_PUBLIC_KEY;
  if (services.config.mode !== "live" || !publicKey) return NextResponse.json({ result: "disabled" }, { status: 404 });
  const raw = await request.text();
  let webhookId: string;
  let redelivery: boolean;
  try {
    ({ webhookId, redelivery } = verifyHedraWebhook({ rawBody: raw, headers: request.headers, publicKey }));
  } catch (error) {
    logger.warn("hedra.webhook_rejected", { error });
    return NextResponse.json({ result: "invalid" }, { status: 400 });
  }
  const isNew = await services.store.recordWebhookEvent("hedra", webhookId, createHash("sha256").update(raw).digest("hex"));
  if (!isNew && !redelivery) return NextResponse.json({ result: "duplicate" });
  const generations = await services.store.listAllGenerations({ status: "processing", limit: 200 });
  const match = generations.find((g) => g.providerJobId === webhookId);
  if (match) await services.dispatcher.dispatch(match.id);
  return NextResponse.json({ result: match ? "dispatched" : "ignored" });
}
