"use client";

import { FolderOpen, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { FieldError, Input, Label } from "@/components/ui/fields";
import { api } from "@/lib/client/api";
import { formatDate } from "@/lib/utils";

interface ProjectRow {
  id: string;
  title: string;
  updatedAt: string;
  count: number;
}

export function ProjectList({ projects }: { projects: ProjectRow[] }) {
  const router = useRouter();
  const [renaming, setRenaming] = useState<ProjectRow | null>(null);
  const [deleting, setDeleting] = useState<ProjectRow | null>(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function rename() {
    if (!renaming) return;
    try {
      await api(`/api/projects/${renaming.id}`, { method: "PATCH", json: { title } });
      setRenaming(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur.");
    }
  }

  async function remove() {
    if (!deleting) return;
    try {
      await api(`/api/projects/${deleting.id}`, { method: "DELETE" });
      setDeleting(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur.");
    }
  }

  if (projects.length === 0) {
    return <p className="text-sm text-muted">Aucun projet. Créez-en un depuis le studio.</p>;
  }

  return (
    <>
      <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
        {projects.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <FolderOpen className="size-4 text-muted" aria-hidden />
            <Link href={`/projects/${p.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
              {p.title}
            </Link>
            <span className="text-xs text-muted">
              {p.count} vidéo{p.count > 1 ? "s" : ""} · modifié {formatDate(p.updatedAt)}
            </span>
            <Button size="sm" variant="ghost" asChild>
              <Link href={`/studio?project=${p.id}`}>Ouvrir dans le studio</Link>
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Renommer ${p.title}`}
              onClick={() => {
                setTitle(p.title);
                setError(null);
                setRenaming(p);
              }}
            >
              <Pencil />
            </Button>
            <Button size="icon" variant="ghost" aria-label={`Supprimer ${p.title}`} onClick={() => { setError(null); setDeleting(p); }}>
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
      <Dialog open={Boolean(renaming)} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent title="Renommer le projet">
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void rename();
            }}
          >
            <Label htmlFor="rename">Titre</Label>
            <Input id="rename" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} autoFocus />
            {error && <FieldError>{error}</FieldError>}
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Annuler
                </Button>
              </DialogClose>
              <Button type="submit">Enregistrer</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent title="Supprimer le projet ?" description="Le projet est retiré de vos listes. Impossible tant qu'une génération y est en cours.">
          {error && <FieldError className="mb-3">{error}</FieldError>}
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
