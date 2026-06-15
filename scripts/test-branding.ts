// Run with: npx tsx scripts/test-branding.ts
import {
  normalizeHexColor,
  validateLogoUrl,
  validateOrgName,
  validateBranding,
  MAX_NAME_LEN,
} from "../lib/branding";

let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL: ${name}\n  got  ${g}\n  want ${w}`);
  }
}

// --- normalizeHexColor ---
eq("hex 6-digit with #", normalizeHexColor("#0E8C8C"), "#0e8c8c");
eq("hex 6-digit no #", normalizeHexColor("4f46e5"), "#4f46e5");
eq("hex 3-digit expands", normalizeHexColor("#abc"), "#aabbcc");
eq("hex 3-digit no # expands", normalizeHexColor("f00"), "#ff0000");
eq("hex trims whitespace", normalizeHexColor("  #0e8c8c  "), "#0e8c8c");
eq("hex lowercases", normalizeHexColor("#ABCDEF"), "#abcdef");
eq("hex reject 4-digit", normalizeHexColor("#abcd"), null);
eq("hex reject non-hex char", normalizeHexColor("#12345g"), null);
eq("hex reject named color", normalizeHexColor("teal"), null);
eq("hex reject empty", normalizeHexColor(""), null);
eq("hex reject null", normalizeHexColor(null), null);
eq("hex reject undefined", normalizeHexColor(undefined), null);

// --- validateLogoUrl ---
eq("logo empty → null (valid)", validateLogoUrl(""), { ok: true, value: null });
eq("logo blank → null (valid)", validateLogoUrl("   "), { ok: true, value: null });
eq("logo null → null (valid)", validateLogoUrl(null), { ok: true, value: null });
eq("logo https ok", validateLogoUrl("https://cdn.example.com/logo.png"), {
  ok: true,
  value: "https://cdn.example.com/logo.png",
});
eq("logo http ok", validateLogoUrl("http://example.com/a.svg"), {
  ok: true,
  value: "http://example.com/a.svg",
});
eq("logo reject relative", validateLogoUrl("/logo.png"), { ok: false });
eq("logo reject bare host", validateLogoUrl("example.com/logo.png"), { ok: false });
eq("logo reject javascript:", validateLogoUrl("javascript:alert(1)"), { ok: false });
eq("logo reject mailto:", validateLogoUrl("mailto:a@b.com"), { ok: false });
eq("logo reject data:", validateLogoUrl("data:image/png;base64,AAAA"), { ok: false });

// --- validateOrgName ---
eq("name ok trims", validateOrgName("  Agile Property Mgmt  "), {
  ok: true,
  value: "Agile Property Mgmt",
});
eq("name reject empty", validateOrgName(""), { ok: false });
eq("name reject whitespace", validateOrgName("   "), { ok: false });
eq("name reject null", validateOrgName(null), { ok: false });
eq("name at max len ok", validateOrgName("a".repeat(MAX_NAME_LEN)), {
  ok: true,
  value: "a".repeat(MAX_NAME_LEN),
});
eq("name over max len reject", validateOrgName("a".repeat(MAX_NAME_LEN + 1)), {
  ok: false,
});

// --- validateBranding (whole form) ---
eq(
  "branding all valid normalizes",
  validateBranding({ name: " Vacantless ", brand_color: "0E8C8C", logo_url: "" }),
  { ok: true, values: { name: "Vacantless", brand_color: "#0e8c8c", logo_url: null } },
);
eq(
  "branding valid with logo",
  validateBranding({
    name: "Agile",
    brand_color: "#fff",
    logo_url: "https://x.io/l.png",
  }),
  {
    ok: true,
    values: { name: "Agile", brand_color: "#ffffff", logo_url: "https://x.io/l.png" },
  },
);
{
  const r = validateBranding({ name: "", brand_color: "nope", logo_url: "/rel" });
  eq("branding all-invalid not ok", r.ok, false);
  eq("branding reports 3 errors", r.ok === false && r.errors.length, 3);
}
{
  const r = validateBranding({ name: "OK", brand_color: "#0e8c8c", logo_url: "ftp://x" });
  eq("branding bad logo only not ok", r.ok, false);
  eq("branding bad logo 1 error", r.ok === false && r.errors.length, 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
