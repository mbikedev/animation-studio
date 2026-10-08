"use client";

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly data?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { ...(init?.json !== undefined ? { "content-type": "application/json" } : {}), ...(init?.headers ?? {}) },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } }).error ?? {};
    throw new ApiError(err.code ?? "error", err.message ?? "Une erreur est survenue.", res.status, data.error);
  }
  return data as T;
}

export interface UploadedAsset {
  asset: { id: string; kind: "image" | "audio"; mimeType: string | null; durationMs: number | null; width: number | null; height: number | null; sizeBytes: number | null };
  previewUrl: string;
}

const AUDIO_MIME: Record<string, string> = { mp3: "audio/mpeg", wav: "audio/wav" };

/** Normalises the declared type (browsers disagree on MP3/WAV names). */
function declaredType(file: File): string {
  if (file.type === "audio/mp3") return "audio/mpeg";
  if (file.type === "audio/x-wav" || file.type === "audio/wave") return "audio/wav";
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return AUDIO_MIME[ext] ?? "application/octet-stream";
}

export async function uploadFile(file: File, kind: "image" | "audio", projectId: string): Promise<UploadedAsset> {
  const init = await api<{ assetId: string; upload: { url: string; method: "PUT"; headers: Record<string, string> } }>("/api/uploads", {
    method: "POST",
    json: { kind, projectId, declaredType: declaredType(file), sizeBytes: file.size },
  });
  const put = await fetch(init.upload.url, { method: init.upload.method, headers: init.upload.headers, body: file });
  if (!put.ok) throw new ApiError("upload_failed", "L'envoi du fichier a échoué.", put.status);
  return api<UploadedAsset>(`/api/uploads/${init.assetId}/finalize`, { method: "POST" });
}
