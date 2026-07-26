"use client";

/**
 * The quick-add SHELL: the ＋ button, the global `Q` key, the confirmation
 * toast, and the dialog frame. Deliberately tiny — it's mounted in the app
 * layout, so anything it imports is downloaded on every page.
 *
 * The body (and with it `chrono-node`, ~330 KB of client JS) is a separate
 * chunk, fetched when the browser goes idle after first paint. By the time
 * anyone reaches for Q it's cached, so the "chips appear as you type"
 * guarantee holds without taxing the first load of every route.
 */
import * as React from "react";
import dynamic from "next/dynamic";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { shortcutsSuspended } from "@/components/shortcuts/shortcuts-overlay";

type Category = { id: string; name: string; color: string };

const QuickAddPanel = dynamic(() => import("./quick-add-panel"), {
  ssr: false,
  // `loading` is also what renders when the chunk FAILS to arrive — on a flaky
  // campus connection that is a real outcome, not a theoretical one. Ignoring
  // the `error` prop left the pulsing skeleton and "Waking up the parser…"
  // running forever, with no way to tell it had given up and no way to retry
  // short of reloading the page. Quick-add is the primary way into this app.
  loading: ({ error, retry }) =>
    error ? (
      <div className="flex flex-col gap-3" role="alert">
        <p className="text-sm text-ink">Quick add didn&rsquo;t finish loading.</p>
        <p className="text-xs text-ink-muted">
          Usually a dropped connection. Nothing was lost.
        </p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="self-start"
          onClick={() => retry?.()}
        >
          Try again
        </Button>
      </div>
    ) : (
      <div className="flex flex-col gap-3" aria-busy="true">
        <div className="h-12 animate-pulse rounded-(--radius-sm) bg-surface-raised" />
        <p className="text-xs text-ink-faint">Waking up the parser…</p>
      </div>
    ),
});

export function QuickAdd({ categories }: { categories: Category[] }) {
  const [open, setOpen] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);

  // Warm the panel chunk once the page is done with the important work, so
  // opening quick-add never waits on a download.
  React.useEffect(() => {
    const warm = () => {
      void import("./quick-add-panel");
    };
    const ric = (window as unknown as {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
    }).requestIdleCallback;
    if (ric) {
      const id = ric(warm, { timeout: 3000 });
      return () => {
        (window as unknown as { cancelIdleCallback?: (i: number) => void })
          .cancelIdleCallback?.(id);
      };
    }
    const t = setTimeout(warm, 1500); // Safari has no requestIdleCallback
    return () => clearTimeout(t);
  }, []);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (shortcutsSuspended(e)) return;
      if (e.key.toLowerCase() === "q") {
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <Button
        size="lg"
        className="fixed bottom-20 right-4 z-40 rounded-full shadow-raised md:bottom-8 md:right-8"
        onClick={() => setOpen(true)}
        // A pointer heading for the button is the last chance to warm the
        // chunk before it's needed.
        onPointerEnter={() => void import("./quick-add-panel")}
        title="Shortcut: Q"
      >
        {/* No aria-label: an override that didn't contain the visible text
            would break voice control ("click Quick add"), so the shortcut
            hint is appended to the name instead (WCAG 2.5.3 Label in Name). */}
        <span aria-hidden>＋</span> Quick add
        <span className="sr-only">(shortcut Q)</span>
      </Button>

      {toast ? (
        <div
          role="status"
          className="fixed bottom-36 right-4 z-50 rounded-(--radius-sm) border border-border bg-surface px-4 py-2 text-sm text-ink shadow-raised md:bottom-24 md:right-8"
        >
          {toast}
        </div>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title="Quick add"
          description="Type it like you'd say it — “Study Biology tomorrow at 7 PM”, “Gym every Monday at 5”, “Essay due Friday”."
        >
          {/* Remounted per open, so every session starts from a clean draft
              and no stale parse can survive a close. */}
          {open ? (
            <QuickAddPanel
              categories={categories}
              onCancel={() => setOpen(false)}
              onDone={(message) => {
                setOpen(false);
                setToast(message);
                setTimeout(() => setToast(null), 2500);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
