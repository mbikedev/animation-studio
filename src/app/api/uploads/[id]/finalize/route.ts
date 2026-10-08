import { NextResponse } from "next/server";
import { z } from "zod";
import { getServices } from "@/lib/container";
import { assertSameOrigin, handle, requireApiUser } from "@/lib/http/api";
import { finalizeUpload } from "@/lib/media/assets";
import { SIGNED_URL_TTL_SECONDS } from "@/lib/storage/types";

/** Step 2: inspect the real bytes (type, size, dimensions, duration, metadata). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(request);
    const user = await requireApiUser();
    const id = z.uuid().parse((await params).id);
    const services = getServices();
    const asset = await finalizeUpload(services, user, id);
    const previewUrl = await services.storage.signedReadUrl(asset.storagePath, SIGNED_URL_TTL_SECONDS);
    return NextResponse.json({
      asset: { id: asset.id, kind: asset.kind, mimeType: asset.mimeType, durationMs: asset.durationMs, width: asset.width, height: asset.height, sizeBytes: asset.sizeBytes },
      previewUrl,
    });
  });
}
