import { NextResponse } from "next/server";
import { z } from "zod";
import { createCheckout } from "@/lib/billing/stripe";
import { getServices } from "@/lib/container";
import { assertSameOrigin, handle, rateLimit, requireApiUser } from "@/lib/http/api";

/** The browser sends only a pack id; price and credits come from the server. */
export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const user = await requireApiUser();
    await rateLimit(`checkout:${user.id}`, 600, 10);
    const { packId } = z.object({ packId: z.uuid() }).parse(await request.json());
    return NextResponse.json(await createCheckout(getServices(), user, packId));
  });
}
