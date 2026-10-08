import Link from "next/link";

export function Brand({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 font-semibold tracking-tight">
      <span aria-hidden className="grid size-7 place-items-center rounded-lg bg-accent text-accent-foreground">
        <svg viewBox="0 0 24 24" className="size-4" fill="currentColor">
          <path d="M8 5.5v13l10.5-6.5L8 5.5Z" />
        </svg>
      </span>
      Animation Studio
    </Link>
  );
}

export function DemoBanner({ text }: { text: string }) {
  return (
    <div role="note" className="bg-warning/15 px-4 py-2 text-center text-xs font-medium text-warning">
      {text}
    </div>
  );
}
