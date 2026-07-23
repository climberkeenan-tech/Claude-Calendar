import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-(--radius) border border-border bg-surface shadow-soft",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  className,
  title,
  action,
}: {
  className?: string;
  title: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 px-5 pt-4 pb-2",
        className,
      )}
    >
      <h2 className="text-sm font-semibold tracking-wide text-ink-muted uppercase">
        {title}
      </h2>
      {action}
    </div>
  );
}

export function CardBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 pb-5", className)} {...props} />;
}

export function EmptyState({
  icon,
  headline,
  hint,
  action,
}: {
  icon?: React.ReactNode;
  headline: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 py-8 text-center">
      {icon ? <div className="text-2xl mb-1">{icon}</div> : null}
      <p className="text-sm font-medium text-ink-muted">{headline}</p>
      {hint ? <p className="text-xs text-ink-faint max-w-60">{hint}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
