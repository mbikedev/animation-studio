import Link from "next/link";
import { FieldHint, Input, Label } from "@/components/ui/fields";
import { signUpAction } from "../actions";
import { AuthForm } from "../auth-form";

export const metadata = { title: "Créer un compte" };

export default function SignupPage() {
  return (
    <>
      <h1 className="mb-4 text-xl font-semibold">Créer un compte</h1>
      <AuthForm action={signUpAction} submitLabel="Créer mon compte">
        <div className="grid gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="password">Mot de passe</Label>
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required aria-describedby="pw-hint" />
          <FieldHint id="pw-hint">10 caractères minimum.</FieldHint>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="terms" className="mt-1" required />
          <span>
            J&apos;accepte les conditions d&apos;utilisation et la <Link href="/privacy" className="underline">politique de confidentialité</Link> (brouillons à valider), et je
            m&apos;engage à n&apos;utiliser que des images et voix pour lesquelles j&apos;ai les droits et le consentement.
          </span>
        </label>
      </AuthForm>
      <p className="mt-4 text-sm text-muted">
        Déjà inscrit ? <Link href="/login" className="text-accent underline">Connexion</Link>
      </p>
    </>
  );
}
