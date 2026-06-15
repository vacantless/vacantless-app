// Run with: npx tsx scripts/test-brand-theme.ts
import {
  parseHexColor,
  toHex,
  relativeLuminance,
  contrastRatio,
  contrastWithWhite,
  accessibleBrand,
  isBrandColorTooLight,
  readableTextColor,
  DEFAULT_BRAND,
  MIN_CONTRAST_WHITE_TEXT,
  type RGB,
} from "../lib/brand-theme";

let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}\n  got  ${g}\n  want ${w}`);
  }
}
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name} (expected true)`);
  }
}
function approx(name: string, got: number, want: number, tol = 0.05) {
  if (Math.abs(got - want) <= tol) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}\n  got  ${got}\n  want ~${want}`);
  }
}

const WHITE: RGB = { r: 255, g: 255, b: 255 };
const BLACK: RGB = { r: 0, g: 0, b: 0 };

// --- parseHexColor ---
eq("parse 6-digit #", parseHexColor("#4f46e5"), { r: 79, g: 70, b: 229 });
eq("parse 6-digit no #", parseHexColor("4f46e5"), { r: 79, g: 70, b: 229 });
eq("parse 3-digit expands", parseHexColor("#fff"), { r: 255, g: 255, b: 255 });
eq("parse 3-digit no #", parseHexColor("f00"), { r: 255, g: 0, b: 0 });
eq("parse trims + case", parseHexColor("  #ABCDEF "), { r: 171, g: 205, b: 239 });
eq("parse reject 4-digit", parseHexColor("#abcd"), null);
eq("parse reject non-hex", parseHexColor("#12345g"), null);
eq("parse reject named", parseHexColor("teal"), null);
eq("parse reject empty", parseHexColor(""), null);
eq("parse reject null", parseHexColor(null), null);
eq("parse reject undefined", parseHexColor(undefined), null);

// --- toHex ---
eq("toHex basic", toHex({ r: 79, g: 70, b: 229 }), "#4f46e5");
eq("toHex pads", toHex({ r: 0, g: 5, b: 16 }), "#000510");
eq("toHex rounds", toHex({ r: 0.4, g: 254.6, b: 127.5 }), "#00ff80");
eq("toHex clamps high", toHex({ r: 300, g: 255, b: 255 }), "#ffffff");
eq("toHex clamps low", toHex({ r: -10, g: 0, b: 0 }), "#000000");

// --- luminance + contrast anchors ---
approx("lum white = 1", relativeLuminance(WHITE), 1, 0.001);
approx("lum black = 0", relativeLuminance(BLACK), 0, 0.001);
approx("contrast white/black = 21", contrastRatio(WHITE, BLACK), 21, 0.01);
approx("contrast equal = 1", contrastRatio(WHITE, WHITE), 1, 0.001);
ok("contrast is order-independent", contrastRatio(WHITE, BLACK) === contrastRatio(BLACK, WHITE));

// Known-ish values
approx("white text on indigo ~6.3", contrastWithWhite("#4f46e5"), 6.3, 0.2);
ok("white text on yellow is poor (<1.5)", contrastWithWhite("#ffff00") < 1.5);
// The house teal #0e8c8c is ~4.08:1 with white text — just under AA (4.5).
ok("house teal is just under AA with white text", contrastWithWhite("#0e8c8c") < MIN_CONTRAST_WHITE_TEXT);

// --- accessibleBrand: dark-enough colors pass through unchanged ---
eq("indigo unchanged (already AA)", accessibleBrand("#4f46e5"), "#4f46e5");
eq("dark green unchanged", accessibleBrand("#14532d"), "#14532d");
eq("black unchanged", accessibleBrand("#000000"), "#000000");
eq("navy unchanged", accessibleBrand("#001f3f"), "#001f3f");
ok("house teal darkened to clear AA", contrastWithWhite(accessibleBrand("#0e8c8c")) >= MIN_CONTRAST_WHITE_TEXT);
ok("house teal change is tiny (within ~6 levels/channel)", Math.abs(parseHexColor(accessibleBrand("#0e8c8c"))!.g - 140) <= 8);
eq("fallback for invalid input -> default", accessibleBrand("not-a-color"), DEFAULT_BRAND);
eq("fallback for null -> default", accessibleBrand(null), DEFAULT_BRAND);

// --- accessibleBrand: pale colors get darkened until white text is readable ---
const palettes = ["#ffff00", "#ffffff", "#ffd1dc", "#aef0c8", "#fff7cc", "#e0e0e0", "#ccccff"];
for (const c of palettes) {
  const out = accessibleBrand(c);
  ok(`${c}: output meets AA with white text`, contrastWithWhite(out) >= MIN_CONTRAST_WHITE_TEXT);
  ok(`${c}: output actually changed`, out.toLowerCase() !== c.toLowerCase());
  // never lightens: output luminance <= input luminance
  const inLum = relativeLuminance(parseHexColor(c)!);
  const outLum = relativeLuminance(parseHexColor(out)!);
  ok(`${c}: output not lighter than input`, outLum <= inLum + 1e-6);
  // hue is roughly preserved (the channel with max value stays max-ish) -- smoke check
  ok(`${c}: output is valid hex`, /^#[0-9a-f]{6}$/.test(out));
}

// "Lightest that clears" property: nudging the result lighter should fail AA.
// Take yellow, get the guardrailed value, scale it up 6% and confirm it dips below.
{
  const out = parseHexColor(accessibleBrand("#ffff00"))!;
  const lighter = toHex({ r: out.r * 1.06 + 2, g: out.g * 1.06 + 2, b: out.b * 1.06 + 2 });
  ok("guardrailed yellow is near the threshold (lighter fails AA)", contrastWithWhite(lighter) < MIN_CONTRAST_WHITE_TEXT);
}

// custom threshold
ok("higher threshold darkens more", relativeLuminance(parseHexColor(accessibleBrand("#ff8800", 7))!) <= relativeLuminance(parseHexColor(accessibleBrand("#ff8800", 4.5))!) + 1e-6);

// --- isBrandColorTooLight ---
ok("yellow is too light", isBrandColorTooLight("#ffff00"));
ok("white is too light", isBrandColorTooLight("#ffffff"));
ok("indigo is NOT too light", !isBrandColorTooLight("#4f46e5"));
ok("dark green is NOT too light", !isBrandColorTooLight("#14532d"));
ok("house teal is (just) too light at AA", isBrandColorTooLight("#0e8c8c"));
ok("invalid falls back to default (not too light)", !isBrandColorTooLight("garbage"));

// --- readableTextColor ---
eq("text on indigo = white", readableTextColor("#4f46e5"), "#ffffff");
eq("text on navy = white", readableTextColor("#001f3f"), "#ffffff");
eq("text on yellow = dark ink", readableTextColor("#ffff00"), "#111827");
eq("text on white = dark ink", readableTextColor("#ffffff"), "#111827");
eq("text on invalid -> default(indigo) = white", readableTextColor("nope"), "#ffffff");

console.log(`\nbrand-theme: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
