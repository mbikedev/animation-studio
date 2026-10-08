import Link from "next/link";
import { Alert } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/fields";
import { signInAction } from "../actions";
import { AuthForm } from "../auth-form";

export const metadata = { title: "Connexion" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  return (
    <>
      <h1 className="mb-4 text-xl font-semibold">Connexion</h1>
      {params.confirmed && <Alert tone="success" className="mb-4">Adresse confirmée. Vous pouvez vous connecter.</Alert>}
      {params.reset && <Alert tone="success" className="mb-4">Mot de passe modifié.</Alert>}
      {params.error && <Alert tone="danger" className="mb-4">Lien invalide ou expiré.</Alert>}
      <AuthForm action={signInAction} submitLabel="Se connecter">
        <div className="grid gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="password">Mot de passe</Label>
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
      </AuthForm>
      <div className="mt-4 flex justify-between text-sm">
        <Link href="/forgot-password" className="text-muted underline">
          Mot de passe oublié
        </Link>
        <Link href="/signup" className="text-accent underline">
          Créer un compte
        </Link>
      </div>
    </>
  );
}
