"use client";

import { Dialog as D } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({ className, children, title, description, ...props }: ComponentProps<typeof D.Content> & { title: string; description?: ReactNode }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-40 bg-black/60" />
      <D.Content
        className={cn("fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-surface p-6 shadow-xl", className)}
        {...props}
      >
        <D.Title className="text-lg font-semibold">{title}</D.Title>
        {description ? <D.Description className="mt-1 text-sm text-muted">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
        <div className="mt-4">{children}</div>
      </D.Content>
    </D.Portal>
  );
}
