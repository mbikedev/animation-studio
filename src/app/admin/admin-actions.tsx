"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { FieldError, Input, Label } from "@/components/ui/fields";
import { api } from "@/lib/client/api";

export function AdjustCredits({ userId, email }: { userId: string; email: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Ajuster
      </Button>
      <DialogContent title="Ajuster les crédits" description={`Utilisateur : ${email ?? userId}. L'opération est journalisée avec votre identifiant et le motif.`}>
        <form
          className="grid gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              await api("/api/admin/credits", { method: "POST", json: { userId, delta: Number(delta), reason, requestId } });
              setOpen(false);
              setDelta("");
              setReason("");
              setRequestId(crypto.randomUUID());
              router.refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Erreur.");
            }
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="delta">Variation (ex. 50 ou -20)</Label>
            <Input id="delta" inputMode="numeric" value={delta} onChange={(e) => setDelta(e.target.value)} required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="reason">Motif (obligatoire)</Label>
            <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} maxLength={300} required />
          </div>
          {error && <FieldError>{error}</FieldError>}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Annuler
              </Button>
            </DialogClose>
            <Button type="submit">Appliquer</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ResolveGeneration({ generationId, hasProviderJob }: { generationId: string; hasProviderJob: boolean }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<string | null>(null);
  async function run(action: "retry_lookup" | "fail_refund" | "resume_storing") {
    try {
      const r = await api<{ result: string }>(`/api/admin/generations/${generationId}/resolve`, { method: "POST", json: { action, reason } });
      setResult(r.result);
      router.refresh();
    } catch (e) {
      setResult(e instanceof Error ? e.message : "Erreur.");
    }
  }
  return (
    <div className="grid gap-2">
      <Input aria-label="Motif de la résolution" placeholder="Motif (obligatoire)" value={reason} onChange={(e) => setReason(e.target.value)} className="h-8" />
      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant="secondary" disabled={reason.length < 3} onClick={() => run("retry_lookup")}>
          Interroger le fournisseur
        </Button>
        {hasProviderJob && (
          <Button size="sm" variant="secondary" disabled={reason.length < 3} onClick={() => run("resume_storing")}>
            Relancer la sauvegarde
          </Button>
        )}
        <Button size="sm" variant="danger" disabled={reason.length < 3} onClick={() => run("fail_refund")}>
          Clore et rembourser
        </Button>
      </div>
      {result && <p className="text-xs text-muted">Résultat : {result}</p>}
    </div>
  );
}

export function ReconcileButton() {
  const router = useRouter();
  const [result, setResult] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-3">
      <Button
        variant="outline"
        size="sm"
        onClick={async () => {
          try {
            const r = await api<{ outbox: number; stale: number; reconciled: number }>("/api/admin/reconcile", { method: "POST" });
            setResult(`${r.outbox} relancée(s) depuis l'outbox, ${r.stale} tâche(s) bloquée(s), ${r.reconciled} réconciliée(s)`);
            router.refresh();
          } catch (e) {
            setResult(e instanceof Error ? e.message : "Erreur.");
          }
        }}
      >
        Lancer la réconciliation
      </Button>
      {result && <span className="text-xs text-muted">{result}</span>}
    </div>
  );
}
