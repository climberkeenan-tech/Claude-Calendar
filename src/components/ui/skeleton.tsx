import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "animate-pulse rounded-(--radius-sm) bg-border/60",
        className,
      )}
    />
  );
}
