import type { Services } from "@/lib/container";
import type { Generation } from "@/lib/domain";
import { SIGNED_URL_TTL_SECONDS } from "@/lib/storage/types";
import { statusLabel } from "./state-machine";

/** Shape sent to the browser: no provider ids, no internal costs. */
export async function presentGeneration(services: Services, g: Generation) {
  const [output, image] = await Promise.all([
    g.outputAssetId ? services.store.getAssetById(g.outputAssetId) : null,
    services.store.getAssetById(g.imageAssetId),
  ]);
  const safeName = `animation-${g.createdAt.slice(0, 10)}-${g.id.slice(0, 8)}.mp4`;
  return {
    id: g.id,
    projectId: g.projectId,
    status: g.status,
    statusLabel: statusLabel(g.status),
    aspectRatio: g.parameters.aspectRatio,
    resolution: g.parameters.resolution,
    durationMs: output?.durationMs ?? g.parameters.durationMs,
    reservedCredits: g.reservedCredits,
    errorMessage: g.status === "failed" || g.status === "needs_reconciliation" ? g.errorMessage : null,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
    canCancel: g.status === "queued",
    thumbnailUrl: image?.status === "ready" ? await services.storage.signedReadUrl(image.storagePath, SIGNED_URL_TTL_SECONDS) : null,
    videoUrl: output?.status === "ready" ? await services.storage.signedReadUrl(output.storagePath, SIGNED_URL_TTL_SECONDS) : null,
    downloadUrl: output?.status === "ready" ? await services.storage.signedReadUrl(output.storagePath, SIGNED_URL_TTL_SECONDS, { download: safeName }) : null,
    demo: services.config.mode === "demo",
  };
}

export type PresentedGeneration = Awaited<ReturnType<typeof presentGeneration>>;
