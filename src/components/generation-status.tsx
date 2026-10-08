"use client";

import { AlertTriangle, CheckCircle2, Download, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/card";
import type { PresentedGeneration } from "@/lib/generation/presenter";
import { cn, formatDuration } from "@/lib/utils";

const STEPS = [
  { key: "queued", label: "En attente" },
  { key: "processing", label: "Génération" },
  { key: "storing", label: "Sauvegarde" },
  { key: "succeeded", label: "Terminée" },
] as const;

function stepIndex(status: PresentedGeneration["status"]): number {
  switch (status) {
    case "queued":
    case "preparing_audio":
      return 0;
    case "submitting":
    case "processing":
      return 1;
    case "storing":
      return 2;
    case "succeeded":
      return 3;
    default:
      return -1;
  }
}

export function statusTone(status: PresentedGeneration["status"]) {
  if (status === "succeeded") return "success" as const;
  if (status === "failed" || status === "canceled") return "danger" as const;
  if (status === "needs_reconciliation") return "warning" as const;
  return "accent" as const;
}

/** Real states only: no invented percentage. */
export function GenerationProgress({ generation, onCancel }: { generation: PresentedGeneration; onCancel?: () => void }) {
  const current = stepIndex(generation.status);
  const terminalBad = generation.status === "failed" || generation.status === "canceled";
  return (
    <div className="grid gap-4" aria-live="polite">
      <ol className="grid grid-cols-4 gap-2">
        {STEPS.map((step, i) => {
          const done = current > i || generation.status === "succeeded";
          const active = current === i && generation.status !== "succeeded";
          return (
            <li key={step.key} className="grid gap-1.5">
              <span className={cn("h-1.5 rounded-full", done ? "bg-success" : active ? "animate-pulse bg-accent" : "bg-surface-2")} />
              <span className={cn("text-xs", active ? "font-medium text-foreground" : "text-muted")}>
                {step.key === "queued" && generation.status === "preparing_audio" ? "Préparation de la voix" : step.label}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {generation.status === "succeeded" ? (
          <CheckCircle2 className="size-4 text-success" />
        ) : terminalBad ? (
          <XCircle className="size-4 text-danger" />
        ) : generation.status === "needs_reconciliation" ? (
          <AlertTriangle className="size-4 text-warning" />
        ) : (
          <Loader2 className="size-4 animate-spin text-accent" />
        )}
        <span className="font-medium">{generation.statusLabel}</span>
        {!["succeeded", "failed", "canceled"].includes(generation.status) && (
          <Badge tone="neutral">{generation.reservedCredits} crédits réservés</Badge>
        )}
      </div>
      {generation.status === "needs_reconciliation" && (
        <p className="text-sm text-muted">
          Le résultat de la demande au moteur est incertain. Les crédits restent réservés pendant la vérification (automatique ou par un administrateur) : ils seront consommés si la vidéo existe, rendus sinon.
        </p>
      )}
      {generation.errorMessage && generation.status === "failed" && (
        <p role="alert" className="text-sm text-danger">
          {generation.errorMessage} Les crédits réservés ont été rendus.
        </p>
      )}
      {onCancel && generation.canCancel && (
        <div>
          <Button variant="outline" size="sm" onClick={onCancel}>
            Annuler avant transmission
          </Button>
          <p className="mt-1 text-xs text-muted">Possible tant que la demande n&apos;est pas transmise au moteur. Ensuite, elle ne peut plus être arrêtée.</p>
        </div>
      )}
    </div>
  );
}

export function VideoResult({ generation }: { generation: PresentedGeneration }) {
  if (!generation.videoUrl) return null;
  return (
    <div className="grid gap-3">
      <video
        key={generation.videoUrl}
        src={generation.videoUrl}
        controls
        playsInline
        className={cn("w-full rounded-lg bg-black", generation.aspectRatio === "9:16" ? "mx-auto max-h-[70vh] w-auto" : "")}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
        <span>
          {generation.aspectRatio} · {generation.resolution} · {formatDuration(generation.durationMs)}
          {generation.demo && " · démonstration, pas une animation IA"}
        </span>
        {generation.downloadUrl && (
          <Button asChild size="sm">
            <a href={generation.downloadUrl} download>
              <Download /> Télécharger MP4
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}
