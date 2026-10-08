import { NextResponse } from "next/server";
import { z } from "zod";
import { signOut } from "@/lib/auth/session";
import { getServices } from "@/lib/container";
import { getServiceClient } from "@/lib/db/supabase";
import { AppError } from "@/lib/domain";
import { logger } from "@/lib/logger";
import { assertSameOrigin, handle, requireApiUser } from "@/lib/http/api";

/** Deletes the account: media files first, then personal data. */
export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const user = await requireApiUser();
    const { confirm } = z.object({ confirm: z.string() }).parse(await request.json());
    if (confirm !== "SUPPRIMER") throw new AppError("confirmation_required", "Tapez SUPPRIMER pour confirmer.", 400);
    const services = getServices();
    const { storagePaths } = await services.store.deleteUserData(user.id);
    for (const p of storagePaths) {
      await services.storage.deleteObject(p).catch((error) => logger.error("account.delete_media_failed", { error }));
    }
    if (services.config.mode === "live") {
      const { error } = await getServiceClient().auth.admin.deleteUser(user.id);
      if (error) throw new AppError("delete_failed", "Suppression du compte incomplète : contactez le support.", 500);
    }
    await signOut();
    return NextResponse.json({ ok: true });
  });
}
