import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Services } from "@/lib/container";
import { AppError, type Asset, type UserIdentity } from "@/lib/domain";
import { logger } from "@/lib/logger";
import { newStoragePath, EXTENSION_FOR_MIME, type UploadTarget } from "@/lib/storage/types";
import { probeBytes } from "./ffmpeg";
import {
  AUDIO_LIMITS,
  IMAGE_LIMITS,
  orientationFilter,
  readImageInfo,
  sha256Hex,
  sniffType,
  stripMetadata,
} from "./inspect";

/**
 * Two-step upload: (1) the server creates the asset row and a signed upload
 * target at a server-chosen path; (2) after the browser upload, `finalize`
 * inspects the real bytes and marks the asset ready or rejected.
 */

export async function initUpload(
  services: Services,
  user: UserIdentity,
  input: { kind: "image" | "audio"; projectId: string; declaredType: string; sizeBytes: number },
): Promise<{ asset: Asset; upload: UploadTarget }> {
  const maxBytes = input.kind === "image" ? IMAGE_LIMITS.maxBytes : AUDIO_LIMITS.maxBytes;
  if (input.sizeBytes > maxBytes) {
    throw new AppError("file_too_large", `Fichier trop volumineux (max ${Math.round(maxBytes / 1024 / 1024)} Mo).`, 413);
  }
  const allowed = input.kind === "image" ? ["image/jpeg", "image/png", "image/webp"] : ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave"];
  if (!allowed.includes(input.declaredType)) {
    throw new AppError("unsupported_type", input.kind === "image" ? "Formats acceptés : JPEG, PNG, WebP." : "Formats acceptés : MP3, WAV.", 415);
  }
  const project = await services.store.getProject(user.id, input.projectId);
  if (!project) throw new AppError("not_found", "Projet introuvable.", 404);
  const storagePath = newStoragePath(user.id, input.kind);
  const asset = await services.store.createAsset({
    ownerId: user.id,
    projectId: project.id,
    kind: input.kind,
    bucket: services.storage.bucket,
    storagePath,
  });
  const upload = await services.storage.createUploadTarget(storagePath, input.declaredType);
  return { asset, upload };
}

async function reject(services: Services, asset: Asset, code: string, message: string): Promise<never> {
  await services.storage.deleteObject(asset.storagePath).catch(() => undefined);
  await services.store.updateAsset(asset.id, { status: "rejected" });
  throw new AppError(code, message, 422);
}

async function bakeOrientation(ffmpeg: string, bytes: Uint8Array, filter: string): Promise<Uint8Array> {
  const dir = await mkdtemp(path.join(tmpdir(), "animstudio-orient-"));
  try {
    const input = path.join(dir, "in.jpg");
    const output = path.join(dir, "out.jpg");
    await writeFile(input, bytes);
    await new Promise<void>((resolve, reject) =>
      execFile(
        ffmpeg,
        ["-y", "-noautorotate", "-i", input, "-vf", filter, "-map_metadata", "-1", "-q:v", "2", output],
        { timeout: 30_000 },
        (err) => (err ? reject(err) : resolve()),
      ),
    );
    return new Uint8Array(await readFile(output));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function finalizeUpload(services: Services, user: UserIdentity, assetId: string): Promise<Asset> {
  const asset = await services.store.getAsset(user.id, assetId);
  if (!asset) throw new AppError("not_found", "Fichier introuvable.", 404);
  if (asset.status === "ready") return asset;
  if (asset.status !== "pending_upload") throw new AppError("invalid_state", "Ce fichier ne peut plus être validé.", 409);

  const original = await services.storage.getObject(asset.storagePath);
  if (!original) throw new AppError("upload_missing", "Le fichier n'a pas été reçu.", 409);

  const type = sniffType(original);
  if (asset.kind === "image") {
    if (original.length > IMAGE_LIMITS.maxBytes) return reject(services, asset, "file_too_large", "Image trop volumineuse (max 10 Mo).");
    if (type !== "image/jpeg" && type !== "image/png" && type !== "image/webp") {
      return reject(services, asset, "unsupported_type", "Le contenu n'est pas une image JPEG, PNG ou WebP.");
    }
    let info;
    try {
      info = readImageInfo(original, type);
    } catch {
      return reject(services, asset, "corrupt_file", "Image illisible ou corrompue.");
    }
    if (
      info.width < IMAGE_LIMITS.minSide ||
      info.height < IMAGE_LIMITS.minSide ||
      info.width > IMAGE_LIMITS.maxSide ||
      info.height > IMAGE_LIMITS.maxSide ||
      info.width * info.height > IMAGE_LIMITS.maxPixels
    ) {
      return reject(
        services,
        asset,
        "invalid_dimensions",
        `Dimensions refusées (${info.width}×${info.height}). Côté entre ${IMAGE_LIMITS.minSide} et ${IMAGE_LIMITS.maxSide} px, 40 mégapixels max.`,
      );
    }
    let cleaned: Uint8Array;
    let { width, height } = info;
    try {
      const filter = orientationFilter(info.orientation);
      if (filter) {
        cleaned = await bakeOrientation(services.config.tools.ffmpeg, original, filter);
        if ([5, 6, 7, 8].includes(info.orientation)) [width, height] = [height, width];
      } else {
        cleaned = stripMetadata(original, type);
      }
    } catch {
      return reject(services, asset, "corrupt_file", "Image illisible ou corrompue.");
    }
    if (cleaned !== original) await services.storage.putObject(asset.storagePath, cleaned, type);
    return services.store.updateAsset(asset.id, {
      status: "ready",
      mimeType: type,
      sizeBytes: cleaned.length,
      width,
      height,
      checksum: await sha256Hex(cleaned),
    });
  }

  // audio
  if (original.length > AUDIO_LIMITS.maxBytes) return reject(services, asset, "file_too_large", "Audio trop volumineux (max 25 Mo).");
  if (type !== "audio/mpeg" && type !== "audio/wav") return reject(services, asset, "unsupported_type", "Le contenu n'est pas un fichier MP3 ou WAV.");
  let durationMs: number | null;
  try {
    const probe = await probeBytes(services.config.tools.ffprobe, original, EXTENSION_FOR_MIME[type]);
    if (!probe.hasAudio || probe.hasVideo) return reject(services, asset, "invalid_audio", "Le fichier ne contient pas une piste audio valide.");
    durationMs = probe.durationMs;
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.error("upload.probe_failed", { assetId: asset.id, error });
    return reject(services, asset, "probe_failed", "Impossible d'analyser l'audio (outil d'analyse indisponible ou fichier corrompu).");
  }
  const maxMs = services.config.limits.maxVideoDurationSeconds * 1000;
  if (!durationMs || durationMs < AUDIO_LIMITS.minDurationMs) return reject(services, asset, "audio_too_short", "Audio trop court (0,5 s minimum).");
  if (durationMs > maxMs) {
    return reject(services, asset, "audio_too_long", `Audio trop long : ${(durationMs / 1000).toFixed(1)} s (maximum ${maxMs / 1000} s).`);
  }
  return services.store.updateAsset(asset.id, {
    status: "ready",
    mimeType: type,
    sizeBytes: original.length,
    durationMs,
    checksum: await sha256Hex(original),
  });
}
