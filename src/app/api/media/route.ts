import { NextResponse, type NextRequest } from "next/server";
import { getServices } from "@/lib/container";
import { sniffType } from "@/lib/media/inspect";
import { verifyExpiring } from "@/lib/security/signing";

/** Demo-only signed media links (stand-in for Supabase signed URLs). */
export async function GET(request: NextRequest) {
  const services = getServices();
  if (services.config.mode !== "demo") return new NextResponse(null, { status: 404 });
  const p = request.nextUrl.searchParams.get("p") ?? "";
  const exp = Number(request.nextUrl.searchParams.get("e"));
  const sig = request.nextUrl.searchParams.get("s") ?? "";
  if (!verifyExpiring(services.config.demo.secret, "read", p, exp, sig)) return new NextResponse(null, { status: 403 });
  const bytes = await services.storage.getObject(p);
  if (!bytes) return new NextResponse(null, { status: 404 });
  const type = sniffType(bytes) ?? "application/octet-stream";
  const download = request.nextUrl.searchParams.get("d");
  const headers: Record<string, string> = {
    "content-type": type,
    "content-length": String(bytes.length),
    "cache-control": "private, max-age=60",
    "x-content-type-options": "nosniff",
    "accept-ranges": "none",
  };
  if (download) headers["content-disposition"] = `attachment; filename="${download.replace(/[^\w.\- ]/g, "_")}"`;
  return new NextResponse(bytes as BodyInit, { headers });
}
