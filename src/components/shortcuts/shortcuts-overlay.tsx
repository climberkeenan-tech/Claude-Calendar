"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent } from "@/components/ui/dialog";

const SHORTCUTS: { keys: string; does: string; phase?: string }[] = [
  { keys: "Q", does: "Quick add — natural language" },
  { keys: "T", does: "Go to today (Dashboard)" },
  { keys: "1 / 2 / 3 / 4", does: "Day · Week · Month · Agenda (on Calendar)" },
  {
    keys: "← / →",
    does: "Previous / next period — or move between chips in a choice group",
  },
  { keys: "Enter", does: "Open focused event" },
  { keys: "Tab", does: "Skip to content — the first stop on every page" },
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

/** Global single-key shortcuts must stay quiet while ANY dialog is open —
 * otherwise "t" navigates away mid-edit and "1" flips the calendar view
 * under the sheet. Radix portals dialogs to the body, so a DOM check is the
 * reliable signal across every component. */
export function shortcutsSuspended(e: KeyboardEvent): boolean {
  if (isTypingTarget(e.target)) return true;
  return document.querySelector('[role="dialog"][data-state="open"]') !== null;
}

export function ShortcutsOverlay() {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (shortcutsSuspended(e)) return;
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
