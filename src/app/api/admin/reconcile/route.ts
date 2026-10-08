import { NextResponse } from "next/server";
import { getServices } from "@/lib/container";
import { reconcile } from "@/lib/generation/dispatcher";
import { assertSameOrigin, handle, requireApiAdmin } from "@/lib/http/api";

/** Manual trigger of the reconciliation pass (also scheduled in Trigger.dev). */
export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const admin = await requireApiAdmin();
    const services = getServices();
    const result = await reconcile(services);
    await services.store.audit({ actorId: admin.id, action: "reconcile.manual", targetType: "system", targetId: null, sanitizedMetadata: result });
    return NextResponse.json(result);
  });
}
