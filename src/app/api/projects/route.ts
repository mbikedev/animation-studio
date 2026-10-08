import { NextResponse } from "next/server";
import { getServices } from "@/lib/container";
import { assertSameOrigin, handle, rateLimit, requireApiUser } from "@/lib/http/api";
import { projectTitleSchema } from "@/lib/validation/schemas";

export async function GET() {
  return handle(async () => {
    const user = await requireApiUser();
    return NextResponse.json({ projects: await getServices().store.listProjects(user.id) });
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const user = await requireApiUser();
    await rateLimit(`projects:${user.id}`, 60, 20);
    const body = (await request.json()) as { title?: unknown };
    const title = projectTitleSchema.parse(body.title);
    return NextResponse.json({ project: await getServices().store.createProject(user.id, title) }, { status: 201 });
  });
}
