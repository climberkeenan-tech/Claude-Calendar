"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent } from "@/components/ui/dialog";

const SHORTCUTS: { keys: string; does: string; phase?: string }[] = [
  { keys: "Q", does: "Quick add" },
  { keys: "T", does: "Go to today (Dashboard)" },
  { keys: "1 / 2 / 3 / 4", does: "Day · Week · Month · Agenda", phase: "Phase 3" },
  { keys: "← / →", does: "Previous / next period", phase: "Phase 3" },
  { keys: "Space", does: "Complete focused item", phase: "Phase 3" },
  { keys: "?", does: "This overlay" },
];

/** True when the event target is a place where typing is expected. */
export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return (
    el.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)
  );
}

export function ShortcutsOverlay() {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (e.key === "?") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key.toLowerCase() === "t") {
        e.preventDefault();
        router.push("/");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent title="Keyboard shortcuts">
        <ul className="flex flex-col divide-y divide-border">
          {SHORTCUTS.map((s) => (
            <li key={s.keys} className="flex items-center justify-between py-2.5">
              <span className="text-sm text-ink">{s.does}</span>
              <span className="flex items-center gap-2">
                {s.phase ? (
                  <span className="text-[10px] uppercase tracking-wide text-ink-faint">
                    {s.phase}
                  </span>
                ) : null}
                <kbd className="rounded-md border border-border bg-surface-raised px-2 py-0.5 font-mono text-xs text-ink-muted">
                  {s.keys}
                </kbd>
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
