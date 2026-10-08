import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Downloads a provider output URL with SSRF protections:
 * https only, no credentials in URL, DNS resolved and checked against
 * private / loopback / link-local / reserved ranges, redirects followed
 * manually (each hop re-checked), bounded size and time.
 *
 * Remaining risk (documented): DNS rebinding between our lookup and the
 * connection. Mitigation in production: egress restrictions on the worker.
 */

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (version === 6) {
    const lower = address.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return (
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("fe8") ||
      lower.startsWith("fe9") ||
      lower.startsWith("fea") ||
      lower.startsWith("feb") ||
      lower.startsWith("ff") ||
      lower.startsWith("64:ff9b:") ||
      lower.startsWith("2001:db8")
    );
  }
  return true;
}

export type Resolver = (hostname: string) => Promise<string[]>;

const defaultResolver: Resolver = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map((r) => r.address);

export async function assertPublicHttpsUrl(raw: string, resolver: Resolver = defaultResolver): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("URL invalide");
  }
  if (url.protocol !== "https:") throw new UnsafeUrlError("Seules les URL https sont acceptées");
  if (url.username || url.password) throw new UnsafeUrlError("Identifiants interdits dans l'URL");
  if (url.port && url.port !== "443") throw new UnsafeUrlError("Port non autorisé");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new UnsafeUrlError("Hôte interne refusé");
  }
  const addresses = isIP(host) ? [host] : await resolver(host);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new UnsafeUrlError("Adresse privée ou réservée refusée");
  }
  return url;
}

export async function safeDownload(
  raw: string,
  options: {
    maxBytes: number;
    timeoutMs: number;
    maxRedirects?: number;
    fetchImpl?: typeof fetch;
    resolver?: Resolver;
  },
): Promise<{ bytes: Uint8Array; contentType: string | null }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    let current = raw;
    for (let hop = 0; hop <= (options.maxRedirects ?? 3); hop++) {
      const url = await assertPublicHttpsUrl(current, options.resolver);
      const res = await fetchImpl(url, { redirect: "manual", signal: controller.signal });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) throw new UnsafeUrlError("Redirection sans destination");
        current = new URL(location, url).toString();
        continue;
      }
      if (!res.ok || !res.body) throw new Error(`download_failed_${res.status}`);
      const declared = Number(res.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > options.maxBytes) throw new UnsafeUrlError("Fichier trop volumineux");
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > options.maxBytes) {
          await reader.cancel();
          throw new UnsafeUrlError("Fichier trop volumineux");
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        bytes.set(c, offset);
        offset += c.byteLength;
      }
      return { bytes, contentType: res.headers.get("content-type") };
    }
    throw new UnsafeUrlError("Trop de redirections");
  } finally {
    clearTimeout(timer);
  }
}
