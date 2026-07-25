import * as React from "react";
import { cn, contrastText } from "@/lib/utils";

export function Badge({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border bg-surface-raised px-2.5 py-0.5 text-xs font-medium text-ink-muted",
        className,
      )}
      {...props}
    />
  );
}

export function CategoryBadge({
  name,
  color,
  className,
}: {
  name: string;
  color: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        className,
      )}
      style={{ backgroundColor: color, color: contrastText(color) }}
    >
      {name}
    </span>
  );
}

/** `dim` recedes a dot for done/past rows. Safe to fade because it's purely
 * decorative (aria-hidden) — the same fade on text would break contrast. */
export function CategoryDot({ color, dim }: { color: string; dim?: boolean }) {
  return (
    <span
      aria-hidden
      className="inline-block size-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: color, opacity: dim ? 0.5 : 1 }}
    />
  );
}
