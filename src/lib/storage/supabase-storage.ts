import type { SupabaseClient } from "@supabase/supabase-js";
import { isValidStoragePath, type MediaStorage, type UploadTarget } from "./types";

/**
 * Supabase Storage (private bucket). Browser uploads go straight to Storage
 * through a server-issued signed upload URL; the server then validates the
 * object before marking the asset ready. Status: "à valider en réel".
 */
export class SupabaseMediaStorage implements MediaStorage {
  constructor(
    private readonly db: SupabaseClient,
    readonly bucket: string,
  ) {}

  private assertPath(p: string) {
    if (!isValidStoragePath(p)) throw new Error("invalid storage path");
  }

  async createUploadTarget(p: string, mimeType: string): Promise<UploadTarget> {
    this.assertPath(p);
    const { data, error } = await this.db.storage.from(this.bucket).createSignedUploadUrl(p);
    if (error || !data) throw new Error(`storage_upload_url_failed`);
    return { url: data.signedUrl, method: "PUT", headers: { "content-type": mimeType, "x-upsert": "false" } };
  }

  async getObject(p: string): Promise<Uint8Array | null> {
    this.assertPath(p);
    const { data, error } = await this.db.storage.from(this.bucket).download(p);
    if (error || !data) return null;
    return new Uint8Array(await data.arrayBuffer());
  }

  async putObject(p: string, bytes: Uint8Array, mimeType: string): Promise<void> {
    this.assertPath(p);
    const { error } = await this.db.storage.from(this.bucket).upload(p, bytes, { contentType: mimeType, upsert: true });
    if (error) throw new Error("storage_upload_failed");
  }

  async deleteObject(p: string): Promise<void> {
    this.assertPath(p);
    const { error } = await this.db.storage.from(this.bucket).remove([p]);
    if (error) throw new Error("storage_delete_failed");
  }

  async signedReadUrl(p: string, ttlSeconds: number, opts?: { download?: string }): Promise<string> {
    this.assertPath(p);
    const { data, error } = await this.db.storage
      .from(this.bucket)
      .createSignedUrl(p, ttlSeconds, opts?.download ? { download: opts.download } : undefined);
    if (error || !data) throw new Error("storage_signed_url_failed");
    return data.signedUrl;
  }
}
