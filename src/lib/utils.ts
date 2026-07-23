export function cn(
  ...parts: (string | false | null | undefined)[]
): string {
  return parts.filter(Boolean).join(" ");
}

export type CategoryTone = {
  name: string;
  color: string;
};

/** Readable text color (black/white) for a chip over a category color. */
export function contrastText(hex: string): "#1f1e1d" | "#ffffff" {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#1f1e1d";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  // WCAG relative luminance; 0.179 is the point where black and white text
  // have equal contrast ratios — above it, dark text always wins.
  const lum = [r, g, b]
    .map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    })
    .reduce((acc, v, i) => acc + v * [0.2126, 0.7152, 0.0722][i], 0);
  return lum > 0.179 ? "#1f1e1d" : "#ffffff";
}
