import Link from "next/link";
import { notFound } from "next/navigation";
import { Gallery } from "@/components/gallery";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/session";
import { getServices } from "@/lib/container";
import { presentGeneration } from "@/lib/generation/presenter";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const services = getServices();
  const project = await services.store.getProject(user.id, id);
  if (!project) notFound();
  const generations = await services.store.listGenerations(user.id, { projectId: id });
  const presented = await Promise.all(generations.map((g) => presentGeneration(services, g)));
  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/projects" className="text-sm text-muted hover:underline">
            ← Projets
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{project.title}</h1>
        </div>
        <Button asChild>
          <Link href={`/studio?project=${project.id}`}>Nouvelle vidéo dans ce projet</Link>
        </Button>
      </header>
      <Gallery generations={presented} projectTitles={{ [project.id]: project.title }} />
    </div>
  );
}
