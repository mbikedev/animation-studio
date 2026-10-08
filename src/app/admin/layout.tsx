import { AppShell } from "@/components/app-shell";
import { requireAdmin } from "@/lib/auth/session";
import { getServices } from "@/lib/container";
import { getPreferences } from "@/lib/preferences";

export const metadata = { title: "Administration" };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  const services = getServices();
  const [{ dict, theme }, account] = await Promise.all([getPreferences(), services.store.getCreditAccount(user.id)]);
  return (
    <AppShell user={user} dict={dict} theme={theme} isDemo={services.config.mode === "demo"} credits={account.availableCredits}>
      {children}
    </AppShell>
  );
}
