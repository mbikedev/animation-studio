/** Deletes all demo data (accounts, media, generations). Demo mode only. */
import { rm } from "node:fs/promises";
import path from "node:path";
import { parseConfig } from "../src/lib/config/env.ts";

try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local is optional (demo defaults).
}
const config = parseConfig(process.env);
if (config.mode !== "demo") {
  console.error("Refusé : APP_MODE n'est pas demo.");
  process.exit(1);
}
const dir = path.resolve(config.demo.dataDir);
await rm(dir, { recursive: true, force: true });
console.log(`Données de démonstration supprimées (${dir}).`);
