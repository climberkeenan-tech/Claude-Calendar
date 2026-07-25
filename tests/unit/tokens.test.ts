import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Contrast is a property of the TOKENS, so it gets tested like any other
 * invariant. An axe run on a rendered page finds these too, but only for the
 * pairings that page happens to contain — this covers every ink against every
 * surface, including the tinted soft fills that are easy to forget.
 */

const CSS = fs.readFileSync(
  path.join(process.cwd(), "src/styles/tokens.css"),
  "utf8",
);

/** Pull one block's `--name: #hex;` declarations. */
function block(selector: string): Record<string, string> {
  const start = CSS.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`no ${selector} block in tokens.css`);
  const body = CSS.slice(start, CSS.indexOf("\n}", start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    out[m[1]] = m[2].toLowerCase();
  }
  return out;
}

const channel = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const AA_TEXT = 4.5;
const AA_UI = 3; // 1.4.11 — control boundaries and meaningful graphics

const SURFACES = [
  "--bg",
  "--surface",
  "--surface-raised",
  "--accent-soft",
  "--warn-soft",
  "--danger-soft",
  "--ok-soft",
] as const;

const INKS = [
  "--text",
  "--text-muted",
  "--text-faint",
  "--accent-ink",
  "--danger-ink",
  "--warn-ink",
  "--ok-ink",
] as const;

describe("design tokens meet WCAG AA", () => {
  it("sanity-checks the contrast maths against known pairs", () => {
    expect(contrast("#ffffff", "#000000")).toBeCloseTo(21, 1);
    expect(contrast("#767676", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#d97757", "#ffffff")).toBeLessThan(4.5); // why --accent-ink exists
  });

  for (const mode of ["light", "dark"] as const) {
    const t = block(mode === "light" ? ":root" : ".dark");

    it(`${mode}: every ink clears 4.5:1 on every surface`, () => {
      const failures: string[] = [];
      for (const ink of INKS) {
        for (const surface of SURFACES) {
          const r = contrast(t[ink], t[surface]);
          if (r < AA_TEXT) {
            failures.push(`${ink} (${t[ink]}) on ${surface} (${t[surface]}) = ${r.toFixed(2)}`);
          }
        }
      }
      expect(failures).toEqual([]);
    });

    it(`${mode}: text on the accent fill clears 4.5:1`, () => {
      // Terracotta is a mid tone — white on it is only ~3.1:1, which is why
      // accent fills carry ink, matching contrastText()'s rule for chips.
      expect(contrast(t["--accent-text"], t["--accent"])).toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrast(t["--accent-text"], t["--accent-hover"])).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it(`${mode}: the destructive button is readable and has a visible edge`, () => {
      expect(contrast("#ffffff", t["--danger-solid"])).toBeGreaterThanOrEqual(AA_TEXT);
      // The fill alone can't clear 3:1 against a dark surface, so the border does.
      expect(contrast(t["--danger"], t["--surface"])).toBeGreaterThanOrEqual(AA_UI);
    });

    it(`${mode}: control boundaries and the focus ring are perceivable`, () => {
      // Inputs/selects: --border is a DIVIDER hue (~1.2:1) and must never be
      // the only thing marking a control's edge.
      for (const surface of ["--surface", "--bg", "--surface-raised"] as const) {
        expect(contrast(t["--border-input"], t[surface])).toBeGreaterThanOrEqual(AA_UI);
      }
      // The focus ring is drawn in --accent-ink (globals.css :focus-visible)
      // precisely because --accent itself is only 2.96:1 on the light page.
      for (const surface of ["--surface", "--bg", "--surface-raised"] as const) {
        expect(contrast(t["--accent-ink"], t[surface])).toBeGreaterThanOrEqual(AA_UI);
      }
    });
  }
});
