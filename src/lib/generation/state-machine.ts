import { TERMINAL_STATUSES, type GenerationStatus } from "@/lib/domain";

/**
 * Allowed generation transitions. Mirrored by the `generations_transition_guard`
 * trigger in supabase/migrations. Terminal states are immutable except via an
 * audited admin resolution (which goes through failGeneration on a
 * needs_reconciliation row, never by rewriting a terminal row).
 */
export const TRANSITIONS: Record<GenerationStatus, GenerationStatus[]> = {
  queued: ["preparing_audio", "submitting", "failed", "canceled"],
  preparing_audio: ["preparing_audio", "submitting", "failed", "needs_reconciliation", "canceled"],
  submitting: ["submitting", "processing", "failed", "needs_reconciliation"],
  processing: ["processing", "storing", "failed", "needs_reconciliation"],
  storing: ["storing", "succeeded", "needs_reconciliation"],
  needs_reconciliation: ["processing", "storing", "failed", "canceled"],
  succeeded: [],
  failed: [],
  canceled: [],
};

export function canTransition(from: GenerationStatus, to: GenerationStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminal(status: GenerationStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** User-facing label; never a fake percentage. */
export function statusLabel(status: GenerationStatus): string {
  switch (status) {
    case "queued":
      return "En attente";
    case "preparing_audio":
      return "Préparation de la voix";
    case "submitting":
    case "processing":
      return "Génération";
    case "storing":
      return "Sauvegarde";
    case "succeeded":
      return "Terminée";
    case "failed":
      return "Échec";
    case "canceled":
      return "Annulée";
    case "needs_reconciliation":
      return "Vérification en cours";
  }
}
