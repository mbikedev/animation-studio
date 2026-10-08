import { Clapperboard, Coins, FolderOpen, LogOut, Shield, UserRound } from "lucide-react";
import Link from "next/link";
import { signOutAction } from "@/app/(auth)/actions";
import { Brand, DemoBanner } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import type { UserIdentity } from "@/lib/domain";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { NavLink } from "./nav-link";

export function AppShell({
  user,
  dict,
  theme,
  isDemo,
  credits,
  children,
}: {
  user: UserIdentity;
  dict: Dictionary;
  theme: "dark" | "light";
  isDemo: boolean;
  credits: number;
  children: React.ReactNode;
}) {
  const items = [
    { href: "/studio", label: dict.nav.studio, icon: <Clapperboard /> },
    { href: "/projects", label: dict.nav.projects, icon: <FolderOpen /> },
    { href: "/credits", label: dict.nav.credits, icon: <Coins /> },
    { href: "/account", label: dict.nav.account, icon: <UserRound /> },
    ...(user.isAdmin ? [{ href: "/admin", label: dict.nav.admin, icon: <Shield /> }] : []),
  ];
  return (
    <div className="flex min-h-screen flex-col">
      {isDemo && <DemoBanner text={dict.demoBanner} />}
      <div className="flex flex-1 flex-col md:flex-row">
        <aside className="border-b border-border bg-surface md:sticky md:top-0 md:h-screen md:w-60 md:border-b-0 md:border-r">
          <div className="flex items-center justify-between px-4 py-4">
            <Brand href="/studio" />
            <div className="md:hidden">
              <ThemeToggle initial={theme} />
            </div>
          </div>
          <nav aria-label="Navigation principale" className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:pb-0">
            {items.map((i) => (
              <NavLink key={i.href} href={i.href} icon={i.icon}>
                {i.label}
              </NavLink>
            ))}
          </nav>
          <div className="hidden px-4 pt-6 md:block">
            <Link href="/credits" className="block rounded-lg bg-surface-2 px-3 py-2 text-sm">
              <span className="text-muted">Solde</span>
              <span className="mt-0.5 block text-lg font-semibold">{credits} crédits</span>
            </Link>
          </div>
          <div className="hidden px-4 pt-4 md:absolute md:bottom-4 md:block md:w-60">
            <p className="truncate text-xs text-muted" title={user.email}>
              {user.email}
            </p>
            <div className="mt-2 flex items-center justify-between">
              <form action={signOutAction}>
                <button type="submit" className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-foreground">
                  <LogOut className="size-4" /> {dict.nav.signOut}
                </button>
              </form>
              <ThemeToggle initial={theme} />
            </div>
          </div>
        </aside>
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
