import { requireUser } from "@/lib/auth/session";
import { getServices } from "@/lib/container";
import { getAvailability } from "@/lib/generation/service";
import { StudioClient } from "./studio-client";

export const metadata = { title: "Studio" };

export default async function StudioPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const user = await requireUser();
  const services = getServices();
  const [projects, params] = await Promise.all([services.store.listProjects(user.id), searchParams]);
  const availability = getAvailability(services);
  const initial = projects.find((p) => p.id === params.project)?.id ?? null;
  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Studio</h1>
        <p className="mt-1 text-sm text-muted">Importez un portrait et une voix, vérifiez le coût, puis lancez la génération.</p>
      </header>
      <StudioClient
        projects={projects.map((p) => ({ id: p.id, title: p.title }))}
        initialProjectId={initial}
        enabled={availability.enabled}
        blockers={availability.blockers}
        capabilities={
          availability.capabilities
            ? {
                aspectRatios: availability.capabilities.aspectRatios,
                resolutions: availability.capabilities.resolutions,
                maxOutputDurationMs: availability.capabilities.maxOutputDurationMs,
              }
            : null
        }
        voiceEnabled={availability.voiceEnabled}
        isDemo={services.config.mode === "demo"}
        maxDurationSeconds={services.config.limits.maxVideoDurationSeconds}
      />
    </div>
  );
}
