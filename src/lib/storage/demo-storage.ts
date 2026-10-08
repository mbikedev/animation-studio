import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { signExpiring } from "@/lib/security/signing";
import { isValidStoragePath, type MediaStorage, type UploadTarget } from "./types";

/** Local filesystem storage for APP_MODE=demo, served via signed links. */
export class DemoMediaStorage implements MediaStorage {
  readonly bucket = "demo-media";
  private readonly root: string;

  constructor(
    dataDir: string,
    private readonly secret: string,
  ) {
    this.root = path.resolve(dataDir, "storage");
  }

  private file(p: string): string {
    if (!isValidStoragePath(p)) throw new Error("invalid storage path");
    const full = path.resolve(this.root, p);
    if (!full.startsWith(this.root + path.sep)) throw new Error("path traversal");
    return full;
  }

  async createUploadTarget(p: string, mimeType: string): Promise<UploadTarget> {
    this.file(p);
    const { exp, sig } = signExpiring(this.secret, "upload", p, 600);
    const url = `/api/uploads/demo?p=${encodeURIComponent(p)}&e=${exp}&s=${sig}`;
    return { url, method: "PUT", headers: { "content-type": mimeType } };
  }

  async getObject(p: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.file(p)));
    } catch {
      return null;
    }
  }

  async putObject(p: string, bytes: Uint8Array): Promise<void> {
    const full = this.file(p);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, bytes);
  }

  async deleteObject(p: string): Promise<void> {
    await rm(this.file(p), { force: true });
  }

  async signedReadUrl(p: string, ttlSeconds: number, opts?: { download?: string }): Promise<string> {
    this.file(p);
    const { exp, sig } = signExpiring(this.secret, "read", p, ttlSeconds);
    const dl = opts?.download ? `&d=${encodeURIComponent(opts.download)}` : "";
    return `/api/media?p=${encodeURIComponent(p)}&e=${exp}&s=${sig}${dl}`;
  }
}
