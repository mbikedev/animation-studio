import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${PORT}`;

/**
 * End-to-end tests run the production build in APP_MODE=demo with an
 * isolated data folder. No paid provider is ever called.
 * Run `pnpm build` first, then `pnpm test:e2e`.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : undefined,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /responsive/ },
  ],
  webServer: {
    command: `rm -rf .e2e-data && pnpm exec next start -p ${PORT}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      APP_MODE: "demo",
      APP_BASE_URL: baseURL,
      DEMO_DATA_DIR: ".e2e-data",
      DEMO_SECRET: "e2e-only-secret-0123456789abcdef0123456789",
    },
  },
});
