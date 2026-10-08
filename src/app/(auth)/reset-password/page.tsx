import { Input, Label } from "@/components/ui/fields";
import { resetPasswordAction } from "../actions";
import { AuthForm } from "../auth-form";

export const metadata = { title: "Nouveau mot de passe" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  return (
    <>
      <h1 className="mb-4 text-xl font-semibold">Nouveau mot de passe</h1>
      <AuthForm action={resetPasswordAction} submitLabel="Enregistrer">
        {params.demo_token && <input type="hidden" name="demo_token" value={params.demo_token} />}
        {params.email && <input type="hidden" name="email" value={params.email} />}
        <div className="grid gap-1.5">
          <Label htmlFor="password">Nouveau mot de passe</Label>
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="confirm">Confirmation</Label>
          <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={10} required />
        </div>
      </AuthForm>
    </>
  );
}
