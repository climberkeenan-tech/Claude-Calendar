"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const items = [
  { href: "/", label: "Dashboard", icon: "◈" },
  { href: "/calendar", label: "Calendar", icon: "▦" },
  { href: "/assignments", label: "Assignments", icon: "☰" },
  { href: "/plan", label: "Plan", icon: "◇" },
  { href: "/import", label: "Import", icon: "⇪" },
  { href: "/analytics", label: "Analytics", icon: "◔" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];

/** Four tabs plus More. Seven across a 390 px screen truncates every label. */
const TAB_COUNT = 4;

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function SidebarNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1" aria-label="Primary">
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-(--radius-sm) px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-accent-soft text-ink"
                : "text-ink-muted hover:bg-accent-soft/50 hover:text-ink",
            )}
          >
            <span aria-hidden className="w-4 text-center text-base leading-none">
              {item.icon}
            </span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * The phone's entire navigation. The sidebar carrying the other destinations
 * and Sign out is `hidden md:flex`, so anything this bar drops is unreachable
 * on a phone: Analytics and Settings simply did not exist there, and there was
 * no way to sign out at all. Everything past the fourth tab now lives behind
 * More, which keeps every destination two taps away — and keeps the published
 * click-count audit true on a phone, not just a laptop.
 */
export function MobileTabs({ signOut }: { signOut: () => Promise<void> }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = React.useState(false);
  const tabs = items.slice(0, TAB_COUNT);
  const rest = items.slice(TAB_COUNT);
  const restIsActive = rest.some((r) => isActive(pathname, r.href));

  return (
    <>
      <nav
        aria-label="Primary, compact"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-surface/95 backdrop-blur md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {tabs.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium",
                active ? "text-accent-ink" : "text-ink-faint",
              )}
            >
              <span aria-hidden className="text-lg leading-none">
                {item.icon}
              </span>
              {item.label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          className={cn(
            "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium",
            restIsActive ? "text-accent-ink" : "text-ink-faint",
          )}
        >
          <span aria-hidden className="text-lg leading-none">
            ⋯
          </span>
          More
        </button>
      </nav>

      <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
        <DialogContent title="More">
          <div className="flex flex-col gap-1">
            {rest.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(pathname, item.href) ? "page" : undefined}
                // Close on tap rather than reacting to the pathname, so it
                // also closes when you pick the page you're already on.
                onClick={() => setMoreOpen(false)}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-(--radius-sm) px-3 text-sm font-medium",
                  isActive(pathname, item.href)
                    ? "bg-accent-soft text-ink"
                    : "text-ink hover:bg-accent-soft/50",
                )}
              >
                <span aria-hidden className="w-4 text-center text-base leading-none">
                  {item.icon}
                </span>
                {item.label}
              </Link>
            ))}
            <form action={signOut} className="contents">
              <button
                type="submit"
                className="flex min-h-11 items-center gap-3 rounded-(--radius-sm) px-3 text-left text-sm font-medium text-ink-muted hover:bg-accent-soft/50 hover:text-ink"
              >
                <span aria-hidden className="w-4 text-center text-base leading-none">
                  ⏻
                </span>
                Sign out
              </button>
            </form>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
