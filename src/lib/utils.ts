import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDuration(ms: number | null | undefined): string {
  if (!ms) return "—";
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1).replace(".", ",")} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

export function formatDate(iso: string, locale = "fr-BE"): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}
