"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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

export function SidebarNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1" aria-label="Primary">
      {items.map((item) => {
        const active =
          item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
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

export function MobileTabs() {
  const pathname = usePathname();
  const tabs = items.slice(0, 5);
  return (
    <nav
      aria-label="Primary, compact"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-surface/95 backdrop-blur md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {tabs.map((item) => {
        const active =
          item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
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
    </nav>
  );
}
