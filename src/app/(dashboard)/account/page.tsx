import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { DeleteAccount } from "./delete-account";

export const metadata = { title: "Compte" };

export default async function AccountPage() {
  const user = await requireUser();
  return (
    <div className="mx-auto grid max-w-2xl gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Compte</h1>
      <Card>
        <CardTitle>Identité</CardTitle>
        <CardDescription>{user.email}</CardDescription>
        <p className="mt-3 text-sm text-muted">Langue de l&apos;interface : français (anglais et néerlandais prévus).</p>
      </Card>
      <Card>
        <CardTitle>Supprimer mon compte</CardTitle>
        <CardDescription>
          Supprime vos images, audios, vidéos, projets et votre profil. Les écritures de facturation et d&apos;audit nécessaires sont conservées selon la durée définie
          dans la politique de confidentialité (à valider). Impossible pendant une génération en cours.
        </CardDescription>
        <DeleteAccount />
      </Card>
    </div>
  );
}
