import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { confirmDemoEmail } from "@/lib/auth/session";
import { getConfig } from "@/lib/config/env";
import { getUserClient } from "@/lib/db/supabase";

/** Email confirmation and password-recovery landing (demo token or Supabase). */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const config = getConfig();
  const nextParam = url.searchParams.get("next");
  const next = nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/studio";

  if (config.mode === "demo") {
    const ok = await confirmDemoEmail(url.searchParams.get("email") ?? "", url.searchParams.get("demo_token") ?? "");
    return NextResponse.redirect(new URL(ok ? "/login?confirmed=1" : "/login?error=1", url));
  }

  const supabase = await getUserClient();
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const code = url.searchParams.get("code");
  const { error } = tokenHash && type
    ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
    : code
      ? await supabase.auth.exchangeCodeForSession(code)
      : { error: new Error("missing token") };
  return NextResponse.redirect(new URL(error ? "/login?error=1" : next, url));
}
