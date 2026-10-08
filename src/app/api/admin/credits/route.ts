import { NextResponse } from "next/server";
import { getServices } from "@/lib/container";
import { assertSameOrigin, handle, requireApiAdmin } from "@/lib/http/api";
import { adjustCreditsSchema } from "@/lib/validation/schemas";

/** Audited, transactional credit adjustment with a mandatory reason. */
export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const admin = await requireApiAdmin();
    const input = adjustCreditsSchema.parse(await request.json());
    const account = await getServices().store.adminAdjustCredits({
      actorId: admin.id,
      userId: input.userId,
      delta: input.delta,
      reason: input.reason,
      idempotencyKey: `admin:${admin.id}:${input.requestId}`,
    });
    return NextResponse.json({ account });
  });
}
