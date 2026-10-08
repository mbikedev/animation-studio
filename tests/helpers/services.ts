import { parseConfig } from "@/lib/config/env";
import type { Services } from "@/lib/container";
import type { Dispatcher } from "@/lib/generation/dispatcher";
import {
  ProviderError,
  type ProviderJobStatus,
  type ProviderResult,
  type SubmitVideoInput,
  type VideoCapabilities,
  type VideoProvider,
} from "@/lib/providers/types";
import { DemoStore } from "@/lib/repositories/demo-store";
import type { MediaStorage, UploadTarget } from "@/lib/storage/types";
import { readFileSync } from "node:fs";
import path from "node:path";

export class MemoryStorage implements MediaStorage {
  readonly bucket = "test";
  objects = new Map<string, Uint8Array>();
  putFailures = 0;
  async createUploadTarget(p: string, mimeType: string): Promise<UploadTarget> {
    return { url: `memory://${p}`, method: "PUT", headers: { "content-type": mimeType } };
  }
  async getObject(p: string) {
    return this.objects.get(p) ?? null;
  }
  async putObject(p: string, bytes: Uint8Array) {
    if (this.putFailures > 0) {
      this.putFailures--;
      throw new Error("storage_down");
    }
    this.objects.set(p, bytes);
  }
  async deleteObject(p: string) {
    this.objects.delete(p);
  }
  async signedReadUrl(p: string) {
    return `memory://${p}?sig=x`;
  }
}

export const SAMPLE_MP4 = () => new Uint8Array(readFileSync(path.join(process.cwd(), "public/demo/sample.mp4")));

/** Scriptable provider that counts billable submits. */
export class FakeProvider implements VideoProvider {
  readonly name = "fake";
  submits = 0;
  submitBehavior: Array<"ok" | "timeout" | "reject" | "retryable"> = [];
  statusSequence: ProviderJobStatus["state"][] = ["processing", "completed"];
  jobs = new Map<string, string>(); // idempotencyKey -> jobId
  idempotent = true;
  resultCost: number | null = 150;
  resultBytes: () => Uint8Array = SAMPLE_MP4;
  getResultCalls = 0;

  capabilities(): VideoCapabilities {
    return {
      provider: "fake",
      modelId: "fake-1",
      aspectRatios: ["16:9", "9:16", "1:1"],
      resolutions: ["540p", "720p"],
      image: { mimeTypes: ["image/png"], maxBytes: 10_000_000 },
      audio: { mimeTypes: ["audio/wav"], maxBytes: 25_000_000, minDurationMs: 500, maxDurationMs: 30_000 },
      maxOutputDurationMs: 30_000,
      supportsCancel: false,
      reportsProgress: false,
      supportsIdempotencyKey: this.idempotent,
    };
  }

  async submit(input: SubmitVideoInput) {
    const behavior = this.submitBehavior.shift() ?? "ok";
    if (behavior === "reject") throw new ProviderError("fake_rejected", "refused", "rejected");
    if (behavior === "retryable") throw new ProviderError("fake_429", "slow down", "retryable", 0);
    this.submits++;
    const existing = this.idempotent ? this.jobs.get(input.idempotencyKey) : undefined;
    const id = existing ?? `job_${this.submits}`;
    this.jobs.set(input.idempotencyKey, id);
    if (behavior === "timeout") throw new ProviderError("fake_timeout", "timeout", "unknown");
    return { providerJobId: id };
  }

  async findByIdempotencyKey(key: string) {
    const id = this.jobs.get(key);
    return id ? { providerJobId: id } : null;
  }

  async getStatus(): Promise<ProviderJobStatus> {
    const state = this.statusSequence.length > 1 ? this.statusSequence.shift()! : this.statusSequence[0];
    return state === "failed" ? { state, errorCode: "fake_failed", errorMessage: "boom" } : { state };
  }

  async getResult(): Promise<ProviderResult> {
    this.getResultCalls++;
    const bytes = this.resultBytes();
    return {
      url: "https://cdn.example.com/out.mp4",
      contentType: "video/mp4",
      durationMs: 3000,
      width: 960,
      height: 540,
      actualCostMinor: this.resultCost,
      currency: "USD",
      loadBytes: async () => bytes,
    };
  }
}

export class RecordingDispatcher implements Dispatcher {
  readonly kind = "in-process" as const;
  dispatched: string[] = [];
  fail = false;
  async dispatch(id: string) {
    if (this.fail) throw new Error("dispatch_down");
    this.dispatched.push(id);
  }
}

export function makeServices(overrides: Record<string, string> = {}) {
  const config = parseConfig({ APP_MODE: "demo", CREDIT_VALUE_MINOR: "5", CREDIT_MARKUP_BPS: "15000", ...overrides });
  const store = new DemoStore(null);
  const storage = new MemoryStorage();
  const video = new FakeProvider();
  const dispatcher = new RecordingDispatcher();
  const services: Services = { config, store, storage, video, speech: null, dispatcher };
  return { services, store, storage, video, dispatcher };
}

export async function seedUser(services: Services, credits = 100) {
  const userId = crypto.randomUUID();
  await services.store.ensureProfile({ id: userId, email: `${userId}@example.test` }, 0);
  if (credits > 0) {
    const admin = crypto.randomUUID();
    await services.store.ensureProfile({ id: admin, email: "admin@example.test" }, 0);
    await (services.store as DemoStore).grantAdminRole(admin);
    await services.store.adminAdjustCredits({ actorId: admin, userId, delta: credits, reason: "seed", idempotencyKey: `seed:${userId}` });
  }
  const project = await services.store.createProject(userId, "Projet test");
  const image = await services.store.createAsset({ ownerId: userId, projectId: project.id, kind: "image", bucket: "test", storagePath: `${userId}/image/${crypto.randomUUID()}` });
  await services.store.updateAsset(image.id, { status: "ready", mimeType: "image/png", width: 640, height: 640 });
  const audio = await services.store.createAsset({ ownerId: userId, projectId: project.id, kind: "audio", bucket: "test", storagePath: `${userId}/audio/${crypto.randomUUID()}` });
  await services.store.updateAsset(audio.id, { status: "ready", mimeType: "audio/wav", durationMs: 3000 });
  const storage = services.storage as MemoryStorage;
  storage.objects.set(image.storagePath, new Uint8Array([1, 2, 3]));
  storage.objects.set(audio.storagePath, new Uint8Array([4, 5, 6]));
  return { userId, project, image, audio, user: { id: userId, email: `${userId}@example.test`, isAdmin: false, emailConfirmed: true } };
}
