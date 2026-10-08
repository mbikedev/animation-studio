"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requestPasswordReset, signIn, signOut, signUp, updatePassword } from "@/lib/auth/session";
import { getServices } from "@/lib/container";
import { AppError } from "@/lib/domain";
import { emailSchema, passwordSchema } from "@/lib/validation/schemas";

export interface AuthState {
  error?: string;
  message?: string;
  demoLink?: string;
}

async function limit(action: string, max: number) {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const ok = await getServices().store.hitRateLimit(`auth:${action}:${ip}`, 600, max);
  if (!ok) throw new AppError("rate_limited", "Trop de tentatives. Réessayez dans quelques minutes.", 429);
}

function message(error: unknown): AuthState {
  if (error instanceof AppError) return { error: error.message };
  return { error: "Une erreur est survenue. Réessayez." };
}

export async function signInAction(_: AuthState, form: FormData): Promise<AuthState> {
  try {
    await limit("signin", 10);
    const email = emailSchema.parse(form.get("email"));
    const password = String(form.get("password") ?? "");
    await signIn(email, password);
  } catch (error) {
    if (error && typeof error === "object" && "issues" in error) return { error: "Email invalide." };
    return message(error);
  }
  redirect("/studio");
}

export async function signUpAction(_: AuthState, form: FormData): Promise<AuthState> {
  try {
    await limit("signup", 5);
    const email = emailSchema.safeParse(form.get("email"));
    if (!email.success) return { error: "Email invalide." };
    const password = passwordSchema.safeParse(form.get("password"));
    if (!password.success) return { error: password.error.issues[0]?.message };
    if (form.get("terms") !== "on") return { error: "Veuillez accepter les conditions (brouillon) pour continuer." };
    const result = await signUp(email.data, password.data);
    return {
      message: "Compte créé. Confirmez votre adresse email pour vous connecter.",
      demoLink: result.demoConfirmUrl,
    };
  } catch (error) {
    return message(error);
  }
}

export async function forgotPasswordAction(_: AuthState, form: FormData): Promise<AuthState> {
  try {
    await limit("reset", 5);
    const email = emailSchema.safeParse(form.get("email"));
    if (!email.success) return { error: "Email invalide." };
    const result = await requestPasswordReset(email.data);
    return { message: "Si un compte existe pour cette adresse, un lien de réinitialisation a été envoyé.", demoLink: result.demoResetUrl };
  } catch (error) {
    return message(error);
  }
}

export async function resetPasswordAction(_: AuthState, form: FormData): Promise<AuthState> {
  try {
    await limit("update-password", 10);
    const password = passwordSchema.safeParse(form.get("password"));
    if (!password.success) return { error: password.error.issues[0]?.message };
    if (form.get("password") !== form.get("confirm")) return { error: "Les mots de passe ne correspondent pas." };
    const token = form.get("demo_token");
    const email = form.get("email");
    await updatePassword(password.data, token && email ? { token: String(token), email: String(email) } : undefined);
  } catch (error) {
    return message(error);
  }
  redirect("/login?reset=1");
}

export async function signOutAction() {
  await signOut();
  redirect("/");
}
