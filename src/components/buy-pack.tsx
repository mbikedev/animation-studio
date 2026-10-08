"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client/api";

export function BuyPackButton({ packId, label }: { packId: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="grid gap-1">
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const { url } = await api<{ url: string }>("/api/billing/checkout", { method: "POST", json: { packId } });
            window.location.assign(url);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Paiement indisponible.");
            setBusy(false);
          }
        }}
      >
        {busy && <Loader2 className="animate-spin" />} {label}
      </Button>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
