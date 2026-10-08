import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getServices } from "@/lib/container";
import { getUserClient } from "@/lib/db/supabase";
import { AppError, type UserIdentity } from "@/lib/domain";
import type { DemoStore } from "@/lib/repositories/demo-store";
import { sign, verifySignature } from "@/lib/security/signing";
import { hashPassword, verifyPassword } from "./password";

/**
 * Authentication facade.
 * - live: Supabase Auth (email confirmation and password recovery by email).
 * - demo: local accounts, signed session cookie; confirmation and reset
 *   links are displayed on screen instead of emailed. These code paths
 *   refuse to run when APP_MODE=live.
 */

const DEMO_COOKIE = "as_demo_session";
const DEMO_SESSION_TTL = 7 * 24 * 3600;

function demoStore(): DemoStore {
  const services = getServices();
  if (services.config.mode !== "demo" || services.store.kind !== "demo") {
    throw new Error("Demo authentication is not available in live mode");
  }
  return services.store as DemoStore;
}

async function readDemoSession(): Promise<string | null> {
  const services = getServices();
  if (services.config.mode !== "demo") return null;
  const raw = (await cookies()).get(DEMO_COOKIE)?.value;
  if (!raw) return null;
  const [userId, exp, sig] = raw.split(".");
  if (!userId || !exp || !sig) return null;
  if (Number(exp) < Date.now() / 1000) return null;
  return verifySignature(services.config.demo.secret, `session|${userId}|${exp}`, sig) ? userId : null;
}

async function writeDemoSession(userId: string) {
  const services = getServices();
  const exp = Math.floor(Date.now() / 1000) + DEMO_SESSION_TTL;
  const sig = sign(services.config.demo.secret, `session|${userId}|${exp}`);
  (await cookies()).set(DEMO_COOKIE, `${userId}.${exp}.${sig}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: services.config.baseUrl.startsWith("https://"),
    path: "/",
    maxAge: DEMO_SESSION_TTL,
  });
}

export async function getCurrentUser(): Promise<UserIdentity | null> {
  const services = getServices();
  if (services.config.mode === "demo") {
    const userId = await readDemoSession();
    if (!userId) return null;
    const user = await demoStore().demoFindUserById(userId);
    if (!user || !user.emailConfirmed) return null;
    return { id: user.id, email: user.email, emailConfirmed: true, isAdmin: await services.store.isAdmin(user.id) };
  }
  const supabase = await getUserClient();
  // getUser() validates the token with the Auth server (not just the cookie).
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const confirmed = Boolean(data.user.email_confirmed_at);
  if (!confirmed) return null;
  return {
    id: data.user.id,
    email: data.user.email ?? "",
    emailConfirmed: confirmed,
    isAdmin: await services.store.isAdmin(data.user.id),
  };
}

export async function requireUser(): Promise<UserIdentity> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin(): Promise<UserIdentity> {
  const user = await requireUser();
  if (!user.isAdmin) redirect("/studio");
  return user;
}

export async function signUp(email: string, password: string): Promise<{ demoConfirmUrl?: string }> {
  const services = getServices();
  if (services.config.mode === "demo") {
    const token = randomBytes(24).toString("base64url");
    await demoStore().demoCreateUser(email, await hashPassword(password), token);
    return { demoConfirmUrl: `/auth/confirm?demo_token=${token}&email=${encodeURIComponent(email)}` };
  }
  const supabase = await getUserClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${services.config.baseUrl}/auth/confirm` },
  });
  // Same response whether or not the email exists (no account enumeration).
  if (error && error.status !== 400 && error.status !== 422) throw new AppError("signup_failed", "Inscription impossible pour le moment.", 503);
  return {};
}

export async function confirmDemoEmail(email: string, token: string): Promise<boolean> {
  const store = demoStore();
  const user = await store.demoFindUserByEmail(email);
  if (!user || !user.confirmToken || user.confirmToken !== token) return false;
  await store.demoUpdateUser(user.id, { emailConfirmed: true, confirmToken: null });
  await store.ensureProfile({ id: user.id, email: user.email }, getServices().config.credits.signupBonus);
  return true;
}

export async function signIn(email: string, password: string): Promise<void> {
  const services = getServices();
  const invalid = new AppError("invalid_credentials", "Email ou mot de passe incorrect, ou email non confirmé.", 401);
  if (services.config.mode === "demo") {
    const user = await demoStore().demoFindUserByEmail(email);
    if (!user || !(await verifyPassword(password, user.passwordHash)) || !user.emailConfirmed) throw invalid;
    await services.store.ensureProfile({ id: user.id, email: user.email }, services.config.credits.signupBonus);
    await writeDemoSession(user.id);
    return;
  }
  const supabase = await getUserClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw invalid;
  await services.store.ensureProfile({ id: data.user.id, email: data.user.email ?? email }, services.config.credits.signupBonus);
}

export async function signOut(): Promise<void> {
  const services = getServices();
  if (services.config.mode === "demo") {
    (await cookies()).delete(DEMO_COOKIE);
    return;
  }
  const supabase = await getUserClient();
  await supabase.auth.signOut();
}

export async function requestPasswordReset(email: string): Promise<{ demoResetUrl?: string }> {
  const services = getServices();
  if (services.config.mode === "demo") {
    const store = demoStore();
    const user = await store.demoFindUserByEmail(email);
    if (!user) return {};
    const token = randomBytes(24).toString("base64url");
    await store.demoUpdateUser(user.id, { resetToken: token, resetTokenExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString() });
    return { demoResetUrl: `/reset-password?demo_token=${token}&email=${encodeURIComponent(email)}` };
  }
  const supabase = await getUserClient();
  await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${services.config.baseUrl}/auth/confirm?next=/reset-password` });
  return {};
}

export async function updatePassword(password: string, demo?: { email: string; token: string }): Promise<void> {
  const services = getServices();
  if (services.config.mode === "demo") {
    if (!demo) throw new AppError("invalid_token", "Lien invalide ou expiré.", 400);
    const store = demoStore();
    const user = await store.demoFindUserByEmail(demo.email);
    if (!user || !user.resetToken || user.resetToken !== demo.token || !user.resetTokenExpiresAt || user.resetTokenExpiresAt < new Date().toISOString()) {
      throw new AppError("invalid_token", "Lien invalide ou expiré.", 400);
    }
    await store.demoUpdateUser(user.id, { passwordHash: await hashPassword(password), resetToken: null, resetTokenExpiresAt: null });
    return;
  }
  const supabase = await getUserClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw new AppError("update_failed", "Lien invalide ou expiré.", 400);
}
