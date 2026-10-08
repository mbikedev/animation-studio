import { NextResponse } from "next/server";
import { z } from "zod";
import { getServices } from "@/lib/container";
import { presentGeneration } from "@/lib/generation/presenter";
import { cancelGeneration } from "@/lib/generation/service";
import { assertSameOrigin, handle, requireApiUser } from "@/lib/http/api";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(request);
    const user = await requireApiUser();
    const id = z.uuid().parse((await params).id);
    const services = getServices();
    const g = await cancelGeneration(services, user, id);
    return NextResponse.json({ generation: await presentGeneration(services, g) });
  });
}
