import { Input, Label } from "@/components/ui/fields";
import { forgotPasswordAction } from "../actions";
import { AuthForm } from "../auth-form";

export const metadata = { title: "Mot de passe oublié" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="mb-4 text-xl font-semibold">Mot de passe oublié</h1>
      <AuthForm action={forgotPasswordAction} submitLabel="Envoyer le lien">
        <div className="grid gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </div>
      </AuthForm>
    </>
  );
}
