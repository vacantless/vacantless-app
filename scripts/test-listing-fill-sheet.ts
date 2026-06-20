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
  splitAddressUnit,
  stripLeadingListMarkers,
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
    heat_included: true,
    water_included: true,
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

// --- virtual tour field (item S) -------------------------------------------
const WITH_TOUR: FillSheetInput = {
  ...FULL,
  virtualTourUrl: "https://youriguide.com/833_pillette/",
};
for (const portal of ["kijiji", "rentals_ca", "zumper", "viewit"] as const) {
  const sheet = buildFillSheet(WITH_TOUR, portal);
  const tour = sheet.fields.find((f) => f.id.endsWith("-virtual-tour"));
  ok(`${portal}: tour field present when URL set`, !!tour);
  ok(`${portal}: tour value is the URL`, tour?.value === "https://youriguide.com/833_pillette/");
  ok(`${portal}: tour source is listing`, tour?.source === "listing");
  // tour field sits right after the description field
  const ids = sheet.fields.map((f) => f.id);
  const di = ids.findIndex((i) => i.endsWith("-description"));
  ok(`${portal}: tour follows description`, di >= 0 && ids[di + 1].endsWith("-virtual-tour"));
}
// Excluded portals never grow a tour field.
for (const portal of ["facebook", "realtor_ca"] as const) {
  const sheet = buildFillSheet(WITH_TOUR, portal);
  ok(`${portal}: no tour field`, !sheet.fields.some((f) => f.id.endsWith("-virtual-tour")));
}
// No tour URL -> tour-less sheet is unchanged.
for (const portal of FILL_SHEET_PORTALS) {
  const sheet = buildFillSheet(FULL, portal);
  ok(`${portal}: no tour field when URL absent`, !sheet.fields.some((f) => f.id.endsWith("-virtual-tour")));
}
// An invalid/unsupported URL would have been nulled upstream; a null leaves no field.
{
  const sheet = buildFillSheet({ ...FULL, virtualTourUrl: null }, "rentals_ca");
  ok("null tour -> no field", !sheet.fields.some((f) => f.id.endsWith("-virtual-tour")));
}

// --- splitAddressUnit (S264 finding #2) ------------------------------------
{
  const a = splitAddressUnit("123 Spadina Ave, Unit 808, Toronto, Ontario M5V 2K4");
  ok("split: unit extracted", a.unit === "808");
  ok(
    "split: street drops the unit segment + tidies commas",
    a.street === "123 Spadina Ave, Toronto, Ontario M5V 2K4",
  );
}
ok("split: 'Suite 12B'", splitAddressUnit("5 King St, Suite 12B").unit === "12B");
ok("split: 'Apt 4'", splitAddressUnit("5 King St Apt 4").unit === "4");
ok("split: 'Apartment 9'", splitAddressUnit("5 King St, Apartment 9").unit === "9");
ok("split: '#808'", splitAddressUnit("123 Spadina Ave #808").unit === "808");
{
  const a = splitAddressUnit("833 Pillette Road, Windsor, ON");
  ok("split: no unit -> street unchanged", a.street === "833 Pillette Road, Windsor, ON");
  ok("split: no unit -> unit null", a.unit === null);
}
{
  const a = splitAddressUnit(null);
  ok("split: null in -> both null", a.street === null && a.unit === null);
}

// --- stripLeadingListMarkers (S264 finding #8) -----------------------------
ok(
  "strip: leading dash on a line removed",
  stripLeadingListMarkers("Bright suite.\n- Agile Real Estate Group") ===
    "Bright suite.\nAgile Real Estate Group",
);
ok(
  "strip: bullet + asterisk markers removed",
  stripLeadingListMarkers("• one\n* two") === "one\ntwo",
);
ok(
  "strip: a hyphenated word mid-line is untouched",
  stripLeadingListMarkers("In-suite laundry and A/C") === "In-suite laundry and A/C",
);
ok("strip: null in -> null", stripLeadingListMarkers(null) === null);

// --- Rentals.ca fill sheet v2 (S264 findings) ------------------------------
{
  const r = buildFillSheet(
    { ...FULL, address: "123 Spadina Ave, Unit 808, Toronto, Ontario M5V 2K4" },
    "rentals_ca",
  );
  const byId = (id: string) => r.fields.find((f) => f.id === id);

  // address splits into Address (street) + Unit
  ok(
    "rentals v2: address field is street only",
    byId("rentalsca-address")?.value === "123 Spadina Ave, Toronto, Ontario M5V 2K4",
  );
  ok("rentals v2: unit field split out", byId("rentalsca-unit")?.value === "808");

  // new required fields
  ok(
    "rentals v2: property type preset Apartment",
    byId("rentalsca-property-type")?.value === "Apartment" &&
      byId("rentalsca-property-type")?.source === "preset",
  );
  ok(
    "rentals v2: utilities mapped from flags",
    byId("rentalsca-utilities")?.value === "Heat, Water",
  );
  ok(
    "rentals v2: lease term preset 1 Year",
    byId("rentalsca-lease-term")?.value === "1 Year" &&
      byId("rentalsca-lease-term")?.source === "preset",
  );
  ok("rentals v2: size field present", byId("rentalsca-size")?.value === "850");

  // pet-friendly verify is a manual flag (form defaults Yes; we never assert pets)
  ok(
    "rentals v2: pets is a manual verify field (null value)",
    byId("rentalsca-pets")?.source === "manual" && byId("rentalsca-pets")?.value === null,
  );

  // photo gate is a manual field that precedes Plan + Lead Contact
  ok(
    "rentals v2: photos is a manual gate field",
    byId("rentalsca-photos")?.source === "manual" && byId("rentalsca-photos")?.value === null,
  );
  const ids = r.fields.map((f) => f.id);
  ok(
    "rentals v2: photo gate precedes Plan + Lead Contact",
    ids.indexOf("rentalsca-photos") < ids.indexOf("rentalsca-plan") &&
      ids.indexOf("rentalsca-photos") < ids.indexOf("rentalsca-contact-email"),
  );

  // description has leading dashes stripped (won't auto-bullet)
  ok(
    "rentals v2: description dash-stripped",
    byId("rentalsca-description")?.value ===
      stripLeadingListMarkers(buildListingCopy(FULL, "rentals_ca").body),
  );
  ok(
    "rentals v2: description still carries the bullet guardrail",
    byId("rentalsca-description")?.guardrailId === "rentalsca-description-bullets",
  );

  // every field is tagged with a wizard step, and they appear in step order
  ok("rentals v2: every field has a step", r.fields.every((f) => !!f.step));
  const STEP_ORDER = [
    "Step 1 · Type & location",
    "Step 2 · Property details",
    "Step 3 · Floor plan, photos & description",
    "Step 4 · Plan & contact (after the photo gate)",
  ];
  ok(
    "rentals v2: steps are non-decreasing in field order",
    (() => {
      let maxSeen = -1;
      for (const f of r.fields) {
        const rank = STEP_ORDER.indexOf(f.step ?? "");
        if (rank < maxSeen) return false;
        maxSeen = Math.max(maxSeen, rank);
      }
      return true;
    })(),
  );
  ok(
    "rentals v2: lead contact lives on step 4",
    byId("rentalsca-contact-email")?.step === "Step 4 · Plan & contact (after the photo gate)",
  );

  // guardrailIds still all resolve after the rebuild
  const gids = new Set(guardrailsForPortal("rentals_ca").map((g) => g.id));
  ok(
    "rentals v2: all field guardrailIds resolve",
    r.fields.every((f) => !f.guardrailId || gids.has(f.guardrailId)),
  );
}

// --- tour field inherits the description step on Rentals.ca ----------------
{
  const r = buildFillSheet(
    { ...FULL, virtualTourUrl: "https://youriguide.com/833_pillette/" },
    "rentals_ca",
  );
  const desc = r.fields.find((f) => f.id === "rentalsca-description");
  const tour = r.fields.find((f) => f.id.endsWith("-virtual-tour"));
  ok("rentals tour: present", !!tour);
  ok("rentals tour: inherits description step", !!tour?.step && tour?.step === desc?.step);
}

// --- summary ---------------------------------------------------------------
console.log(`\nlisting-fill-sheet: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
