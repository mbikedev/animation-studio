/**
 * Grants the admin role to ONE explicit user. No default admin exists.
 *   live: pnpm admin:grant <user-uuid>        (uses SUPABASE_SERVICE_ROLE_KEY)
 *   demo: pnpm admin:grant <email>            (demo accounts only)
 */
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { parseConfig } from "../src/lib/config/env.ts";
import { DemoStore } from "../src/lib/repositories/demo-store.ts";

const target = process.argv[2];
if (!target) {
  console.error("Usage: pnpm admin:grant <user-uuid | demo email>");
  process.exit(1);
}
try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local is optional (demo defaults).
}
const config = parseConfig(process.env);

if (config.mode === "demo") {
  const store = new DemoStore(path.resolve(config.demo.dataDir));
  try {
    const id = await store.demoGrantAdmin(target);
    console.log(`Démo : rôle admin accordé à ${target} (${id}).`);
  } catch (err) {
    console.error("Échec :", err instanceof Error ? err.message : err);
    process.exit(1);
  }
} else {
  if (!/^[0-9a-f-]{36}$/i.test(target)) {
    console.error("En mode live, passez l'identifiant UUID exact de l'utilisateur (auth.users.id).");
    process.exit(1);
  }
  const db = createClient(config.supabase!.url, config.supabase!.serviceRoleKey, { auth: { persistSession: false } });
  const { error } = await db.rpc("grant_admin", { p_user: target });
  if (error) {
    console.error("Échec :", error.message);
    process.exit(1);
  }
  console.log(`Live : rôle admin accordé à ${target} (audité).`);
}
