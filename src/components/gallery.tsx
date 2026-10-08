"use client";

import { Download, Film, Play, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { statusTone, VideoResult } from "@/components/generation-status";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { api } from "@/lib/client/api";
import type { PresentedGeneration } from "@/lib/generation/presenter";
import { formatDate, formatDuration } from "@/lib/utils";

export function Gallery({ generations, projectTitles }: { generations: PresentedGeneration[]; projectTitles: Record<string, string> }) {
  const router = useRouter();
  const [playing, setPlaying] = useState<PresentedGeneration | null>(null);
  const [toDelete, setToDelete] = useState<PresentedGeneration | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!toDelete) return;
    try {
      await api(`/api/generations/${toDelete.id}`, { method: "DELETE" });
      setToDelete(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Suppression impossible.");
    }
  }

  if (generations.length === 0) {
    return (
      <div className="grid place-items-center rounded-xl border border-dashed border-border px-6 py-16 text-center">
        <Film className="size-8 text-muted" aria-hidden />
        <p className="mt-3 font-medium">Aucune vidéo pour le moment</p>
        <p className="mt-1 text-sm text-muted">Vos générations apparaîtront ici, avec lecture et téléchargement.</p>
        <Button className="mt-4" asChild>
          <a href="/studio">Ouvrir le studio</a>
        </Button>
      </div>
    );
  }

  return (
    <>
      {error && (
        <p role="alert" className="mb-3 text-sm text-danger">
          {error}
        </p>
      )}
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {generations.map((g) => (
          <li key={g.id} className="overflow-hidden rounded-xl border border-border bg-surface">
            <div className="relative aspect-video bg-surface-2">
              {g.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={g.thumbnailUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
              ) : null}
              {g.videoUrl && (
                <button
                  type="button"
                  onClick={() => setPlaying(g)}
                  className="absolute inset-0 grid place-items-center bg-black/30 text-white opacity-90 hover:opacity-100"
                  aria-label="Lire la vidéo"
                >
                  <span className="grid size-12 place-items-center rounded-full bg-black/60">
                    <Play className="size-5" />
                  </span>
                </button>
              )}
              <Badge tone={statusTone(g.status)} className="absolute left-2 top-2">
                {g.statusLabel}
              </Badge>
            </div>
            <div className="grid gap-2 p-4">
              <p className="truncate text-sm font-medium">{projectTitles[g.projectId] ?? "Projet supprimé"}</p>
              <p className="text-xs text-muted">
                {formatDate(g.createdAt)} · {formatDuration(g.durationMs)} · {g.aspectRatio} · {g.resolution}
              </p>
              {g.errorMessage && <p className="text-xs text-danger">{g.errorMessage}</p>}
              <div className="flex gap-2">
                {g.downloadUrl && (
                  <Button size="sm" variant="secondary" asChild>
                    <a href={g.downloadUrl} download>
                      <Download /> MP4
                    </a>
                  </Button>
                )}
                {["succeeded", "failed", "canceled"].includes(g.status) && (
                  <Button size="sm" variant="ghost" onClick={() => setToDelete(g)} aria-label="Supprimer la vidéo">
                    <Trash2 /> Supprimer
                  </Button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      <Dialog open={Boolean(playing)} onOpenChange={(o) => !o && setPlaying(null)}>
        {playing && (
          <DialogContent title="Lecture" className="max-w-3xl">
            <VideoResult generation={playing} />
          </DialogContent>
        )}
      </Dialog>
      <Dialog open={Boolean(toDelete)} onOpenChange={(o) => !o && setToDelete(null)}>
        <DialogContent title="Supprimer cette vidéo ?" description="Le fichier vidéo est supprimé de notre stockage. Les écritures de facturation sont conservées.">
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="outline">Annuler</Button>
            </DialogClose>
            <Button variant="danger" onClick={remove}>
              Supprimer
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
