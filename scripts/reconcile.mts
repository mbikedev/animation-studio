/** One reconciliation pass from the command line (outbox, stale jobs, lookups). */
import { getConfig } from "../src/lib/config/env.ts";
import { buildServices } from "../src/lib/container.ts";
import { createDispatcher, reconcile } from "../src/lib/generation/dispatcher.ts";

try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local is optional (demo defaults).
}
const services = buildServices(getConfig(), createDispatcher);
console.log(JSON.stringify(await reconcile(services), null, 2));
