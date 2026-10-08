import Link from "next/link";
import { Brand } from "@/components/brand";

export const metadata = { title: "Confidentialité (brouillon)" };

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <Brand />
      <article className="mt-8 grid gap-4 text-sm leading-6">
        <p className="rounded-lg bg-warning/15 px-4 py-3 font-medium text-warning">
          Brouillon non validé juridiquement. Ce texte doit être relu et complété avant toute ouverture publique.
        </p>
        <h1 className="text-2xl font-semibold">Politique de confidentialité (brouillon)</h1>
        <h2 className="font-semibold">Données traitées</h2>
        <p>Adresse email et identifiant de compte ; images, audios et textes importés ; vidéos générées ; historique de crédits et d&apos;achats ; journaux techniques sans contenu média.</p>
        <h2 className="font-semibold">Sous-traitants envisagés</h2>
        <p>Hébergement (Vercel), base de données et stockage (Supabase), tâches de fond (Trigger.dev), génération vidéo (Hedra), synthèse vocale optionnelle (ElevenLabs), paiement (Stripe), suivi d&apos;erreurs optionnel (Sentry).</p>
        <h2 className="font-semibold">Consentement sur les images et voix</h2>
        <p>Vous ne devez importer que des images et voix pour lesquelles vous disposez des droits et du consentement des personnes représentées.</p>
        <h2 className="font-semibold">Conservation</h2>
        <p>Durées à définir par le propriétaire avant lancement. La suppression du compte retire les médias et les données du compte dans l&apos;application ; les justificatifs de paiement restent conservés par le prestataire de paiement.</p>
        <p>
          <Link href="/" className="underline">
            Retour à l&apos;accueil
          </Link>
        </p>
      </article>
    </div>
  );
}
