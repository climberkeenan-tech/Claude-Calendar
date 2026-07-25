"use client";

/**
 * A chip-styled radio group that behaves the way a radio group is supposed to:
 * ONE tab stop for the whole set, arrow keys move between options (and select
 * as they go), Home/End jump to the ends. Rendering three plain buttons under
 * `role="radiogroup"` announces correctly but strands keyboard users — Tab
 * lands on every chip and the arrow keys do nothing, which is exactly the
 * behaviour a screen-reader user is told NOT to expect.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export type RadioChipOption<T extends string> = {
  value: T;
  label: string;
  /** Optional per-option hint, announced with the label. */
  description?: string;
};

export function RadioChips<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  className,
  chipClassName,
}: {
  /** Group label — required, this is the only thing announced on entry. */
  label: string;
  value: T;
  options: readonly RadioChipOption<T>[];
  onChange: (next: T) => void;
  disabled?: boolean;
  className?: string;
  chipClassName?: string;
}) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  function move(to: number) {
    const next = (to + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        move(index + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        move(index - 1);
        break;
      case "Home":
        e.preventDefault();
        move(0);
        break;
      case "End":
        e.preventDefault();
        move(options.length - 1);
        break;
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("flex flex-wrap gap-1.5", className)}
      onKeyDown={onKeyDown}
    >
      {options.map((o, i) => {
        const checked = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            // Roving tab stop: only the selected chip is in the tab order.
            tabIndex={checked ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            title={o.description}
            className={cn(
              "rounded-(--radius-sm) border px-3 py-1.5 text-xs font-medium transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-ink)",
              "disabled:cursor-not-allowed disabled:opacity-50",
              checked
                ? "border-accent bg-accent-soft text-ink"
                : "border-border text-ink-muted hover:border-border-strong hover:text-ink",
              chipClassName,
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
