"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client/api";

export function DemoCheckoutActions({ purchaseId }: { purchaseId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function pay(outcome: "paid" | "unpaid") {
    setBusy(true);
    try {
      await api("/api/billing/demo-complete", { method: "POST", json: { purchaseId, outcome } });
      router.push(outcome === "paid" ? "/credits?checkout=success" : "/credits");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur.");
      setBusy(false);
    }
  }
  return (
    <div className="mt-6 grid gap-2">
      <Button onClick={() => pay("paid")} disabled={busy}>
        Simuler un paiement réussi
      </Button>
      <Button variant="outline" onClick={() => pay("unpaid")} disabled={busy}>
        Simuler un paiement différé (non confirmé)
      </Button>
      <Button variant="ghost" onClick={() => router.push("/credits?checkout=canceled")} disabled={busy}>
        Annuler
      </Button>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
