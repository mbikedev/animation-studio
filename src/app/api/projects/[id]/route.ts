import { NextResponse } from "next/server";
import { z } from "zod";
import { getServices } from "@/lib/container";
import { AppError } from "@/lib/domain";
import { assertSameOrigin, handle, requireApiUser } from "@/lib/http/api";
import { projectTitleSchema } from "@/lib/validation/schemas";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  return handle(async () => {
    assertSameOrigin(request);
    const user = await requireApiUser();
    const id = z.uuid().parse((await params).id);
    const body = (await request.json()) as { title?: unknown };
    const project = await getServices().store.renameProject(user.id, id, projectTitleSchema.parse(body.title));
    if (!project) throw new AppError("not_found", "Projet introuvable.", 404);
    return NextResponse.json({ project });
  });
}

export async function DELETE(request: Request, { params }: Ctx) {
  return handle(async () => {
    assertSameOrigin(request);
    const user = await requireApiUser();
    const id = z.uuid().parse((await params).id);
    const ok = await getServices().store.softDeleteProject(user.id, id);
    if (!ok) throw new AppError("not_found", "Projet introuvable.", 404);
    return NextResponse.json({ ok: true });
  });
}
