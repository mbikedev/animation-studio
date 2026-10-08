import { ffmpeg } from "@trigger.dev/build/extensions/core";
import { defineConfig } from "@trigger.dev/sdk";

// Background worker (APP_MODE=live). FFmpeg/ffprobe are installed in the
// image and exposed through FFMPEG_PATH / FFPROBE_PATH.
export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_replace_me",
  dirs: ["./src/trigger"],
  maxDuration: 3600,
  retries: {
    // Task-level retries are disabled: the state machine decides what is
    // safe to retry (never a billable provider call without idempotency).
    enabledInDev: false,
    default: { maxAttempts: 1 },
  },
  build: {
    extensions: [ffmpeg()],
  },
});
