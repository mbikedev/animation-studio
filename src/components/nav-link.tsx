"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function NavLink({ href, icon, children }: { href: string; icon: React.ReactNode; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm [&_svg]:size-4",
        active ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-surface-2 hover:text-foreground",
      )}
    >
      {icon}
      {children}
    </Link>
  );
}
