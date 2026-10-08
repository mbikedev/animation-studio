import { describe, expect, it } from "vitest";
import { assertPublicHttpsUrl, isPrivateAddress, safeDownload } from "@/lib/security/safe-fetch";

const publicResolver = async () => ["93.184.216.34"];

describe("provider output URL safety", () => {
  it("classifies private and reserved addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "0.0.0.0", "::1", "fd00::1", "::ffff:127.0.0.1", "100.64.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
  });

  it("rejects non-https, credentials, internal hosts and private DNS answers", async () => {
    await expect(assertPublicHttpsUrl("http://cdn.example.com/a.mp4", publicResolver)).rejects.toThrow();
    await expect(assertPublicHttpsUrl("https://user:pw@cdn.example.com/a.mp4", publicResolver)).rejects.toThrow();
    await expect(assertPublicHttpsUrl("https://localhost/a.mp4", publicResolver)).rejects.toThrow();
    await expect(assertPublicHttpsUrl("https://169.254.169.254/latest/meta-data", publicResolver)).rejects.toThrow();
    await expect(assertPublicHttpsUrl("https://evil.example.com/a.mp4", async () => ["10.0.0.5"])).rejects.toThrow();
    await expect(assertPublicHttpsUrl("https://cdn.example.com:8443/a.mp4", publicResolver)).rejects.toThrow();
    await expect(assertPublicHttpsUrl("https://cdn.example.com/a.mp4", publicResolver)).resolves.toBeInstanceOf(URL);
  });

  it("re-checks every redirect hop", async () => {
    const fetchImpl = (async (url: URL) => {
      if (url.hostname === "cdn.example.com") return new Response(null, { status: 302, headers: { location: "https://internal.example.com/x" } });
      return new Response("secret");
    }) as unknown as typeof fetch;
    const resolver = async (h: string) => (h === "internal.example.com" ? ["192.168.0.10"] : ["93.184.216.34"]);
    await expect(safeDownload("https://cdn.example.com/a.mp4", { maxBytes: 1000, timeoutMs: 1000, fetchImpl, resolver })).rejects.toThrow(/privée/);
  });

  it("enforces the size cap while streaming", async () => {
    const fetchImpl = (async () => new Response(new Uint8Array(2048))) as unknown as typeof fetch;
    await expect(safeDownload("https://cdn.example.com/a.mp4", { maxBytes: 1024, timeoutMs: 1000, fetchImpl, resolver: publicResolver })).rejects.toThrow(/volumineux/);
  });
});
