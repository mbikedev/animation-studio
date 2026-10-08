import { Gallery } from "@/components/gallery";
import { ProjectList } from "@/components/project-list";
import { requireUser } from "@/lib/auth/session";
import { getServices } from "@/lib/container";
import { presentGeneration } from "@/lib/generation/presenter";

export const metadata = { title: "Projets" };

export default async function ProjectsPage() {
  const user = await requireUser();
  const services = getServices();
  const [projects, generations] = await Promise.all([services.store.listProjects(user.id), services.store.listGenerations(user.id, { limit: 60 })]);
  const presented = await Promise.all(generations.map((g) => presentGeneration(services, g)));
  const titles = Object.fromEntries(projects.map((p) => [p.id, p.title]));
  const counts = new Map<string, number>();
  for (const g of generations) counts.set(g.projectId, (counts.get(g.projectId) ?? 0) + 1);
  return (
    <div className="mx-auto grid max-w-6xl gap-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Projets et galerie</h1>
        <p className="mt-1 text-sm text-muted">Toutes vos vidéos, privées et téléchargeables par vous seul.</p>
      </header>
      <section aria-labelledby="projects-title" className="grid gap-3">
        <h2 id="projects-title" className="font-semibold">
          Projets
        </h2>
        <ProjectList projects={projects.map((p) => ({ id: p.id, title: p.title, updatedAt: p.updatedAt, count: counts.get(p.id) ?? 0 }))} />
      </section>
      <section aria-labelledby="gallery-title" className="grid gap-3">
        <h2 id="gallery-title" className="font-semibold">
          Galerie
        </h2>
        <Gallery generations={presented} projectTitles={titles} />
      </section>
    </div>
  );
}
