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

/**
 * The single source of truth for the default brand color (Tailwind indigo-600,
 * the left anchor of the marketing homepage's indigo->teal gradient). Every
 * other module imports this rather than re-typing the literal.
 */
export const DEFAULT_BRAND_COLOR = "#4f46e5";

/** @deprecated Back-compat alias of {@link DEFAULT_BRAND_COLOR}. */
export const DEFAULT_BRAND = DEFAULT_BRAND_COLOR;

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

// ---------------------------------------------------------------------------
// Brand GRADIENT (ombre) support.
//
// A tenant's brand can be a SOLID (one color) or a two-stop OMBRE
// (brand_color -> brand_color_secondary). The ombre is used for decorative
// DEPTH surfaces — the dashboard header band, icon tiles, hero accents — that
// carry the marketing homepage's look into the portal, but with the TENANT's
// own colors (never the indigo->teal marketing signature).
//
// Legibility: anywhere WHITE text sits on the brand, both stops are passed
// through `accessibleBrand` first (darken-as-needed, hue preserved) so the text
// stays WCAG AA across the whole band. A blank/invalid secondary collapses to
// the primary, i.e. a solid — so every helper below degrades to the existing
// solid behaviour for the (default) solid-brand org.
// ---------------------------------------------------------------------------

export interface BrandGradient {
  /** Primary stop (always present). */
  from: string;
  /** Secondary stop, or null when the brand is a solid. */
  to: string | null;
}

/** True when `secondary` is a usable, distinct second stop (=> ombre, not solid). */
export function isGradientBrand(
  primary: string | null | undefined,
  secondary: string | null | undefined,
): boolean {
  const p = parseHexColor(primary);
  const s = parseHexColor(secondary);
  if (!p || !s) return false;
  return toHex(p) !== toHex(s);
}

/**
 * Both stops run through `accessibleBrand` so white text is readable across the
 * whole surface. A blank/invalid/equal secondary collapses to the primary, so
 * the result is `{ from, to }` with `from === to` for a solid brand.
 */
export function accessibleStops(
  primary: string | null | undefined,
  secondary: string | null | undefined,
): { from: string; to: string } {
  const from = accessibleBrand(primary);
  const to = isGradientBrand(primary, secondary)
    ? accessibleBrand(secondary)
    : from;
  return { from, to };
}

/**
 * CSS value for a brand surface: a `linear-gradient(...)` when the brand is an
 * ombre, otherwise the solid hex. Suitable for the `background` shorthand (NOT
 * `background-color`, which rejects gradients). Stops are legibility-guarded, so
 * this is safe behind white text (header band, primary buttons).
 */
export function brandGradientCss(
  primary: string | null | undefined,
  secondary: string | null | undefined,
  angleDeg: number = 135,
): string {
  const { from, to } = accessibleStops(primary, secondary);
  return from === to ? from : `linear-gradient(${angleDeg}deg, ${from}, ${to})`;
}

/**
 * Raw (NON-guarded) gradient for purely decorative, text-free tints — soft
 * background washes, blur blobs, low-opacity fills where contrast is moot and
 * preserving the picked colors exactly looks better. Falls back to the default
 * brand for an unparseable primary; collapses to a solid for a missing
 * secondary.
 */
export function decorativeGradientCss(
  primary: string | null | undefined,
  secondary: string | null | undefined,
  angleDeg: number = 135,
): string {
  const p = parseHexColor(primary) ? toHex(parseHexColor(primary)!) : DEFAULT_BRAND_COLOR;
  if (!isGradientBrand(primary, secondary)) return p;
  const s = toHex(parseHexColor(secondary)!);
  return `linear-gradient(${angleDeg}deg, ${p}, ${s})`;
}

/**
 * Curated SOLID brand presets. Every one clears WCAG AA with white text as-is
 * (no surprise darkening), sampled across a tasteful range with the homepage
 * indigo as the default-first option.
 */
export const SOLID_PRESETS: { name: string; hex: string }[] = [
  { name: "Indigo", hex: "#4f46e5" },
  { name: "Blue", hex: "#1d4ed8" },
  { name: "Teal", hex: "#0f766e" },
  { name: "Green", hex: "#166534" },
  { name: "Violet", hex: "#7c3aed" },
  { name: "Rose", hex: "#be123c" },
  { name: "Orange", hex: "#c2410c" },
  { name: "Slate", hex: "#334155" },
];

/**
 * Curated OMBRE presets sampled to echo the homepage feel with varied palettes.
 * Stored as the colors that look best as a decorative gradient; when used behind
 * text they are legibility-guarded by `accessibleStops`/`brandGradientCss`.
 */
export const GRADIENT_PRESETS: { name: string; from: string; to: string }[] = [
  { name: "Indigo to Teal", from: "#4f46e5", to: "#14b8a6" },
  { name: "Ocean", from: "#2563eb", to: "#06b6d4" },
  { name: "Violet", from: "#7c3aed", to: "#4f46e5" },
  { name: "Sunset", from: "#db2777", to: "#ea580c" },
  { name: "Forest", from: "#15803d", to: "#0d9488" },
  { name: "Berry", from: "#be123c", to: "#7c3aed" },
];
