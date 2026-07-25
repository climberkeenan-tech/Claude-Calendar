import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg" | "icon";

const variants: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-text hover:bg-accent-hover shadow-soft border border-transparent",
  secondary:
    "bg-surface text-ink border border-border hover:border-border-strong hover:bg-surface-raised shadow-soft",
  ghost: "bg-transparent text-ink-muted hover:text-ink hover:bg-accent-soft/60",
  // The fill keeps the light-mode red in BOTH themes so white text clears AA
  // on it; in dark that fill is too close to the surface, so the --danger
  // border carries the control's boundary (1.4.11) instead.
  danger:
    "bg-danger-solid text-white hover:brightness-110 shadow-soft border border-danger",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-11 px-5 text-base gap-2",
  icon: "h-9 w-9",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button({ className, variant = "primary", size = "md", ...props }, ref) {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center rounded-(--radius-sm) font-medium",
          "transition-colors duration-150 select-none",
          "disabled:opacity-50 disabled:pointer-events-none",
          variants[variant],
          sizes[size],
          className,
        )}
        {...props}
      />
    );
  },
);
