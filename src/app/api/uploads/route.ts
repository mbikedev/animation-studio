import { NextResponse } from "next/server";
import { getServices } from "@/lib/container";
import { assertSameOrigin, handle, rateLimit, requireApiUser } from "@/lib/http/api";
import { initUpload } from "@/lib/media/assets";
import { uploadInitSchema } from "@/lib/validation/schemas";

/** Step 1: reserve a server-chosen storage path and return a signed upload target. */
export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const user = await requireApiUser();
    await rateLimit(`upload:${user.id}`, 600, 40);
    const input = uploadInitSchema.parse(await request.json());
    const { asset, upload } = await initUpload(getServices(), user, input);
    return NextResponse.json({ assetId: asset.id, upload }, { status: 201 });
  });
}
