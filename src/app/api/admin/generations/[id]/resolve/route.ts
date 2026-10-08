import { NextResponse } from "next/server";
import { z } from "zod";
import { getServices } from "@/lib/container";
import { AppError } from "@/lib/domain";
import { reconcileOne } from "@/lib/generation/dispatcher";
import { assertSameOrigin, handle, requireApiAdmin } from "@/lib/http/api";

/**
 * Admin resolution of a generation in needs_reconciliation:
 * - "retry_lookup": ask the provider again (no new billable submit unless documented idempotent);
 * - "fail_refund": close as failed and release the credits (audited);
 * - "resume_storing": the provider job is done; retry the transfer only.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(request);
    const admin = await requireApiAdmin();
    const id = z.uuid().parse((await params).id);
    const { action, reason } = z
      .object({ action: z.enum(["retry_lookup", "fail_refund", "resume_storing"]), reason: z.string().trim().min(3).max(300) })
      .parse(await request.json());
    const services = getServices();
    const g = await services.store.getGenerationById(id);
    if (!g) throw new AppError("not_found", "Génération introuvable.", 404);
    if (g.status !== "needs_reconciliation") throw new AppError("invalid_state", "Seules les générations à vérifier peuvent être résolues.", 409);

    let result: string;
    if (action === "fail_refund") {
      await services.store.failGeneration(id, { status: "failed", errorCode: "admin_resolved", errorMessage: "Clôturée par un administrateur, crédits rendus.", providerCostMinor: null, actorId: admin.id });
      result = "failed_refunded";
    } else if (action === "resume_storing") {
      if (!g.providerJobId) throw new AppError("invalid_state", "Aucune tâche fournisseur connue.", 409);
      await services.store.transitionGeneration(id, ["needs_reconciliation"], "storing", { attempts: 0, nextCheckAt: new Date().toISOString() });
      await services.dispatcher.dispatch(id);
      result = "storing";
    } else {
      result = (await reconcileOne(services, id)) ? "reconciled" : "unresolved";
    }
    await services.store.audit({ actorId: admin.id, action: `generation.${action}`, targetType: "generation", targetId: id, sanitizedMetadata: { reason, result } });
    return NextResponse.json({ result });
  });
}
