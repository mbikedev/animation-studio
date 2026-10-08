import { NextResponse, type NextRequest } from "next/server";
import { getServices } from "@/lib/container";
import { AUDIO_LIMITS } from "@/lib/media/inspect";
import { verifyExpiring } from "@/lib/security/signing";

/** Demo-only upload target (stands in for a Supabase signed upload URL). */
export async function PUT(request: NextRequest) {
  const services = getServices();
  if (services.config.mode !== "demo") return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  const p = request.nextUrl.searchParams.get("p") ?? "";
  const exp = Number(request.nextUrl.searchParams.get("e"));
  const sig = request.nextUrl.searchParams.get("s") ?? "";
  if (!verifyExpiring(services.config.demo.secret, "upload", p, exp, sig)) {
    return NextResponse.json({ error: { code: "invalid_signature", message: "Lien d'envoi invalide ou expiré." } }, { status: 403 });
  }
  const declared = Number(request.headers.get("content-length"));
  if (declared > AUDIO_LIMITS.maxBytes) return NextResponse.json({ error: { code: "file_too_large" } }, { status: 413 });
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > AUDIO_LIMITS.maxBytes) return NextResponse.json({ error: { code: "file_too_large" } }, { status: 413 });
  await services.storage.putObject(p, bytes, request.headers.get("content-type") ?? "application/octet-stream");
  return new NextResponse(null, { status: 204 });
}
