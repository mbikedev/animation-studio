import { z } from "zod";

/**
 * Server configuration, validated once per process.
 *
 * Rules (see docs/architecture.md):
 * - APP_MODE=demo works without any cloud secret.
 * - APP_MODE=live requires the core infrastructure and fails loudly when
 *   anything is missing. It never falls back to demo.
 * - Paid features (real generation, voice, Stripe live) stay disabled unless
 *   their dedicated flag is explicitly "true", and then their own secrets and
 *   spending caps become mandatory (fail closed).
 */

const boolFlag = z
  .enum(["true", "false", ""])
  .optional()
  .transform((v) => v === "true");

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const optionalInt = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (v === undefined || v.trim() === "") return undefined;
    const n = Number(v);
    if (!Number.isSafeInteger(n) || n < 0) {
      ctx.addIssue({ code: "custom", message: "must be a non-negative integer" });
      return z.NEVER;
    }
    return n;
  });

const rawSchema = z.object({
  APP_MODE: z.enum(["demo", "live"]).default("demo"),
  APP_BASE_URL: z.url().default("http://localhost:3000"),
  REAL_GENERATION_ENABLED: boolFlag,
  VOICE_GENERATION_ENABLED: boolFlag,
  STRIPE_LIVE_ENABLED: boolFlag,

  NEXT_PUBLIC_SUPABASE_URL: optionalString,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: optionalString,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
  SUPABASE_STORAGE_BUCKET: z.string().default("media"),

  HEDRA_API_KEY: optionalString,
  HEDRA_MODEL_ID: z.string().default("hedra-character-3"),
  HEDRA_API_BASE_URL: z.url().default("https://api.hedra.com/v3"),
  /** Manually verified price table. Live generation stays off without it. */
  HEDRA_PRICE_VERSION: optionalString,
  HEDRA_RATE_MICROS_540P: optionalInt,
  HEDRA_RATE_MICROS_720P: optionalInt,
  HEDRA_RATE_MICROS_1080P: optionalInt,

  ELEVENLABS_API_KEY: optionalString,
  ELEVENLABS_VOICE_ID: optionalString,
  ELEVENLABS_MODEL_ID: z.string().default("eleven_multilingual_v2"),
  /** Estimated voice cost in minor units per 1000 characters (owner-verified). */
  ELEVENLABS_COST_MINOR_PER_1K_CHARS: optionalInt,

  TRIGGER_SECRET_KEY: optionalString,
  TRIGGER_PROJECT_REF: optionalString,

  STRIPE_SECRET_KEY: optionalString,
  STRIPE_WEBHOOK_SECRET: optionalString,

  SENTRY_DSN: optionalString,

  MAX_VIDEO_DURATION_SECONDS: z.coerce.number().int().positive().max(30).default(30),
  MAX_GENERATION_COST_MINOR: optionalInt,
  COST_CURRENCY: z.string().regex(/^[A-Z]{3}$/).default("USD"),
  MAX_CONCURRENT_JOBS_PER_USER: z.coerce.number().int().positive().default(1),
  DAILY_PROVIDER_BUDGET_MINOR: optionalInt,

  /** Internal credit economics (versioned with the price table). */
  CREDIT_VALUE_MINOR: z.coerce.number().int().positive().default(5),
  CREDIT_MARKUP_BPS: z.coerce.number().int().min(10000).default(15000),
  SIGNUP_BONUS_CREDITS: z.coerce.number().int().min(0).default(0),

  /** Secret used to sign demo sessions and demo media links. */
  DEMO_SECRET: optionalString,
  DEMO_DATA_DIR: z.string().default(".demo-data"),
  FFPROBE_PATH: z.string().default("ffprobe"),
  FFMPEG_PATH: z.string().default("ffmpeg"),
});

export type RawEnv = z.infer<typeof rawSchema>;

export type Resolution = "540p" | "720p" | "1080p";

export interface AppConfig {
  mode: "demo" | "live";
  baseUrl: string;
  flags: {
    realGeneration: boolean;
    voice: boolean;
    stripeLive: boolean;
  };
  supabase?: {
    url: string;
    publishableKey: string;
    serviceRoleKey: string;
    bucket: string;
  };
  hedra?: {
    apiKey: string;
    modelId: string;
    baseUrl: string;
  };
  /** Present only when a price table is configured (always in demo). */
  videoPrice?: {
    version: string;
    currency: string;
    ratePerSecondMicros: Record<Resolution, number>;
  };
  elevenlabs?: {
    apiKey: string;
    voiceId: string;
    modelId: string;
    costMinorPer1kChars: number;
  };
  trigger?: { secretKey: string; projectRef: string };
  stripe?: { secretKey: string; webhookSecret: string };
  limits: {
    maxVideoDurationSeconds: number;
    maxGenerationCostMinor?: number;
    currency: string;
    maxConcurrentJobsPerUser: number;
    dailyProviderBudgetMinor?: number;
  };
  credits: {
    creditValueMinor: number;
    markupBps: number;
    signupBonus: number;
  };
  demo: { secret: string; dataDir: string };
  tools: { ffprobe: string; ffmpeg: string };
  sentryDsn?: string;
  /** Human readable reasons why real generation cannot run right now. */
  realGenerationBlockers: string[];
  voiceBlockers: string[];
}

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid configuration:\n- ${problems.join("\n- ")}`);
    this.name = "ConfigError";
  }
}

/**
 * Indicative Hedra Character 3 rates read on the official page on
 * 2026-10-08 (2.5 / 5 / 6.25 US cents per second). Used ONLY in demo mode.
 * Live mode requires the owner to re-verify and set HEDRA_RATE_MICROS_*.
 */
export const DEMO_PRICE_TABLE = {
  version: "demo-hedra-character-3-2026-10-08",
  currency: "USD",
  ratePerSecondMicros: { "540p": 25_000, "720p": 50_000, "1080p": 62_500 },
} as const;

const DEV_DEMO_SECRET = "demo-only-insecure-secret-change-me-0123456789";

export function parseConfig(source: Record<string, string | undefined>): AppConfig {
  const parsed = rawSchema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((i) => `${i.path.join(".") || "env"}: ${i.message}`),
    );
  }
  const env = parsed.data;
  const problems: string[] = [];
  const isLive = env.APP_MODE === "live";

  const supabase =
    env.NEXT_PUBLIC_SUPABASE_URL &&
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
    env.SUPABASE_SERVICE_ROLE_KEY
      ? {
          url: env.NEXT_PUBLIC_SUPABASE_URL,
          publishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
          serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
          bucket: env.SUPABASE_STORAGE_BUCKET,
        }
      : undefined;

  if (isLive) {
    if (!supabase) {
      problems.push(
        "APP_MODE=live requires NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SERVICE_ROLE_KEY",
      );
    }
    if (env.APP_BASE_URL.startsWith("http://") && !env.APP_BASE_URL.includes("localhost")) {
      problems.push("APP_BASE_URL must use https in live mode");
    }
    if (!env.TRIGGER_SECRET_KEY || !env.TRIGGER_PROJECT_REF) {
      problems.push("APP_MODE=live requires TRIGGER_SECRET_KEY and TRIGGER_PROJECT_REF (background jobs)");
    }
  }

  const hedra = env.HEDRA_API_KEY
    ? { apiKey: env.HEDRA_API_KEY, modelId: env.HEDRA_MODEL_ID, baseUrl: env.HEDRA_API_BASE_URL }
    : undefined;

  let videoPrice: AppConfig["videoPrice"];
  if (!isLive) {
    videoPrice = { ...DEMO_PRICE_TABLE, ratePerSecondMicros: { ...DEMO_PRICE_TABLE.ratePerSecondMicros } };
  } else if (
    env.HEDRA_PRICE_VERSION &&
    env.HEDRA_RATE_MICROS_540P !== undefined &&
    env.HEDRA_RATE_MICROS_720P !== undefined &&
    env.HEDRA_RATE_MICROS_1080P !== undefined
  ) {
    videoPrice = {
      version: env.HEDRA_PRICE_VERSION,
      currency: env.COST_CURRENCY,
      ratePerSecondMicros: {
        "540p": env.HEDRA_RATE_MICROS_540P,
        "720p": env.HEDRA_RATE_MICROS_720P,
        "1080p": env.HEDRA_RATE_MICROS_1080P,
      },
    };
  }

  const realGenerationBlockers: string[] = [];
  if (isLive) {
    if (!env.REAL_GENERATION_ENABLED) realGenerationBlockers.push("REAL_GENERATION_ENABLED n'est pas activé");
    if (!hedra) realGenerationBlockers.push("HEDRA_API_KEY manquant");
    if (!videoPrice) realGenerationBlockers.push("Tarif Hedra vérifié non configuré (HEDRA_PRICE_VERSION et HEDRA_RATE_MICROS_*)");
    if (env.MAX_GENERATION_COST_MINOR === undefined) realGenerationBlockers.push("MAX_GENERATION_COST_MINOR manquant");
    if (env.DAILY_PROVIDER_BUDGET_MINOR === undefined) realGenerationBlockers.push("DAILY_PROVIDER_BUDGET_MINOR manquant");
  }

  const elevenlabs =
    env.ELEVENLABS_API_KEY && env.ELEVENLABS_VOICE_ID
      ? {
          apiKey: env.ELEVENLABS_API_KEY,
          voiceId: env.ELEVENLABS_VOICE_ID,
          modelId: env.ELEVENLABS_MODEL_ID,
          costMinorPer1kChars: env.ELEVENLABS_COST_MINOR_PER_1K_CHARS ?? 0,
        }
      : undefined;

  const voiceBlockers: string[] = [];
  if (!env.VOICE_GENERATION_ENABLED) voiceBlockers.push("VOICE_GENERATION_ENABLED n'est pas activé");
  if (isLive) {
    if (!elevenlabs) voiceBlockers.push("ELEVENLABS_API_KEY ou ELEVENLABS_VOICE_ID manquant");
    if (env.ELEVENLABS_COST_MINOR_PER_1K_CHARS === undefined)
      voiceBlockers.push("ELEVENLABS_COST_MINOR_PER_1K_CHARS manquant (coût voix à vérifier)");
  }

  const stripe =
    env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET
      ? { secretKey: env.STRIPE_SECRET_KEY, webhookSecret: env.STRIPE_WEBHOOK_SECRET }
      : undefined;
  if (stripe) {
    const isLiveKey = stripe.secretKey.startsWith("sk_live_") || stripe.secretKey.startsWith("rk_live_");
    if (isLiveKey && !env.STRIPE_LIVE_ENABLED) {
      problems.push("A live Stripe key is configured but STRIPE_LIVE_ENABLED is not true");
    }
  }

  let demoSecret = env.DEMO_SECRET;
  if (isLive) {
    demoSecret = undefined;
  } else if (!demoSecret) {
    demoSecret = DEV_DEMO_SECRET;
  }

  if (problems.length > 0) throw new ConfigError(problems);

  return {
    mode: env.APP_MODE,
    baseUrl: env.APP_BASE_URL.replace(/\/$/, ""),
    flags: {
      realGeneration: isLive ? realGenerationBlockers.length === 0 : false,
      voice: voiceBlockers.length === 0,
      stripeLive: env.STRIPE_LIVE_ENABLED,
    },
    supabase,
    hedra,
    videoPrice,
    elevenlabs,
    trigger:
      env.TRIGGER_SECRET_KEY && env.TRIGGER_PROJECT_REF
        ? { secretKey: env.TRIGGER_SECRET_KEY, projectRef: env.TRIGGER_PROJECT_REF }
        : undefined,
    stripe,
    limits: {
      maxVideoDurationSeconds: env.MAX_VIDEO_DURATION_SECONDS,
      maxGenerationCostMinor: env.MAX_GENERATION_COST_MINOR,
      currency: env.COST_CURRENCY,
      maxConcurrentJobsPerUser: env.MAX_CONCURRENT_JOBS_PER_USER,
      dailyProviderBudgetMinor: env.DAILY_PROVIDER_BUDGET_MINOR,
    },
    credits: {
      creditValueMinor: env.CREDIT_VALUE_MINOR,
      markupBps: env.CREDIT_MARKUP_BPS,
      signupBonus: env.SIGNUP_BONUS_CREDITS,
    },
    // In live mode the demo secret is an unusable random value: demo sessions
    // and demo media links can never validate.
    demo: {
      secret: demoSecret ?? cryptoRandom(),
      dataDir: env.DEMO_DATA_DIR,
    },
    tools: { ffprobe: env.FFPROBE_PATH, ffmpeg: env.FFMPEG_PATH },
    sentryDsn: env.SENTRY_DSN,
    realGenerationBlockers,
    voiceBlockers,
  };
}

function cryptoRandom(): string {
  return globalThis.crypto.randomUUID() + globalThis.crypto.randomUUID();
}

let cached: AppConfig | undefined;

export function getConfig(): AppConfig {
  if (!cached) cached = parseConfig(process.env);
  return cached;
}

/** Test helper. */
export function resetConfigForTests(): void {
  cached = undefined;
}
