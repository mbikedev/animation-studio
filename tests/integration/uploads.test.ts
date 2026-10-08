import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { finalizeUpload, initUpload } from "@/lib/media/assets";
import { makeServices, seedUser, MemoryStorage } from "../helpers/services";

const fixture = (n: string) => new Uint8Array(readFileSync(`tests/fixtures/${n}`));

async function upload(kind: "image" | "audio", bytes: Uint8Array, declaredType: string) {
  const ctx = makeServices();
  const seed = await seedUser(ctx.services, 0);
  const { asset } = await initUpload(ctx.services, seed.user, { kind, projectId: seed.project.id, declaredType, sizeBytes: bytes.length });
  (ctx.services.storage as MemoryStorage).objects.set(asset.storagePath, bytes);
  return { ctx, seed, asset, finalize: () => finalizeUpload(ctx.services, seed.user, asset.id) };
}

describe("uploads", () => {
  it("accepts a valid image and audio, measured server-side", async () => {
    const img = await upload("image", fixture("portrait.png"), "image/png");
    expect(await img.finalize()).toMatchObject({ status: "ready", mimeType: "image/png", width: 640, height: 640 });
    const aud = await upload("audio", fixture("voice.mp3"), "audio/mpeg");
    const ready = await aud.finalize();
    expect(ready.status).toBe("ready");
    expect(ready.durationMs).toBeGreaterThan(2900);
    expect(ready.durationMs).toBeLessThan(3200);
  });

  it("rejects a disguised file whatever the declared type", async () => {
    const fake = await upload("image", new TextEncoder().encode("<?php system($_GET['c']); ?> padding padding"), "image/png");
    await expect(fake.finalize()).rejects.toMatchObject({ code: "unsupported_type" });
    expect((await fake.ctx.store.getAssetById(fake.asset.id))?.status).toBe("rejected");
    expect((fake.ctx.services.storage as MemoryStorage).objects.has(fake.asset.storagePath)).toBe(false);
  });

  it("rejects audio longer than 30 seconds", async () => {
    const long = await upload("audio", fixture("too-long.wav"), "audio/wav");
    await expect(long.finalize()).rejects.toMatchObject({ code: "audio_too_long" });
  });

  it("rejects oversize declarations, unknown types and foreign projects up front", async () => {
    const ctx = makeServices();
    const a = await seedUser(ctx.services, 0);
    const b = await seedUser(ctx.services, 0);
    await expect(initUpload(ctx.services, a.user, { kind: "image", projectId: a.project.id, declaredType: "image/png", sizeBytes: 11 * 1024 * 1024 })).rejects.toMatchObject({ code: "file_too_large" });
    await expect(initUpload(ctx.services, a.user, { kind: "image", projectId: a.project.id, declaredType: "image/svg+xml", sizeBytes: 100 })).rejects.toMatchObject({ code: "unsupported_type" });
    await expect(initUpload(ctx.services, a.user, { kind: "image", projectId: b.project.id, declaredType: "image/png", sizeBytes: 100 })).rejects.toMatchObject({ code: "not_found" });
  });

  it("rejects images that are too small (dimension guard)", async () => {
    const tiny = await upload("image", fixture("portrait.png"), "image/png");
    // 640px is fine; craft a 100x100 header by patching IHDR width/height
    const bytes = fixture("portrait.png");
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    view.setUint32(16, 100);
    view.setUint32(20, 100);
    (tiny.ctx.services.storage as MemoryStorage).objects.set(tiny.asset.storagePath, bytes);
    await expect(tiny.finalize()).rejects.toMatchObject({ code: "invalid_dimensions" });
  });
});
