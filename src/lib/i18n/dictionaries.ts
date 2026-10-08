/**
 * UI dictionaries. French is the reference (complete); English and Dutch are
 * ready to be filled in and fall back to French key by key. No machine
 * translation in V1.
 */
export const LOCALES = ["fr", "en", "nl"] as const;
export type Locale = (typeof LOCALES)[number];

const fr = {
  appName: "Animation Studio",
  nav: { studio: "Studio", projects: "Projets", credits: "Crédits", admin: "Administration", account: "Compte", signOut: "Se déconnecter" },
  demoBanner: "Démonstration : aucune génération IA réelle. Les données de démonstration sont stockées localement et peuvent être effacées.",
  landing: {
    tagline: "Donnez la parole à vos personnages.",
    intro: "Importez un portrait et un audio, lancez la génération, suivez son avancement et téléchargez la vidéo animée.",
    cta: "Commencer",
    login: "J'ai déjà un compte",
    exampleLabel: "Exemple de démonstration (pas une génération IA)",
    limitsTitle: "Ce que l'outil fait, et ne fait pas",
    limits: [
      "Le résultat est une vidéo MP4 (raster), pas un personnage 3D ni un fichier GLB.",
      "La cohérence d'un personnage d'une vidéo à l'autre n'est pas garantie.",
      "Durée limitée à 30 secondes par vidéo dans cette version.",
      "Le coût en crédits est affiché et confirmé avant chaque lancement.",
    ],
  },
  status: {
    queued: "En attente",
    preparing_audio: "Préparation de la voix",
    submitting: "Génération",
    processing: "Génération",
    storing: "Sauvegarde",
    succeeded: "Terminée",
    failed: "Échec",
    canceled: "Annulée",
    needs_reconciliation: "Vérification en cours",
  },
  theme: { toggle: "Changer de thème", dark: "Sombre", light: "Clair" },
};

export type Dictionary = typeof fr;
type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

const en: DeepPartial<Dictionary> = {};
const nl: DeepPartial<Dictionary> = {};

const dictionaries: Record<Locale, DeepPartial<Dictionary>> = { fr, en, nl };

function merge<T>(base: T, override: DeepPartial<T> | undefined): T {
  if (!override) return base;
  const out = { ...base } as Record<string, unknown>;
  for (const [k, v] of Object.entries(override)) {
    const b = (base as Record<string, unknown>)[k];
    out[k] = v && typeof v === "object" && !Array.isArray(v) ? merge(b, v as DeepPartial<typeof b>) : (v ?? b);
  }
  return out as T;
}

export function getDictionary(locale: string | undefined): Dictionary {
  const l = (LOCALES as readonly string[]).includes(locale ?? "") ? (locale as Locale) : "fr";
  return merge(fr, dictionaries[l]);
}
