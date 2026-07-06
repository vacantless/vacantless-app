// Unit tests for the PURE lease-extract parse contract (S425): tolerant JSON
// extraction, the PII redaction guard (Layer 2 - the heart of this build), the
// normalizer (clamping, enum/bool/date/tenant coercion, term derivation), and
// the empty-draft guard. The impure vision call (lib/lease-extract-vision.ts) is
// NOT tested here - it live-proves on deploy against a SYNTHETIC lease.
// Run:  npx tsx scripts/test-lease-extract.ts
import {
  extractJsonObject,
  redactPII,
  normalizeLeaseDraft,
  isEmptyLeaseDraft,
  isAsciiApiKey,
  buildExtractionPrompt,
  EXTRACTION_SYSTEM_PROMPT,
  MAX_NOTES_LEN,
  MAX_MONEY_CENTS,
  MAX_TERM_MONTHS,
  type LeaseDraft,
} from "../lib/lease-extract";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

// --- extractJsonObject ------------------------------------------------------
ok("plain json", extractJsonObject('{"a":1}')?.a === 1);
ok(
  "json in prose",
  extractJsonObject('Sure: {"rent_cents":185000} done')?.rent_cents === 185000,
);
ok(
  "json in code fence",
  extractJsonObject('```json\n{"start_date":"2026-08-01"}\n```')?.start_date === "2026-08-01",
);
ok("nested braces don't truncate", extractJsonObject('{"a":{"b":2},"c":3}')?.c === 3);
ok("brace inside string ignored", extractJsonObject('{"note":"a } b","c":3}')?.c === 3);
ok("no object -> null", extractJsonObject("no json here") === null);
ok("array -> null", extractJsonObject("[1,2,3]") === null);
ok("non-string -> null", extractJsonObject(42) === null);

// --- redactPII (Layer 2) - CRITICAL -----------------------------------------
// Positive: anything carrying/labelling a forbidden identifier -> null.
ok("SIN dashed stripped", redactPII("123-456-789") === null);
ok("SIN spaced stripped", redactPII("123 456 789") === null);
ok("SIN in a name field stripped", redactPII("John Doe SIN 123456789") === null);
ok("SSN form stripped", redactPII("123-45-6789") === null);
ok("credit card stripped", redactPII("4111 1111 1111 1111") === null);
ok("bank account run stripped", redactPII("Acct 001234567") === null);
ok("7-digit run stripped", redactPII("ref 1234567") === null);
ok("label 'social insurance' stripped", redactPII("Social Insurance Number on file") === null);
ok("label 'date of birth' stripped", redactPII("Date of birth: shown") === null);
// DOB aliases + licence abbreviations (Codex QA S425).
ok("label 'birthdate' stripped", redactPII("Tenant birthdate 1991-05-12") === null);
ok("label 'birth date' stripped", redactPII("Birth date on file") === null);
ok("label 'born <date>' stripped", redactPII("Tenant born 1991-05-12") === null);
ok("label 'DL' abbreviation stripped", redactPII("DL A1234-56789") === null);
ok("label 'D/L' slash form stripped", redactPII("Tenant D/L A1234-56789") === null);
ok("label 'D.L.' dotted form stripped", redactPII("D.L. A1234-56789") === null);
ok("label 'D/L #' stripped", redactPII("D/L # A1234-56789") === null);
ok("label 'licence #' stripped", redactPII("Licence # provided") === null);
// Near-boundary identifier: detection runs on the FULL string before truncating,
// so a SIN pushed past the length ceiling can't be sliced past the guard.
ok(
  "near-boundary identifier stripped before truncation",
  redactPII("A".repeat(118) + " SIN 123456789") === null,
);
ok("label 'driver's licence' stripped", redactPII("Driver's Licence provided") === null);
ok("label 'void cheque' stripped", redactPII("void cheque attached") === null);
ok("label 'bank account' stripped", redactPII("bank account details enclosed") === null);
ok("label 'transit number' stripped", redactPII("transit number listed") === null);
ok("label 'passport' stripped", redactPII("passport copy included") === null);
// Negative: benign lease text passes through unchanged.
ok("benign name passes", redactPII("Jane Q. Tenant") === "Jane Q. Tenant");
ok("benign utility passes", redactPII("hydro") === "hydro");
ok("benign parking passes", redactPII("1 outdoor spot") === "1 outdoor spot");
ok(
  "benign clause note passes",
  redactPII("Rent due on the 1st; no smoking; tenant pays hydro") ===
    "Rent due on the 1st; no smoking; tenant pays hydro",
);
ok("small numbers OK (rent due day)", redactPII("due on the 15th") === "due on the 15th");
ok("null-ish token -> null", redactPII("N/A") === null);
ok("empty -> null", redactPII("   ") === null);
ok("non-string -> null", redactPII(123) === null);
ok("whitespace collapsed", redactPII("a   b\n c") === "a b c");
ok("notes length capped", (redactPII("x".repeat(999), MAX_NOTES_LEN) ?? "").length === MAX_NOTES_LEN);

// --- normalizeLeaseDraft: core money/date/term ------------------------------
const core = normalizeLeaseDraft({
  start_date: "2026-08-01",
  end_date: "2027-07-31",
  rent_cents: 185000,
  deposit_cents: 185000,
  deposit_type: "LMR",
  lease_type: "Fixed",
  tenants: [{ name: "Jane Tenant", email: "JANE@Example.com", phone: "(519) 555-0142" }],
})!;
ok("start parsed", core.start_date === "2026-08-01");
ok("end parsed", core.end_date === "2027-07-31");
ok("term derived from dates (~12)", core.term_months === 12);
ok("rent cents kept", core.rent_cents === 185000);
ok("deposit cents kept", core.deposit_cents === 185000);
ok("deposit_type lowercased enum", core.deposit_type === "lmr");
ok("lease_type lowercased enum", core.lease_type === "fixed");
ok("tenant name kept", core.tenants[0].name === "Jane Tenant");
ok("tenant email normalized", core.tenants[0].email === "jane@example.com");
ok("tenant phone -> 10 digits", core.tenants[0].phone === "5195550142");

// money parsing tolerance + clamping
ok(
  "rent as dollar string coerces",
  normalizeLeaseDraft({ rent_cents: "185000" })!.rent_cents === 185000,
);
ok(
  "rent with commas coerces",
  normalizeLeaseDraft({ rent_cents: "1,850,00" })!.rent_cents === 185000,
);
ok("rent over ceiling -> null", normalizeLeaseDraft({ rent_cents: MAX_MONEY_CENTS + 1 })!.rent_cents === null);
ok("rent zero -> null", normalizeLeaseDraft({ rent_cents: 0 })!.rent_cents === null);

// enums / bools
ok("bad deposit_type -> null", normalizeLeaseDraft({ deposit_type: "escrow" })!.deposit_type === null);
ok("month_to_month enum", normalizeLeaseDraft({ lease_type: "month_to_month" })!.lease_type === "month_to_month");
ok("pets 'no' -> false", normalizeLeaseDraft({ pets_allowed: "no" })!.pets_allowed === false);
ok("smoking true bool", normalizeLeaseDraft({ smoking_allowed: true })!.smoking_allowed === true);
ok("pets absent -> null", normalizeLeaseDraft({})!.pets_allowed === null);
ok("rent_due_day clamped in-range", normalizeLeaseDraft({ rent_due_day: 1 })!.rent_due_day === 1);
ok("rent_due_day 40 -> null", normalizeLeaseDraft({ rent_due_day: 40 })!.rent_due_day === null);

// term bounds
ok(
  "explicit term kept",
  normalizeLeaseDraft({ term_months: 24 })!.term_months === 24,
);
ok(
  "term over ceiling -> null",
  normalizeLeaseDraft({ term_months: MAX_TERM_MONTHS + 1 })!.term_months === null,
);

// PII flows through the normalizer end-to-end (Layer 2 in situ)
const dirty = normalizeLeaseDraft({
  tenants: [{ name: "Bob Renter SIN 123-456-789", email: "bob@x.com", phone: "5195550001" }],
  landlord_name: "Acme 4111111111111111",
  notes: "Tenant SSN 123-45-6789 on file; pets ok",
  unit_address: "12 Main St Unit 3",
})!;
ok("normalizer strips SIN from tenant name", dirty.tenants[0].name === null);
ok("normalizer keeps clean tenant email alongside stripped name", dirty.tenants[0].email === "bob@x.com");
ok("normalizer strips card from landlord", dirty.landlord_name === null);
ok("normalizer strips SSN-bearing note", dirty.notes === null);
ok("normalizer keeps benign address", dirty.unit_address === "12 Main St Unit 3");

// tenants coercion
ok("single tenant object tolerated", normalizeLeaseDraft({ tenants: { name: "Solo" } })!.tenants.length === 1);
ok("empty tenant rows dropped", normalizeLeaseDraft({ tenants: [{}, { name: "Real" }] })!.tenants.length === 1);
ok(
  "tenants capped at 3",
  normalizeLeaseDraft({
    tenants: [{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }],
  })!.tenants.length === 3,
);

// non-object -> null
ok("array raw -> null", normalizeLeaseDraft([1, 2]) === null);
ok("null raw -> null", normalizeLeaseDraft(null) === null);

// --- isEmptyLeaseDraft ------------------------------------------------------
const empty = normalizeLeaseDraft({ parking: "1 spot" })!; // clause-only, no core, no tenant
ok("clause-only draft is empty", isEmptyLeaseDraft(empty) === true);
ok("draft with rent is non-empty", isEmptyLeaseDraft(normalizeLeaseDraft({ rent_cents: 185000 })!) === false);
ok("draft with a tenant is non-empty", isEmptyLeaseDraft(normalizeLeaseDraft({ tenants: [{ name: "X" }] })!) === false);

// --- prompt sanity ----------------------------------------------------------
const prompt = buildExtractionPrompt();
ok("prompt asks for start_date", prompt.includes("start_date"));
ok("prompt asks for rent_cents", prompt.includes("rent_cents"));
ok("prompt asks for deposit_type", prompt.includes("deposit_type"));
ok("prompt asks for tenants", prompt.includes("tenants"));
ok("system prompt forbids SIN", /social insurance|sin/i.test(EXTRACTION_SYSTEM_PROMPT));
ok("system prompt forbids DOB", /date of birth/i.test(EXTRACTION_SYSTEM_PROMPT));
ok("system prompt allows names/emails/phones", /names, emails, and phone/i.test(EXTRACTION_SYSTEM_PROMPT));

// --- isAsciiApiKey (KI555) --------------------------------------------------
ok("valid printable-ascii key", isAsciiApiKey("sk-ant-api03-AbC_123-xyZ"));
ok("empty key rejected", !isAsciiApiKey(""));
ok("em dash rejected", !isAsciiApiKey("sk-ant—api03-abc"));
ok("smart quote rejected", !isAsciiApiKey("sk-ant’s-key"));
ok("internal space rejected", !isAsciiApiKey("sk-ant api03"));

// ---------------------------------------------------------------------------
console.log(`\nlease-extract: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
