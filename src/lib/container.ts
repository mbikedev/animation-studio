import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { getConfig, type AppConfig } from "@/lib/config/env";
import { DemoSpeechProvider, DemoVideoProvider } from "@/lib/providers/demo";
import { ElevenLabsSpeechProvider } from "@/lib/providers/elevenlabs";
import { HedraVideoProvider } from "@/lib/providers/hedra";
import type { SpeechProvider, VideoProvider } from "@/lib/providers/types";
import { DemoStore } from "@/lib/repositories/demo-store";
import { SupabaseStore } from "@/lib/repositories/supabase-store";
import type { Store } from "@/lib/repositories/types";
import { DemoMediaStorage } from "@/lib/storage/demo-storage";
import { SupabaseMediaStorage } from "@/lib/storage/supabase-storage";
import type { MediaStorage } from "@/lib/storage/types";
import { createDispatcher, type Dispatcher } from "@/lib/generation/dispatcher";

/**
 * Composition root. Demo and live share every service; only the adapters
 * differ. Live mode never falls back to demo adapters.
 */
export interface Services {
  config: AppConfig;
  store: Store;
  storage: MediaStorage;
  /** null when real generation is not enabled (live without flags). */
  video: VideoProvider | null;
  speech: SpeechProvider | null;
  dispatcher: Dispatcher;
}

const GLOBAL_KEY = Symbol.for("animation-studio.services");
type GlobalWithServices = typeof globalThis & { [GLOBAL_KEY]?: Services };

export function buildServices(config: AppConfig, dispatcherFactory: (s: Omit<Services, "dispatcher">) => Dispatcher): Services {
  let base: Omit<Services, "dispatcher">;
  if (config.mode === "demo") {
    const dataDir = path.resolve(config.demo.dataDir);
    base = {
      config,
      store: new DemoStore(dataDir),
      storage: new DemoMediaStorage(dataDir, config.demo.secret),
      video: new DemoVideoProvider({ dataDir, ffmpeg: config.tools.ffmpeg }),
      speech: config.flags.voice ? new DemoSpeechProvider(config.tools.ffmpeg) : null,
    };
  } else {
    const supabase = config.supabase!;
    const db = createClient(supabase.url, supabase.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    base = {
      config,
      store: new SupabaseStore(db),
      storage: new SupabaseMediaStorage(db, supabase.bucket),
      video:
        config.flags.realGeneration && config.hedra
          ? new HedraVideoProvider({ ...config.hedra, maxOutputDurationMs: config.limits.maxVideoDurationSeconds * 1000 })
          : null,
      speech: config.flags.voice && config.elevenlabs ? new ElevenLabsSpeechProvider(config.elevenlabs) : null,
    };
  }
  return { ...base, dispatcher: dispatcherFactory(base) };
}

export function getServices(): Services {
  const g = globalThis as GlobalWithServices;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = buildServices(getConfig(), createDispatcher);
  }
  return g[GLOBAL_KEY]!;
}
