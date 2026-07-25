import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-10 w-full rounded-(--radius-sm) border border-border-input bg-surface px-3 text-sm text-ink",
        "placeholder:text-ink-faint",
        "focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25",
        "transition-colors duration-150",
        className,
      )}
      {...props}
    />
  );
});

export function Field({
  label,
  htmlFor,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label
        htmlFor={htmlFor}
        className="text-xs font-medium text-ink-muted"
      >
        {label}
      </label>
      {children}
    </div>
  );
}
