import { NextResponse } from "next/server";
import { getServices } from "@/lib/container";
import { presentGeneration } from "@/lib/generation/presenter";
import { launchGeneration } from "@/lib/generation/service";
import { assertSameOrigin, handle, rateLimit, requireApiUser } from "@/lib/http/api";
import { launchSchema } from "@/lib/validation/schemas";

/** Prepares the job and returns immediately; rendering happens in the background. */
export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const user = await requireApiUser();
    await rateLimit(`launch:${user.id}`, 600, 20);
    const input = launchSchema.parse(await request.json());
    const services = getServices();
    const { generation, created } = await launchGeneration(services, user, input);
    return NextResponse.json({ generation: await presentGeneration(services, generation), created }, { status: created ? 202 : 200 });
  });
}

export async function GET(request: Request) {
  return handle(async () => {
    const user = await requireApiUser();
    const projectId = new URL(request.url).searchParams.get("projectId") ?? undefined;
    const services = getServices();
    const list = await services.store.listGenerations(user.id, { projectId, limit: 100 });
    return NextResponse.json({ generations: await Promise.all(list.map((g) => presentGeneration(services, g))) });
  });
}
