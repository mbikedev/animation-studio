export interface UploadTarget {
  /** Where the browser sends the file (PUT). */
  url: string;
  method: "PUT";
  headers: Record<string, string>;
}

/**
 * Private media storage. Paths are always assigned by the server:
 * `<owner_id>/<kind>/<random uuid>` (no user-controlled segment). Signed URLs are short-lived and are
 * never persisted as identifiers.
 */
export interface MediaStorage {
  readonly bucket: string;
  createUploadTarget(path: string, mimeType: string): Promise<UploadTarget>;
  getObject(path: string): Promise<Uint8Array | null>;
  putObject(path: string, bytes: Uint8Array, mimeType: string): Promise<void>;
  deleteObject(path: string): Promise<void>;
  signedReadUrl(path: string, ttlSeconds: number, opts?: { download?: string }): Promise<string>;
}

export const SIGNED_URL_TTL_SECONDS = 300;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function newStoragePath(ownerId: string, kind: "image" | "audio" | "video"): string {
  if (!UUID_RE.test(ownerId)) throw new Error("invalid owner id");
  return `${ownerId}/${kind}/${crypto.randomUUID()}`;
}

export function isValidStoragePath(path: string): boolean {
  const [owner, kind, id, ...rest] = path.split("/");
  return rest.length === 0 && UUID_RE.test(owner ?? "") && ["image", "audio", "video"].includes(kind ?? "") && UUID_RE.test(id ?? "");
}

export const EXTENSION_FOR_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "video/mp4": ".mp4",
};
