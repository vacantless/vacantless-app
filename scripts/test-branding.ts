// Run with: npx tsx scripts/test-branding.ts
import {
  normalizeHexColor,
  validateLogoUrl,
  validateOrgName,
  validateReplyToEmail,
  validateFeedbackDelayHours,
  validateBranding,
  MAX_NAME_LEN,
  DEFAULT_FEEDBACK_DELAY_HOURS,
  MAX_FEEDBACK_DELAY_HOURS,
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

// --- validateReplyToEmail ---
eq("reply-to empty → null (valid)", validateReplyToEmail(""), { ok: true, value: null });
eq("reply-to blank → null (valid)", validateReplyToEmail("   "), { ok: true, value: null });
eq("reply-to null → null (valid)", validateReplyToEmail(null), { ok: true, value: null });
eq("reply-to simple ok", validateReplyToEmail("leasing@agile.ca"), {
  ok: true,
  value: "leasing@agile.ca",
});
eq("reply-to trims + lowercases", validateReplyToEmail("  Leasing@Agile.CA  "), {
  ok: true,
  value: "leasing@agile.ca",
});
eq("reply-to subdomain ok", validateReplyToEmail("a.b@mail.agile.co.uk"), {
  ok: true,
  value: "a.b@mail.agile.co.uk",
});
eq("reply-to plus tag ok", validateReplyToEmail("rentals+leads@agile.ca"), {
  ok: true,
  value: "rentals+leads@agile.ca",
});
eq("reply-to reject no @", validateReplyToEmail("agile.ca"), { ok: false });
eq("reply-to reject no domain dot", validateReplyToEmail("a@localhost"), { ok: false });
eq("reply-to reject space", validateReplyToEmail("a b@agile.ca"), { ok: false });
eq("reply-to reject display name", validateReplyToEmail("Agile <a@agile.ca>"), { ok: false });
eq("reply-to reject two addresses", validateReplyToEmail("a@x.ca,b@y.ca"), { ok: false });
eq("reply-to reject trailing dot domain", validateReplyToEmail("a@agile."), { ok: false });

// --- validateBranding (whole form) ---
eq(
  "branding all valid normalizes",
  validateBranding({ name: " Vacantless ", brand_color: "0E8C8C", logo_url: "" }),
  {
    ok: true,
    values: {
      name: "Vacantless",
      brand_color: "#0e8c8c",
      logo_url: null,
      reply_to_email: null,
      feedback_enabled: true,
      feedback_delay_hours: 2,
      nurture_enabled: true,
    },
  },
);
eq(
  "branding valid with logo + reply-to",
  validateBranding({
    name: "Agile",
    brand_color: "#fff",
    logo_url: "https://x.io/l.png",
    reply_to_email: "Leasing@Agile.CA",
  }),
  {
    ok: true,
    values: {
      name: "Agile",
      brand_color: "#ffffff",
      logo_url: "https://x.io/l.png",
      reply_to_email: "leasing@agile.ca",
      feedback_enabled: true,
      feedback_delay_hours: 2,
      nurture_enabled: true,
    },
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
{
  const r = validateBranding({
    name: "OK",
    brand_color: "#0e8c8c",
    logo_url: "",
    reply_to_email: "not-an-email",
  });
  eq("branding bad reply-to only not ok", r.ok, false);
  eq("branding bad reply-to 1 error", r.ok === false && r.errors.length, 1);
}

// --- validateFeedbackDelayHours ---
eq("delay blank → default", validateFeedbackDelayHours(""), { ok: true, value: DEFAULT_FEEDBACK_DELAY_HOURS });
eq("delay null → default", validateFeedbackDelayHours(null), { ok: true, value: DEFAULT_FEEDBACK_DELAY_HOURS });
eq("delay 0 ok", validateFeedbackDelayHours("0"), { ok: true, value: 0 });
eq("delay 24 ok", validateFeedbackDelayHours("24"), { ok: true, value: 24 });
eq("delay max ok", validateFeedbackDelayHours(MAX_FEEDBACK_DELAY_HOURS), { ok: true, value: MAX_FEEDBACK_DELAY_HOURS });
eq("delay over max rejected", validateFeedbackDelayHours(MAX_FEEDBACK_DELAY_HOURS + 1), { ok: false });
eq("delay negative rejected", validateFeedbackDelayHours("-1"), { ok: false });
eq("delay non-integer rejected", validateFeedbackDelayHours("2.5"), { ok: false });
eq("delay garbage rejected", validateFeedbackDelayHours("soon"), { ok: false });

// --- validateBranding with feedback fields ---
{
  const r = validateBranding({
    name: "OK",
    brand_color: "#0e8c8c",
    logo_url: "",
    reply_to_email: "",
    feedback_enabled: true,
    feedback_delay_hours: "6",
  });
  eq("branding feedback ok", r.ok, true);
  eq("branding feedback_enabled persisted", r.ok === true && r.values.feedback_enabled, true);
  eq("branding feedback_delay persisted", r.ok === true && r.values.feedback_delay_hours, 6);
}
{
  const r = validateBranding({
    name: "OK",
    brand_color: "#0e8c8c",
    logo_url: "",
    feedback_enabled: false,
  });
  eq("branding feedback default delay when blank", r.ok === true && r.values.feedback_delay_hours, DEFAULT_FEEDBACK_DELAY_HOURS);
  eq("branding feedback disabled persisted", r.ok === true && r.values.feedback_enabled, false);
}
{
  const r = validateBranding({
    name: "OK",
    brand_color: "#0e8c8c",
    logo_url: "",
    feedback_delay_hours: "9999",
  });
  eq("branding bad delay not ok", r.ok, false);
  eq("branding bad delay 1 error", r.ok === false && r.errors.length, 1);
}
{
  // nurture_enabled defaults to true when the field is absent (checkbox unchecked
  // sends nothing, but absence here means "not provided" — default on).
  const r = validateBranding({ name: "OK", brand_color: "#0e8c8c", logo_url: "" });
  eq("branding nurture default on", r.ok === true && r.values.nurture_enabled, true);
}
{
  const r = validateBranding({
    name: "OK",
    brand_color: "#0e8c8c",
    logo_url: "",
    nurture_enabled: false,
  });
  eq("branding nurture disabled persisted", r.ok === true && r.values.nurture_enabled, false);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
