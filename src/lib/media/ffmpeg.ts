import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/** Thin, timeout-bounded wrappers around ffprobe / ffmpeg (no shell). */

function run(bin: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stderr }));
      else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

export interface ProbeResult {
  formatName: string;
  durationMs: number | null;
  hasAudio: boolean;
  hasVideo: boolean;
  width: number | null;
  height: number | null;
}

export async function withTempFile<T>(bytes: Uint8Array, ext: string, fn: (file: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "animstudio-"));
  const file = path.join(dir, `input${ext}`);
  try {
    await writeFile(file, bytes);
    return await fn(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function probeFile(ffprobe: string, file: string): Promise<ProbeResult> {
  const { stdout } = await run(
    ffprobe,
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file],
    15_000,
  );
  const data = JSON.parse(stdout) as {
    format?: { format_name?: string; duration?: string };
    streams?: Array<{ codec_type?: string; width?: number; height?: number; duration?: string }>;
  };
  const streams = data.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  const durationSec = Number(data.format?.duration ?? streams.find((s) => s.duration)?.duration);
  return {
    formatName: data.format?.format_name ?? "",
    durationMs: Number.isFinite(durationSec) ? Math.round(durationSec * 1000) : null,
    hasAudio: streams.some((s) => s.codec_type === "audio"),
    hasVideo: Boolean(video),
    width: video?.width ?? null,
    height: video?.height ?? null,
  };
}

export async function probeBytes(ffprobe: string, bytes: Uint8Array, ext: string): Promise<ProbeResult> {
  return withTempFile(bytes, ext, (file) => probeFile(ffprobe, file));
}

export async function isToolAvailable(bin: string): Promise<boolean> {
  try {
    await run(bin, ["-version"], 5_000);
    return true;
  } catch {
    return false;
  }
}

/**
 * Demo rendering: a still image with a slow zoom over the uploaded audio and
 * a visible "demonstration" label. This is NOT AI animation.
 */
export async function renderDemoVideo(params: {
  ffmpeg: string;
  image: Uint8Array;
  imageExt: string;
  audio: Uint8Array | null;
  audioExt: string;
  width: number;
  height: number;
  durationMs: number;
}): Promise<Uint8Array> {
  const dir = await mkdtemp(path.join(tmpdir(), "animstudio-demo-"));
  try {
    const img = path.join(dir, `image${params.imageExt}`);
    const out = path.join(dir, "out.mp4");
    await writeFile(img, params.image);
    const seconds = Math.max(1, Math.min(30, params.durationMs / 1000)).toFixed(2);
    const { width: w, height: h } = params;
    const frames = Math.round(Number(seconds) * 25);
    const filter = [
      `scale=${w * 2}:${h * 2}:force_original_aspect_ratio=decrease`,
      `pad=${w * 2}:${h * 2}:(ow-iw)/2:(oh-ih)/2:color=0x111318`,
      `zoompan=z='min(zoom+0.0008,1.12)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${w}x${h}:fps=25`,
      `drawtext=text='DEMONSTRATION - aucune IA':fontcolor=white@0.85:fontsize=${Math.round(h / 22)}:box=1:boxcolor=black@0.45:boxborderw=8:x=(w-text_w)/2:y=h-text_h-${Math.round(h / 18)}`,
      "format=yuv420p",
    ].join(",");
    const args = ["-y", "-loop", "1", "-i", img];
    if (params.audio) {
      const aud = path.join(dir, `audio${params.audioExt}`);
      await writeFile(aud, params.audio);
      args.push("-i", aud);
    } else {
      args.push("-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono");
    }
    args.push(
      "-filter_complex", `[0:v]${filter}[v]`,
      "-map", "[v]", "-map", "1:a",
      "-t", seconds,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "28",
      "-c:a", "aac", "-b:a", "96k",
      "-movflags", "+faststart",
      "-shortest",
      out,
    );
    await run(params.ffmpeg, args, 120_000);
    return new Uint8Array(await readFile(out));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function dimensionsFor(aspect: "16:9" | "9:16" | "1:1", resolution: "540p" | "720p" | "1080p") {
  const short = { "540p": 540, "720p": 720, "1080p": 1080 }[resolution];
  const long = Math.round((short * 16) / 9 / 2) * 2;
  if (aspect === "16:9") return { width: long, height: short };
  if (aspect === "9:16") return { width: short, height: long };
  return { width: short, height: short };
}
