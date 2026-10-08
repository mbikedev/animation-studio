import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { getServices } from "@/lib/container";
import { AppError, type UserIdentity } from "@/lib/domain";
import { logger } from "@/lib/logger";

/** Shared guards for JSON route handlers. */

export function assertSameOrigin(request: Request): void {
  const { baseUrl } = getServices().config;
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  const allowed = new URL(baseUrl).origin;
  const host = request.headers.get("host");
  const sameHost = origin && host && new URL(origin).host === host;
  if (origin ? origin !== allowed && !sameHost : fetchSite !== null && fetchSite !== "same-origin") {
    throw new AppError("forbidden_origin", "Origine non autorisée.", 403);
  }
}

export async function requireApiUser(): Promise<UserIdentity> {
  const user = await getCurrentUser();
  if (!user) throw new AppError("unauthenticated", "Connexion requise.", 401);
  return user;
}

export async function requireApiAdmin(): Promise<UserIdentity> {
  const user = await requireApiUser();
  if (!user.isAdmin) throw new AppError("forbidden", "Accès réservé aux administrateurs.", 403);
  return user;
}

export async function rateLimit(key: string, windowSeconds: number, max: number): Promise<void> {
  const ok = await getServices().store.hitRateLimit(key, windowSeconds, max);
  if (!ok) throw new AppError("rate_limited", "Trop de requêtes, réessayez dans un instant.", 429);
}

export function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof AppError) {
    return NextResponse.json({ error: { code: error.code, message: error.message, ...error.details } }, { status: error.httpStatus });
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: { code: "invalid_input", message: error.issues[0]?.message ?? "Données invalides." } },
      { status: 400 },
    );
  }
  logger.error("api.unhandled", { error });
  return NextResponse.json({ error: { code: "internal", message: "Erreur interne." } }, { status: 500 });
}

export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    return toErrorResponse(error);
  }
}
