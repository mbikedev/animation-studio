import { NextResponse } from "next/server";
import { getServices } from "@/lib/container";
import { estimateGeneration } from "@/lib/generation/service";
import { assertSameOrigin, handle, rateLimit, requireApiUser } from "@/lib/http/api";
import { generationOptionsSchema } from "@/lib/validation/schemas";

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const user = await requireApiUser();
    await rateLimit(`estimate:${user.id}`, 60, 60);
    const input = generationOptionsSchema.parse(await request.json());
    return NextResponse.json(await estimateGeneration(getServices(), user, input));
  });
}
