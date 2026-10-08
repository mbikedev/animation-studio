"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/fields";
import { api } from "@/lib/client/api";

export function DeleteAccount() {
  const router = useRouter();
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="mt-4 grid gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api("/api/account/delete", { method: "POST", json: { confirm } });
          router.push("/");
          router.refresh();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Erreur.");
          setBusy(false);
        }
      }}
    >
      <Label htmlFor="confirm-delete">Tapez SUPPRIMER pour confirmer</Label>
      <Input id="confirm-delete" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
      {error && <FieldError>{error}</FieldError>}
      <div>
        <Button type="submit" variant="danger" disabled={confirm !== "SUPPRIMER" || busy}>
          Supprimer définitivement
        </Button>
      </div>
    </form>
  );
}
