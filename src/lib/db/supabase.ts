import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getConfig } from "@/lib/config/env";

/** Service-role client: server only, bypasses RLS. Never expose. */
let serviceClient: SupabaseClient | undefined;

export function getServiceClient(): SupabaseClient {
  const { supabase } = getConfig();
  if (!supabase) throw new Error("Supabase is not configured");
  serviceClient ??= createClient(supabase.url, supabase.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return serviceClient;
}

/** Per-request client bound to the user's auth cookies (publishable key + RLS). */
export async function getUserClient(): Promise<SupabaseClient> {
  const { supabase } = getConfig();
  if (!supabase) throw new Error("Supabase is not configured");
  const store = await cookies();
  return createServerClient(supabase.url, supabase.publishableKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) store.set(name, value, options);
        } catch {
          // Called from a Server Component: the proxy refreshes cookies instead.
        }
      },
    },
  });
}
