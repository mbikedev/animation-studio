import "server-only";
import { cookies } from "next/headers";
import { getDictionary } from "@/lib/i18n/dictionaries";

export async function getPreferences() {
  const store = await cookies();
  const theme = store.get("theme")?.value === "light" ? ("light" as const) : ("dark" as const);
  const locale = store.get("locale")?.value ?? "fr";
  return { theme, locale, dict: getDictionary(locale) };
}
