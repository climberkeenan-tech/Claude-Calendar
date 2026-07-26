"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";

function applyTheme(next: "light" | "dark") {
  document.documentElement.classList.toggle("dark", next === "dark");
  document.cookie = `theme=${next}; path=/; max-age=31536000; samesite=lax`;
  // One source of truth for every mounted toggle. /settings renders a second
  // one in the Appearance card while the header keeps its own, and with
  // per-instance state the two drifted apart: after using the header toggle,
  // the settings one showed the wrong icon and its first click was a no-op
  // that set the theme it was already on.
  window.dispatchEvent(new CustomEvent("hpos:theme", { detail: next }));
}

export function ThemeToggle({ initialDark }: { initialDark: boolean }) {
  const [dark, setDark] = React.useState(initialDark);

  React.useEffect(() => {
    const onTheme = (e: Event) => {
      setDark((e as CustomEvent<"light" | "dark">).detail === "dark");
    };
    window.addEventListener("hpos:theme", onTheme);
    return () => window.removeEventListener("hpos:theme", onTheme);
  }, []);

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => {
        // Read the DOM, not local state: it is the only thing that is right
        // even if this instance mounted after someone else flipped it.
        const next = !document.documentElement.classList.contains("dark");
        applyTheme(next ? "dark" : "light");
      }}
    >
      {dark ? (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
          <circle cx="8" cy="8" r="3.25" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M8 1.5v1.75M8 12.75v1.75M1.5 8h1.75M12.75 8h1.75M3.4 3.4l1.24 1.24M11.36 11.36l1.24 1.24M12.6 3.4l-1.24 1.24M4.64 11.36 3.4 12.6"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M13.5 9.5A5.75 5.75 0 0 1 6.5 2.5a5.75 5.75 0 1 0 7 7Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </Button>
  );
}
