import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { dimensionsFor, renderDemoVideo } from "@/lib/media/ffmpeg";
import {
  ProviderError,
  type ProviderJobStatus,
  type ProviderResult,
  type SpeechProvider,
  type SubmitVideoInput,
  type VideoCapabilities,
  type VideoProvider,
} from "./types";

/**
 * Simulated provider for APP_MODE=demo. No network, no cost.
 * Jobs advance through queued -> processing -> completed/failed with short
 * delays. The output is a still image with a zoom over the uploaded audio
 * (rendered with FFmpeg when available, otherwise a bundled fixture).
 */

interface DemoJob {
  id: string;
  idempotencyKey: string;
  createdAt: number;
  fail: boolean;
  aspectRatio: SubmitVideoInput["aspectRatio"];
  resolution: SubmitVideoInput["resolution"];
  durationMs: number;
  imagePath: string;
  audioPath: string;
}

export interface DemoProviderOptions {
  dataDir: string;
  ffmpeg: string;
  queuedMs?: number;
  processingMs?: number;
  /** Fallback MP4 when FFmpeg is unavailable. */
  fixturePath?: string;
  now?: () => number;
}

const EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
};

export class DemoVideoProvider implements VideoProvider {
  readonly name = "demo";
  private readonly dir: string;

  constructor(private readonly options: DemoProviderOptions) {
    this.dir = path.join(options.dataDir, "demo-provider");
  }

  private now() {
    return (this.options.now ?? Date.now)();
  }

  capabilities(): VideoCapabilities {
    return {
      provider: this.name,
      modelId: "demo-still-zoom-v1",
      aspectRatios: ["16:9", "9:16", "1:1"],
      resolutions: ["540p", "720p"],
      image: { mimeTypes: ["image/jpeg", "image/png", "image/webp"], maxBytes: 10 * 1024 * 1024 },
      audio: { mimeTypes: ["audio/mpeg", "audio/wav"], maxBytes: 25 * 1024 * 1024, minDurationMs: 500, maxDurationMs: 30_000 },
      maxOutputDurationMs: 30_000,
      supportsCancel: true,
      reportsProgress: false,
      supportsIdempotencyKey: true,
    };
  }

  private async readJobs(): Promise<Record<string, DemoJob>> {
    try {
      return JSON.parse(await readFile(path.join(this.dir, "jobs.json"), "utf8"));
    } catch {
      return {};
    }
  }

  private async writeJobs(jobs: Record<string, DemoJob>) {
    await mkdir(this.dir, { recursive: true });
    await writeFile(path.join(this.dir, "jobs.json"), JSON.stringify(jobs, null, 2));
  }

  async submit(input: SubmitVideoInput): Promise<{ providerJobId: string }> {
    const jobs = await this.readJobs();
    const existing = Object.values(jobs).find((j) => j.idempotencyKey === input.idempotencyKey);
    if (existing) return { providerJobId: existing.id };

    const id = `demo_${crypto.randomUUID()}`;
    await mkdir(this.dir, { recursive: true });
    const imagePath = path.join(this.dir, `${id}-image${EXT[input.image.mimeType] ?? ".bin"}`);
    const audioPath = path.join(this.dir, `${id}-audio${EXT[input.audio.mimeType] ?? ".bin"}`);
    await writeFile(imagePath, await input.image.load());
    await writeFile(audioPath, await input.audio.load());
    jobs[id] = {
      id,
      idempotencyKey: input.idempotencyKey,
      createdAt: this.now(),
      fail: Boolean(input.simulateFailure),
      aspectRatio: input.aspectRatio,
      resolution: input.resolution,
      durationMs: input.durationMs,
      imagePath,
      audioPath,
    };
    await this.writeJobs(jobs);
    return { providerJobId: id };
  }

  async findByIdempotencyKey(key: string): Promise<{ providerJobId: string } | null> {
    const jobs = await this.readJobs();
    const job = Object.values(jobs).find((j) => j.idempotencyKey === key);
    return job ? { providerJobId: job.id } : null;
  }

  private async job(id: string): Promise<DemoJob> {
    const job = (await this.readJobs())[id];
    if (!job) throw new ProviderError("demo_job_not_found", "Tâche de démonstration introuvable.", "rejected");
    return job;
  }

  async getStatus(providerJobId: string): Promise<ProviderJobStatus> {
    const job = await this.job(providerJobId);
    const elapsed = this.now() - job.createdAt;
    const queuedMs = this.options.queuedMs ?? 1500;
    const processingMs = this.options.processingMs ?? 3500;
    if (elapsed < queuedMs) return { state: "queued" };
    if (elapsed < queuedMs + processingMs) return { state: "processing" };
    if (job.fail) {
      return { state: "failed", errorCode: "demo_simulated_failure", errorMessage: "Échec simulé (démonstration).", retryable: false };
    }
    return { state: "completed" };
  }

  async getResult(providerJobId: string): Promise<ProviderResult> {
    const job = await this.job(providerJobId);
    const { width, height } = dimensionsFor(job.aspectRatio, job.resolution === "1080p" ? "720p" : job.resolution);
    const options = this.options;
    return {
      url: `demo://${providerJobId}`,
      contentType: "video/mp4",
      durationMs: job.durationMs,
      width,
      height,
      actualCostMinor: 0,
      currency: null,
      async loadBytes() {
        try {
          return await renderDemoVideo({
            ffmpeg: options.ffmpeg,
            image: await readFile(job.imagePath),
            imageExt: path.extname(job.imagePath),
            audio: await readFile(job.audioPath),
            audioExt: path.extname(job.audioPath),
            width,
            height,
            durationMs: job.durationMs,
          });
        } catch {
          const fixture = options.fixturePath ?? path.join(process.cwd(), "public", "demo", "sample.mp4");
          return new Uint8Array(await readFile(/*turbopackIgnore: true*/ fixture));
        }
      },
    };
  }

  async cancel(providerJobId: string): Promise<void> {
    const jobs = await this.readJobs();
    delete jobs[providerJobId];
    await this.writeJobs(jobs);
  }
}

/** Demo speech: a short tone whose length follows the text, clearly not a voice. */
export class DemoSpeechProvider implements SpeechProvider {
  readonly name = "demo-voice";
  constructor(private readonly ffmpeg: string) {}

  async synthesize(input: { text: string }): Promise<{ bytes: Uint8Array; mimeType: string }> {
    const { execFile } = await import("node:child_process");
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const dir = await mkdtemp(path.join(tmpdir(), "animstudio-tts-"));
    // ~14 characters per second of speech, clamped to [1s, 60s].
    const seconds = Math.min(60, Math.max(1, input.text.length / 14)).toFixed(2);
    const out = path.join(dir, "speech.wav");
    try {
      await new Promise<void>((resolve, reject) =>
        execFile(
          this.ffmpeg,
          ["-y", "-f", "lavfi", "-i", `sine=frequency=220:duration=${seconds}`, "-af", "volume=0.2", "-ac", "1", "-ar", "22050", out],
          { timeout: 30_000 },
          (err) => (err ? reject(err) : resolve()),
        ),
      );
      return { bytes: new Uint8Array(await readFile(out)), mimeType: "audio/wav" };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
