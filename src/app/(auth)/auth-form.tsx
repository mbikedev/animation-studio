"use client";

import { useActionState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import type { AuthState } from "./actions";

export function AuthForm({
  action,
  submitLabel,
  children,
}: {
  action: (state: AuthState, form: FormData) => Promise<AuthState>;
  submitLabel: string;
  children: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="grid gap-4" noValidate>
      {children}
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      {state.message && <Alert tone="success">{state.message}</Alert>}
      {state.demoLink && (
        <Alert tone="warning">
          Démonstration : aucun email n&apos;est envoyé.{" "}
          {/* Plain anchor: a prefetch must never consume a one-time token. */}
          <a href={state.demoLink} className="font-semibold underline">
            Ouvrir le lien
          </a>
        </Alert>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Veuillez patienter…" : submitLabel}
      </Button>
    </form>
  );
}
