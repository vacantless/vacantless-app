/**
 * Brand-color contrast guardrail.
 *
 * The dashboard header, the public renter pages, and every primary button put
 * WHITE text (or the brand color itself) on a tenant-chosen brand color. A pale
 * brand color (light yellow, pastel, near-white) makes that text unreadable —
 * a latent, demo-breaking accessibility bug.
 *
 * `accessibleBrand()` returns the chosen color unchanged when white text already
 * meets WCAG AA contrast (4.5:1), and otherwise darkens it toward black — keeping
 * the hue, only as dark as needed — until white text is readable. The same
 * darkened value is also readable as brand-colored text on a white background, so
 * one derived value fixes both white-on-brand surfaces and brand-on-white accents.
 *
 * All functions here are pure (no DOM, no env, no I/O) so they unit-test cleanly
 * and run identically on the server and the client.
 */

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export const DEFAULT_BRAND = "#4f46e5";

/** WCAG AA contrast ratio for normal-size text. */
export const MIN_CONTRAST_WHITE_TEXT = 4.5;

const WHITE: RGB = { r: 255, g: 255, b: 255 };
/** Near-black ink used elsewhere in the app (#111827 / gray-900). */
const DARK_INK: RGB = { r: 17, g: 24, b: 39 };

/** Parse "#rgb", "#rrggbb", or the same without the leading "#". */
export function parseHexColor(hex: string | null | undefined): RGB | null {
  if (typeof hex !== "string") return null;
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** RGB -> lowercase "#rrggbb", clamping each channel to 0..255. */
export function toHex({ r, g, b }: RGB): string {
  const c = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function channelLuminance(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance (0 = black, 1 = white). */
export function relativeLuminance(rgb: RGB): number {
  return (
    0.2126 * channelLuminance(rgb.r) +
    0.7152 * channelLuminance(rgb.g) +
    0.0722 * channelLuminance(rgb.b)
  );
}

/** WCAG contrast ratio between two colors (1..21). Order-independent. */
export function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** Contrast of white text against this background color. */
export function contrastWithWhite(hex: string): number {
  const rgb = parseHexColor(hex) ?? parseHexColor(DEFAULT_BRAND)!;
  return contrastRatio(rgb, WHITE);
}

/**
 * Returns the chosen color if white text already meets `minContrast`, otherwise
 * the LIGHTEST darkening of it (toward black, hue preserved) that does. Falls
 * back to the default brand for an unparseable input. Output is "#rrggbb".
 */
export function accessibleBrand(
  hex: string | null | undefined,
  minContrast: number = MIN_CONTRAST_WHITE_TEXT,
): string {
  const rgb = parseHexColor(hex) ?? parseHexColor(DEFAULT_BRAND)!;
  if (contrastRatio(rgb, WHITE) >= minContrast) return toHex(rgb);

  // Contrast(white, color) increases monotonically as the color darkens, so
  // binary-search the largest scale factor in [0,1] (closest to the original,
  // i.e. lightest) for which white text still clears the threshold.
  let lo = 0;
  let hi = 1;
  let best: RGB = { r: 0, g: 0, b: 0 }; // black always clears
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const cand: RGB = { r: rgb.r * mid, g: rgb.g * mid, b: rgb.b * mid };
    if (contrastRatio(cand, WHITE) >= minContrast) {
      best = cand;
      lo = mid; // try lighter (closer to the chosen color)
    } else {
      hi = mid; // need darker
    }
  }

  // Snap to integer channels and, since rounding can nudge contrast just under
  // the target, step a touch darker until the *rendered* color clears it. This
  // guarantees the returned hex always meets `minContrast` (or reaches black).
  let out: RGB = {
    r: Math.round(best.r),
    g: Math.round(best.g),
    b: Math.round(best.b),
  };
  let guard = 0;
  while (contrastRatio(out, WHITE) < minContrast && guard < 256) {
    out = {
      r: Math.max(0, out.r - 1),
      g: Math.max(0, out.g - 1),
      b: Math.max(0, out.b - 1),
    };
    guard++;
  }
  return toHex(out);
}

/** True when `accessibleBrand` would change the color (i.e. it's too light). */
export function isBrandColorTooLight(
  hex: string | null | undefined,
  minContrast: number = MIN_CONTRAST_WHITE_TEXT,
): boolean {
  return contrastWithWhite(hex ?? "") < minContrast;
}

/**
 * Best readable text color to place directly ON the given background:
 * white or the app's near-black ink, whichever has higher contrast.
 */
export function readableTextColor(hex: string | null | undefined): string {
  const rgb = parseHexColor(hex) ?? parseHexColor(DEFAULT_BRAND)!;
  return contrastRatio(rgb, WHITE) >= contrastRatio(rgb, DARK_INK)
    ? "#ffffff"
    : toHex(DARK_INK);
}
