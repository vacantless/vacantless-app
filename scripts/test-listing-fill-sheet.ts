// Unit tests for the pure listing-fill-sheet logic.
// Run: npx tsx scripts/test-listing-fill-sheet.ts
import {
  FILL_SHEET_PORTALS,
  FILL_FIELD_SOURCES,
  buildFillSheet,
  buildAllFillSheets,
  filledFieldCount,
  unresolvedFields,
  formatPriceField,
  bedroomsField,
  bathroomsField,
  sqftField,
  yesNoField,
  type FillSheetInput,
} from "../lib/listing-fill-sheet";
import { buildListingCopy } from "../lib/listing-copy";
import { guardrailsForPortal } from "../lib/listing-guardrails";
import { PORTAL_KEYS } from "../lib/listing-distribution";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

// --- formatters ------------------------------------------------------------
ok("price: whole dollars", formatPriceField(185000) === "$1,850");
ok("price: cents kept", formatPriceField(185050) === "$1,850.50");
ok("price: null when unset", formatPriceField(null) === null);
ok("price: null when zero", formatPriceField(0) === null);
ok("price: null when negative", formatPriceField(-5) === null);

ok("bedrooms: 0 -> Studio", bedroomsField(0) === "Studio");
ok("bedrooms: 2 -> '2'", bedroomsField(2) === "2");
ok("bedrooms: null", bedroomsField(null) === null);
ok("bathrooms: 1.5", bathroomsField(1.5) === "1.5");
ok("bathrooms: null", bathroomsField(undefined) === null);

ok("sqft: strips unit", sqftField(850) === "850");
ok("sqft: null", sqftField(null) === null);
ok("sqft: null when zero", sqftField(0) === null);

ok("yesNo: true", yesNoField(true) === "Yes");
ok("yesNo: false", yesNoField(false) === "No");
ok("yesNo: null stays null (don't assume No)", yesNoField(null) === null);

// --- a fully-populated unit ------------------------------------------------
const FULL: FillSheetInput = {
  businessName: "Agile Property Management",
  address: "833 Pillette Road, Windsor, ON",
  rentCents: 185000,
  beds: 2,
  baths: 1,
  description: "Bright, renovated 2-bedroom with great light and parking.",
  publicUrl: "https://app.example.com/r/abc",
  leadContactEmail: "rentals@agileonline.ca",
  leadContactPhone: "226-773-7555",
  features: {
    available_date: null,
    sqft: 850,
    parking: "1 driveway spot",
    furnished: false,
    air_conditioning: true,
  },
  now: new Date("2026-06-20T12:00:00Z"),
};

// --- every postable portal yields a usable sheet ---------------------------
ok("6 postable portals", FILL_SHEET_PORTALS.length === 6);
ok("3 field sources", FILL_FIELD_SOURCES.length === 3);

for (const portal of FILL_SHEET_PORTALS) {
  const sheet = buildFillSheet(FULL, portal);
  ok(`${portal}: portal echoed`, sheet.portal === portal);
  ok(`${portal}: has a label`, !!sheet.label);
  ok(`${portal}: has fields`, sheet.fields.length >= 1);
  // field ids unique within the sheet
  const ids = new Set(sheet.fields.map((f) => f.id));
  ok(`${portal}: field ids unique`, ids.size === sheet.fields.length);
  // every field well-formed
  ok(
    `${portal}: fields well-formed`,
    sheet.fields.every(
      (f) =>
        !!f.id &&
        !!f.label &&
        FILL_FIELD_SOURCES.includes(f.source) &&
        (f.value === null || typeof f.value === "string"),
    ),
  );
  // every guardrailId on a field actually exists in the portal's guardrail list
  const guardrailIds = new Set(guardrailsForPortal(portal).map((g) => g.id));
  ok(
    `${portal}: every field guardrailId resolves`,
    sheet.fields.every((f) => !f.guardrailId || guardrailIds.has(f.guardrailId)),
  );
  // the sheet carries the portal's guardrail list (for the UI to resolve detail)
  ok(`${portal}: guardrails attached`, sheet.guardrails.length >= 3);
}

// --- title + body come straight from buildListingCopy (no re-derivation) ---
const kijiji = buildFillSheet(FULL, "kijiji");
const kijijiCopy = buildListingCopy(FULL, "kijiji");
const kTitle = kijiji.fields.find((f) => f.id === "kijiji-title");
const kDesc = kijiji.fields.find((f) => f.id === "kijiji-description");
ok("kijiji title === buildListingCopy title", kTitle?.value === kijijiCopy.title);
ok("kijiji description === buildListingCopy body", kDesc?.value === kijijiCopy.body);
ok(
  "facebook body uses the facebook copy profile",
  buildFillSheet(FULL, "facebook").fields.find((f) => f.id === "facebook-description")
    ?.value === buildListingCopy(FULL, "facebook").body,
);

// --- listing-data fields resolve from the unit -----------------------------
ok(
  "kijiji price field",
  kijiji.fields.find((f) => f.id === "kijiji-price")?.value === "$1,850",
);
ok(
  "kijiji bedrooms field",
  kijiji.fields.find((f) => f.id === "kijiji-bedrooms")?.value === "2",
);
ok(
  "kijiji size field strips unit",
  kijiji.fields.find((f) => f.id === "kijiji-size")?.value === "850",
);
ok(
  "kijiji furnished -> No",
  kijiji.fields.find((f) => f.id === "kijiji-furnished")?.value === "No",
);
ok(
  "kijiji category is a preset",
  kijiji.fields.find((f) => f.id === "kijiji-category")?.source === "preset",
);
ok(
  "kijiji plan recommends Lite",
  kijiji.fields.find((f) => f.id === "kijiji-plan")?.value === "Lite ($29.95)",
);
ok(
  "kijiji location is manual + lock guardrail",
  (() => {
    const f = kijiji.fields.find((x) => x.id === "kijiji-location");
    return f?.source === "manual" && f?.guardrailId === "kijiji-location-lock";
  })(),
);

// --- Rentals.ca lead-contact fields ----------------------------------------
const rentals = buildFillSheet(FULL, "rentals_ca");
ok(
  "rentals.ca contact email from input",
  rentals.fields.find((f) => f.id === "rentalsca-contact-email")?.value ===
    "rentals@agileonline.ca",
);
ok(
  "rentals.ca contact phone from input",
  rentals.fields.find((f) => f.id === "rentalsca-contact-phone")?.value ===
    "226-773-7555",
);
ok(
  "rentals.ca enable step is manual w/ disabled-default guardrail",
  (() => {
    const f = rentals.fields.find((x) => x.id === "rentalsca-enable");
    return (
      f?.source === "manual" &&
      f?.value === null &&
      f?.guardrailId === "rentalsca-disabled-default"
    );
  })(),
);

// --- a SPARSE unit leaves listing fields null, presets still present -------
const SPARSE: FillSheetInput = {
  address: "12 Test St",
  rentCents: null,
  beds: null,
  baths: null,
  description: null,
  features: {},
};
const sparseKijiji = buildFillSheet(SPARSE, "kijiji");
ok(
  "sparse: price field null",
  sparseKijiji.fields.find((f) => f.id === "kijiji-price")?.value === null,
);
ok(
  "sparse: bedrooms field null",
  sparseKijiji.fields.find((f) => f.id === "kijiji-bedrooms")?.value === null,
);
ok(
  "sparse: furnished null (not assumed No)",
  sparseKijiji.fields.find((f) => f.id === "kijiji-furnished")?.value === null,
);
ok(
  "sparse: preset plan still present",
  sparseKijiji.fields.find((f) => f.id === "kijiji-plan")?.value === "Lite ($29.95)",
);
ok(
  "sparse: address field still resolves",
  sparseKijiji.fields.find((f) => f.id === "kijiji-location")?.value === "12 Test St",
);

// --- counters --------------------------------------------------------------
ok("filledFieldCount(full kijiji) > sparse", filledFieldCount(kijiji) > filledFieldCount(sparseKijiji));
ok(
  "filledFieldCount counts only resolved listing fields",
  filledFieldCount(kijiji) ===
    kijiji.fields.filter((f) => f.source === "listing" && f.value != null).length,
);
ok(
  "unresolvedFields = every null-value field",
  unresolvedFields(sparseKijiji).every((f) => f.value === null) &&
    unresolvedFields(sparseKijiji).length ===
      sparseKijiji.fields.filter((f) => f.value == null).length,
);

// --- realtor.ca is a single DDF pointer ------------------------------------
const realtor = buildFillSheet(FULL, "realtor_ca");
ok("realtor.ca: one field", realtor.fields.length === 1);
ok(
  "realtor.ca: DDF manual pointer",
  realtor.fields[0].source === "manual" &&
    realtor.fields[0].guardrailId === "realtorca-ddf-only",
);

// --- junk / "other" key falls back, never throws ---------------------------
const junk = buildFillSheet(FULL, "craigslist" as never);
ok("junk key -> other", junk.portal === "other");
ok("junk key -> no fields", junk.fields.length === 0);
ok("junk key -> universal guardrail floor", junk.guardrails.length === 3);

const other = buildFillSheet(FULL, "other" as never);
ok("explicit other -> no fields", other.fields.length === 0);

// --- buildAllFillSheets -----------------------------------------------------
const all = buildAllFillSheets(FULL);
ok("buildAll: one per postable portal", all.length === FILL_SHEET_PORTALS.length);
ok(
  "buildAll: portals match (no 'other')",
  all.every((s) => s.portal !== "other") &&
    new Set(all.map((s) => s.portal)).size === FILL_SHEET_PORTALS.length,
);

// --- taxonomy is a subset of the canonical PortalKey list ------------------
ok(
  "fill-sheet portals are all valid PortalKeys",
  FILL_SHEET_PORTALS.every((p) => (PORTAL_KEYS as readonly string[]).includes(p)),
);

// --- summary ---------------------------------------------------------------
console.log(`\nlisting-fill-sheet: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
