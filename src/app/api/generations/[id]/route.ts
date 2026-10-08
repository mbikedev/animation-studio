import { NextResponse } from "next/server";
import { z } from "zod";
import { getServices } from "@/lib/container";
import { AppError } from "@/lib/domain";
import { presentGeneration } from "@/lib/generation/presenter";
import { assertSameOrigin, handle, requireApiUser } from "@/lib/http/api";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Ctx) {
  return handle(async () => {
    const user = await requireApiUser();
    const id = z.uuid().parse((await params).id);
    const services = getServices();
    const g = await services.store.getGeneration(user.id, id);
    if (!g) throw new AppError("not_found", "Génération introuvable.", 404);
    // Demo: the in-process worker may have been lost on a dev reload.
    if (services.config.mode === "demo" && !["succeeded", "failed", "canceled", "needs_reconciliation"].includes(g.status)) {
      await services.dispatcher.dispatch(g.id);
    }
    return NextResponse.json({ generation: await presentGeneration(services, g) });
  });
}

/** Deletes the video and its personal media (not billing records). */
export async function DELETE(request: Request, { params }: Ctx) {
  return handle(async () => {
    assertSameOrigin(request);
    const user = await requireApiUser();
    const id = z.uuid().parse((await params).id);
    const services = getServices();
    const g = await services.store.getGeneration(user.id, id);
    if (!g) throw new AppError("not_found", "Génération introuvable.", 404);
    await services.store.softDeleteGeneration(user.id, id);
    if (g.outputAssetId) {
      const out = await services.store.getAssetById(g.outputAssetId);
      if (out && out.ownerId === user.id && !(await services.store.isAssetInUse(out.id))) {
        await services.storage.deleteObject(out.storagePath);
        await services.store.updateAsset(out.id, { status: "deleted" });
      }
    }
    await services.store.audit({ actorId: user.id, action: "generation.delete", targetType: "generation", targetId: id, sanitizedMetadata: {} });
    return NextResponse.json({ ok: true });
  });
}
