"use client";

// Shared brand-color picker used by onboarding + settings.
//
// A tenant's brand can be a SOLID (one color) or a two-stop OMBRE. The field
// posts two hidden inputs the server actions already read: `brand_color` and
// `brand_color_secondary` (blank => solid). It offers:
//   - a Solid / Ombre toggle
//   - curated solid + gradient presets (palette-sampled, legibility-aware)
//   - a custom two-color mode (native pickers)
//   - "From your logo" swatches sampled from the uploaded logo (best-effort)
//   - reset-to-default
//   - a live preview band that mirrors what renters see (legibility-guarded)
//
// All color math lives in lib/brand-theme (pure, tested). This component is just
// state + the canvas logo sampler.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_BRAND_COLOR,
  DEFAULT_BRAND_SECONDARY,
  SOLID_PRESETS,
  GRADIENT_PRESETS,
  brandGradientCss,
  decorativeGradientCss,
  toHex,
} from "@/lib/brand-theme";

type Mode = "solid" | "ombre";

type Props = {
  /** Stored primary; defaults to the brand default. */
  defaultPrimary?: string | null;
  /** Stored secondary; when present the field opens in Ombre mode. */
  defaultSecondary?: string | null;
  /** Existing logo URL to sample "from your logo" suggestions (best-effort). */
  logoUrl?: string | null;
  /** Notifies the parent on every change (e.g. to drive an external preview). */
  onChange?: (primary: string, secondary: string | null) => void;
};

const HEX_RE = /^#[0-9a-f]{6}$/i;
function safeHex(v: string | null | undefined, fallback: string): string {
  return v && HEX_RE.test(v) ? v.toLowerCase() : fallback;
}

// Pull a few representative colors out of a logo image via canvas. Returns []
// if the canvas is CORS-tainted or the image fails to load (graceful no-op).
async function sampleLogoColors(src: string): Promise<string[]> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const W = 48;
        const H = 48;
        const canvas = document.createElement("canvas");
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return resolve([]);
        ctx.drawImage(img, 0, 0, W, H);
        const { data } = ctx.getImageData(0, 0, W, H); // throws if tainted
        const buckets = new Map<
          string,
          { count: number; r: number; g: number; b: number }
        >();
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];
          if (a < 128) continue; // transparent
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          if (max > 242 && min > 242) continue; // near-white
          if (max < 22) continue; // near-black
          const key = `${r >> 5}-${g >> 5}-${b >> 5}`; // 8 levels/channel
          const cur = buckets.get(key);
          if (cur) {
            cur.count++;
            cur.r += r;
            cur.g += g;
            cur.b += b;
          } else {
            buckets.set(key, { count: 1, r, g, b });
          }
        }
        const ranked = [...buckets.values()].sort((x, y) => y.count - x.count);
        const out: string[] = [];
        const picked: { r: number; g: number; b: number }[] = [];
        for (const c of ranked) {
          const r = Math.round(c.r / c.count);
          const g = Math.round(c.g / c.count);
          const b = Math.round(c.b / c.count);
          // skip a color too close to one already chosen
          if (
            picked.some(
              (p) =>
                Math.abs(p.r - r) + Math.abs(p.g - g) + Math.abs(p.b - b) < 60,
            )
          )
            continue;
          picked.push({ r, g, b });
          out.push(toHex({ r, g, b }));
          if (out.length >= 4) break;
        }
        resolve(out);
      } catch {
        resolve([]); // tainted canvas (CORS) — no suggestions, no error
      }
    };
    img.onerror = () => resolve([]);
    img.src = src;
  });
}

export default function BrandColorField({
  defaultPrimary,
  defaultSecondary,
  logoUrl,
  onChange,
}: Props) {
  const initialPrimary = safeHex(defaultPrimary, DEFAULT_BRAND_COLOR);
  const initialSecondary = defaultSecondary && HEX_RE.test(defaultSecondary)
    ? defaultSecondary.toLowerCase()
    : null;

  const [mode, setMode] = useState<Mode>(initialSecondary ? "ombre" : "solid");
  const [primary, setPrimary] = useState(initialPrimary);
  // A pleasant default second stop so toggling to Ombre starts somewhere nice.
  const [secondary, setSecondary] = useState(
    initialSecondary ?? GRADIENT_PRESETS[0].to,
  );
  const [logoColors, setLogoColors] = useState<string[]>([]);

  // Sample the logo once (best-effort).
  useEffect(() => {
    let alive = true;
    if (logoUrl && /^https?:\/\//.test(logoUrl)) {
      sampleLogoColors(logoUrl).then((cols) => {
        if (alive) setLogoColors(cols);
      });
    } else {
      setLogoColors([]);
    }
    return () => {
      alive = false;
    };
  }, [logoUrl]);

  // The value that actually persists as the second stop (blank in solid mode,
  // or when the two stops are identical).
  const secondaryOut =
    mode === "ombre" && secondary.toLowerCase() !== primary.toLowerCase()
      ? secondary
      : "";

  const previewBg = brandGradientCss(primary, secondaryOut || null);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    onChangeRef.current?.(primary, secondaryOut || null);
  }, [primary, secondaryOut]);

  function reset() {
    // The default brand is the homepage ombre (indigo -> teal), so reset
    // restores that, not a flat solid.
    setMode("ombre");
    setPrimary(DEFAULT_BRAND_COLOR);
    setSecondary(DEFAULT_BRAND_SECONDARY);
  }

  const swatchBtn =
    "h-8 w-8 rounded-lg border border-black/10 shadow-sm transition hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-gray-400";

  const hasLogoOmbre = logoColors.length >= 2;

  return (
    <div className="space-y-3">
      {/* hidden inputs the server actions read */}
      <input type="hidden" name="brand_color" value={primary} />
      <input type="hidden" name="brand_color_secondary" value={secondaryOut} />

      {/* Solid / Ombre toggle */}
      <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-sm">
        {(["solid", "ombre"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded-md px-3 py-1 font-medium capitalize transition ${
              mode === m
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      {/* Native pickers + hex readout */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-2">
          <input
            type="color"
            aria-label="Brand color"
            value={primary}
            onChange={(e) => setPrimary(e.target.value)}
            className="h-10 w-14 cursor-pointer rounded-lg border border-gray-300 p-1"
          />
          {mode === "ombre" && (
            <>
              <span className="text-gray-400">→</span>
              <input
                type="color"
                aria-label="Second brand color"
                value={secondary}
                onChange={(e) => setSecondary(e.target.value)}
                className="h-10 w-14 cursor-pointer rounded-lg border border-gray-300 p-1"
              />
            </>
          )}
        </span>
        <code className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700">
          {mode === "ombre" && secondaryOut
            ? `${primary} → ${secondary}`
            : primary}
        </code>
        <button
          type="button"
          onClick={reset}
          className="text-xs font-medium text-gray-500 underline-offset-2 hover:text-gray-700 hover:underline"
        >
          Reset to default
        </button>
      </div>

      {/* Presets */}
      <div>
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-gray-400">
          {mode === "ombre" ? "Ombre presets" : "Presets"}
        </p>
        <div className="flex flex-wrap gap-2">
          {mode === "solid"
            ? SOLID_PRESETS.map((p) => (
                <button
                  key={p.hex}
                  type="button"
                  title={p.name}
                  aria-label={p.name}
                  onClick={() => setPrimary(p.hex)}
                  className={swatchBtn}
                  style={{ backgroundColor: p.hex }}
                />
              ))
            : GRADIENT_PRESETS.map((g) => (
                <button
                  key={g.name}
                  type="button"
                  title={g.name}
                  aria-label={g.name}
                  onClick={() => {
                    setPrimary(g.from);
                    setSecondary(g.to);
                  }}
                  className={swatchBtn}
                  style={{ background: decorativeGradientCss(g.from, g.to) }}
                />
              ))}
        </div>
      </div>

      {/* From your logo */}
      {logoColors.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-gray-400">
            From your logo
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {logoColors.map((c) => (
              <button
                key={c}
                type="button"
                title={c}
                aria-label={`Use ${c} from your logo`}
                onClick={() =>
                  mode === "ombre" ? setSecondary(c) : setPrimary(c)
                }
                className={swatchBtn}
                style={{ backgroundColor: c }}
              />
            ))}
            {hasLogoOmbre && (
              <button
                type="button"
                onClick={() => {
                  setMode("ombre");
                  setPrimary(logoColors[0]);
                  setSecondary(logoColors[1]);
                }}
                className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
              >
                Use as ombre
              </button>
            )}
          </div>
        </div>
      )}

      {/* Live preview band — legibility-guarded, mirrors the renter surface */}
      <div className="overflow-hidden rounded-xl border border-gray-200 shadow-sm">
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ background: previewBg }}
        >
          <span className="text-sm font-semibold text-white">Your brand</span>
          <span className="rounded-md bg-white/20 px-2 py-1 text-xs font-medium text-white">
            Book a viewing
          </span>
        </div>
      </div>
    </div>
  );
}
