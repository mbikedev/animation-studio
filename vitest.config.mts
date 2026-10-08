import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 60_000,
    server: { deps: { inline: [/server-only/] } },
    alias: { "server-only": path.resolve(import.meta.dirname, "tests/helpers/server-only-stub.ts") },
  },
});
