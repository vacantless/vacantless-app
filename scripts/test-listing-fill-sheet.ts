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
  sqftEstimate,
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

// --- sqftEstimate fallback (S269, Noam-approved table) ---------------------
ok("sqftEstimate: 0 bed -> 400 (bachelor)", sqftEstimate(0) === 400);
ok("sqftEstimate: 1 bed -> 550", sqftEstimate(1) === 550);
ok("sqftEstimate: 1 bed + den -> 625", sqftEstimate(1, true) === 625);
ok("sqftEstimate: 2 bed -> 650", sqftEstimate(2) === 650);
ok("sqftEstimate: 3 bed -> 900", sqftEstimate(3) === 900);
ok("sqftEstimate: 4+ bed -> 900 (conservative cap)", sqftEstimate(4) === 900);
ok("sqftEstimate: null beds -> null", sqftEstimate(null) === null);
ok("sqftEstimate: undefined beds -> null", sqftEstimate(undefined) === null);
ok("sqftEstimate: NaN -> null", sqftEstimate(NaN) === null);
ok("sqftEstimate: 1+den (625) sits above plain 1 bed (550)", (sqftEstimate(1, true) ?? 0) > (sqftEstimate(1, false) ?? 0));
ok("sqftEstimate: den ignored on a 2 bed", sqftEstimate(2, true) === 650);

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
// --- unit-adjacent parenthetical alias (S433, mirrors migration 0112) ------
{
  // "Unit 1 (Main)" is one unit designation: the alias strips WITH the token so
  // the triplex's three units land on one building street label.
  const a = splitAddressUnit("506 Manning Avenue, Unit 1 (Main), Toronto, ON M6G 2V7");
  ok("split: unit-adjacent (Main) stripped from street", a.street === "506 Manning Avenue, Toronto, ON M6G 2V7");
  ok("split: unit token still extracted alongside alias", a.unit === "1");
}
ok(
  "split: (Upper) alias variant collapses to the same street",
  splitAddressUnit("506 Manning Avenue, Unit 2 (Upper), Toronto, ON M6G 2V7").street ===
    "506 Manning Avenue, Toronto, ON M6G 2V7",
);
ok(
  "split: STANDALONE parenthetical (no unit token) is left intact",
  splitAddressUnit("123 Main St (North Tower), Toronto").street === "123 Main St (North Tower), Toronto",
);

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
    "Step 3 · Floor plan, features, photos & contact",
    "Step 4 · Plan & add-ons (after the photo gate)",
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
  // v3 (S267/KI425 finding A): Lead Contact lives on STEP 3, not Step 4.
  ok(
    "rentals v3: lead contact lives on step 3 (not step 4)",
    byId("rentalsca-contact-email")?.step ===
      "Step 3 · Floor plan, features, photos & contact" &&
      byId("rentalsca-contact-phone")?.step ===
        "Step 3 · Floor plan, features, photos & contact",
  );
  ok(
    "rentals v3: lead contact sits after the description on step 3",
    ids.indexOf("rentalsca-contact-email") > ids.indexOf("rentalsca-description"),
  );
  ok(
    "rentals v3: lead contact comes before the Plan step",
    ids.indexOf("rentalsca-contact-email") < ids.indexOf("rentalsca-plan"),
  );

  // v3 finding B: a Step-2 Parking block (Type + Included? + Spots).
  ok(
    "rentals v3: parking type maps from features.parking",
    byId("rentalsca-parking-type")?.value === "1 driveway spot" &&
      byId("rentalsca-parking-type")?.source === "listing" &&
      byId("rentalsca-parking-type")?.step === "Step 2 · Property details",
  );
  ok(
    "rentals v3: parking-included defaults to No (preset, never over-promise)",
    byId("rentalsca-parking-included")?.value === "No" &&
      byId("rentalsca-parking-included")?.source === "preset" &&
      byId("rentalsca-parking-included")?.guardrailId === "rentalsca-parking-included",
  );
  ok(
    "rentals v3: parking spots is a manual button-group field (null)",
    byId("rentalsca-parking-spots")?.source === "manual" &&
      byId("rentalsca-parking-spots")?.value === null,
  );
  ok(
    "rentals v3: parking block sits on step 2 after pets, before floor plan",
    ids.indexOf("rentalsca-pets") < ids.indexOf("rentalsca-parking-type") &&
      ids.indexOf("rentalsca-parking-type") < ids.indexOf("rentalsca-bedrooms"),
  );

  // v3 finding C: Step-3 Features/Amenities + Promotion/Open House.
  ok(
    "rentals v3: unit features mapped from flags (A/C set on FULL)",
    byId("rentalsca-unit-features")?.value === "Air Conditioning" &&
      byId("rentalsca-unit-features")?.source === "listing" &&
      byId("rentalsca-unit-features")?.step ===
        "Step 3 · Floor plan, features, photos & contact",
  );
  ok(
    "rentals v3: building features present (manual when nothing maps)",
    !!byId("rentalsca-building-features"),
  );
  ok(
    "rentals v3: promotion / open house is an optional manual reminder",
    byId("rentalsca-promotion")?.source === "manual" &&
      byId("rentalsca-promotion")?.value === null,
  );

  // v3 finding E: the +$20 Credit Report uncheck is surfaced on the Plan field.
  ok(
    "rentals v3: plan hint flags the +$20 Credit Report add-on",
    /credit report/i.test(byId("rentalsca-plan")?.hint ?? ""),
  );

  // guardrailIds still all resolve after the rebuild (incl. new parking-included)
  const gids = new Set(guardrailsForPortal("rentals_ca").map((g) => g.id));
  ok(
    "rentals v3: all field guardrailIds resolve",
    r.fields.every((f) => !f.guardrailId || gids.has(f.guardrailId)),
  );
  ok(
    "rentals v3: new economics guardrails exist (parking + 21-day expiry)",
    gids.has("rentalsca-parking-included") && gids.has("rentalsca-free-expiry"),
  );
}

// --- v3: building features map from in-building/shared laundry -------------
{
  const r = buildFillSheet(
    { ...FULL, features: { ...FULL.features, laundry: "in_building" } },
    "rentals_ca",
  );
  const bf = r.fields.find((f) => f.id === "rentalsca-building-features");
  ok(
    "rentals v3: in-building laundry -> Laundry Facilities (listing)",
    bf?.value === "Laundry Facilities" && bf?.source === "listing",
  );
}

// --- v3: a SPARSE unit leaves the new feature/parking fields honest --------
{
  const r = buildFillSheet(SPARSE, "rentals_ca");
  const byId = (id: string) => r.fields.find((f) => f.id === id);
  ok(
    "rentals v3 sparse: parking type falls back to manual when unknown",
    byId("rentalsca-parking-type")?.source === "manual" &&
      byId("rentalsca-parking-type")?.value === null,
  );
  ok(
    "rentals v3 sparse: unit features manual when nothing maps",
    byId("rentalsca-unit-features")?.source === "manual" &&
      byId("rentalsca-unit-features")?.value === null,
  );
  ok(
    "rentals v3 sparse: parking-included preset No still present",
    byId("rentalsca-parking-included")?.value === "No",
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

// --- Zumper fill sheet v4 (S269 5-step wizard, KI427) ----------------------
{
  const z = buildFillSheet(
    { ...FULL, address: "833 Pillette Road, Unit 20, Windsor, ON" },
    "zumper",
  );
  const byId = (id: string) => z.fields.find((f) => f.id === id);
  const ids = z.fields.map((f) => f.id);

  // address splits into Street Address + Apt/Unit #
  ok(
    "zumper v4: address field is street only",
    byId("zumper-address")?.value === "833 Pillette Road, Windsor, ON",
  );
  ok("zumper v4: unit split out", byId("zumper-unit")?.value === "20");
  ok(
    "zumper v4: address carries the geocode guardrail",
    byId("zumper-address")?.guardrailId === "zumper-address-autocomplete",
  );

  // property type preset
  ok(
    "zumper v4: property type preset Apartment",
    byId("zumper-property-type")?.value === "Apartment" &&
      byId("zumper-property-type")?.source === "preset",
  );

  // real sqft -> listing source, no estimate disclosure appended
  ok(
    "zumper v4: real sqft used (listing source)",
    byId("zumper-sqft")?.value === "850" && byId("zumper-sqft")?.source === "listing",
  );
  ok(
    "zumper v4: sqft carries the required guardrail",
    byId("zumper-sqft")?.guardrailId === "zumper-sqft-required",
  );
  ok(
    "zumper v4: real-sqft description is NOT estimate-disclosed",
    !/approximate square footage/i.test(byId("zumper-description")?.value ?? ""),
  );

  // half-baths is an optional manual field
  ok(
    "zumper v4: half-baths is a manual optional field",
    byId("zumper-half-baths")?.source === "manual" &&
      byId("zumper-half-baths")?.value === null,
  );

  // amenities + pet policy map from flags (A/C set on FULL)
  ok(
    "zumper v4: in-unit amenities mapped from flags",
    byId("zumper-unit-amenities")?.value === "Air Conditioning" &&
      byId("zumper-unit-amenities")?.source === "listing",
  );
  ok("zumper v4: building amenities field present", !!byId("zumper-building-amenities"));
  ok("zumper v4: pet-policy field present", !!byId("zumper-pet-policy"));

  // photos is a manual gate on the Media step
  ok(
    "zumper v4: photos is a manual gate",
    byId("zumper-photos")?.source === "manual" &&
      byId("zumper-photos")?.value === null,
  );

  // boost preset stays
  ok(
    "zumper v4: boost preset on review step",
    byId("zumper-boost")?.value === "Continue without Boost" &&
      byId("zumper-boost")?.source === "preset",
  );

  // price keeps the rent-override guardrail
  ok(
    "zumper v4: price keeps rent-override guardrail",
    byId("zumper-price")?.guardrailId === "zumper-rent-override",
  );

  // every field is tagged with a wizard step, in non-decreasing step order
  ok("zumper v4: every field has a step", z.fields.every((f) => !!f.step));
  const ZSTEP_ORDER = [
    "Step 1 · Address",
    "Step 2 · Listing details",
    "Step 3 · Pricing",
    "Step 4 · Media",
    "Step 5 · Review & publish",
  ];
  ok(
    "zumper v4: steps are non-decreasing in field order",
    (() => {
      let maxSeen = -1;
      for (const f of z.fields) {
        const rank = ZSTEP_ORDER.indexOf(f.step ?? "");
        if (rank < 0) return false;
        if (rank < maxSeen) return false;
        maxSeen = Math.max(maxSeen, rank);
      }
      return true;
    })(),
  );
  // wizard skeleton in order: address before listing before pricing before media
  ok(
    "zumper v4: address < sqft < price < photos < boost",
    ids.indexOf("zumper-address") < ids.indexOf("zumper-sqft") &&
      ids.indexOf("zumper-sqft") < ids.indexOf("zumper-price") &&
      ids.indexOf("zumper-price") < ids.indexOf("zumper-photos") &&
      ids.indexOf("zumper-photos") < ids.indexOf("zumper-boost"),
  );

  // all field guardrailIds resolve against the portal's guardrail list
  const zgids = new Set(guardrailsForPortal("zumper").map((g) => g.id));
  ok(
    "zumper v4: all field guardrailIds resolve",
    z.fields.every((f) => !f.guardrailId || zgids.has(f.guardrailId)),
  );
  ok(
    "zumper v4: new guardrails exist (geocode + required sqft)",
    zgids.has("zumper-address-autocomplete") && zgids.has("zumper-sqft-required"),
  );

  // v5 (S271 live-post finding): Pricing → Lease details sub-step fields.
  ok(
    "zumper v5: available-date field present on the Pricing step (listing source)",
    byId("zumper-available-date")?.step === "Step 3 · Pricing" &&
      byId("zumper-available-date")?.source === "listing",
  );
  ok(
    "zumper v5: lease-length preset 1 Year on the Pricing step",
    byId("zumper-lease-length")?.value === "1 Year" &&
      byId("zumper-lease-length")?.source === "preset" &&
      byId("zumper-lease-length")?.step === "Step 3 · Pricing",
  );
  // Lease-details fields sit with price on the Pricing step, before Media.
  ok(
    "zumper v5: price < available-date < lease-length < photos",
    ids.indexOf("zumper-price") < ids.indexOf("zumper-available-date") &&
      ids.indexOf("zumper-available-date") < ids.indexOf("zumper-lease-length") &&
      ids.indexOf("zumper-lease-length") < ids.indexOf("zumper-photos"),
  );
}

// --- Zumper v5: available-date resolves from the unit's available_date -------
{
  const z = buildFillSheet(
    {
      ...FULL,
      now: new Date("2026-06-20T00:00:00Z"),
      features: { ...FULL.features, available_date: "2026-08-01" },
    },
    "zumper",
  );
  const byId = (id: string) => z.fields.find((f) => f.id === id);
  ok(
    "zumper v5: future available_date renders the dated label",
    byId("zumper-available-date")?.value === "Available Aug 1",
  );
}

// --- Zumper v4: required-sqft estimate fallback (no real size) --------------
{
  const z = buildFillSheet(
    { ...FULL, beds: 2, features: { ...FULL.features, sqft: null } },
    "zumper",
  );
  const byId = (id: string) => z.fields.find((f) => f.id === id);
  ok(
    "zumper v4: missing sqft -> 2-bed estimate (650) as preset",
    byId("zumper-sqft")?.value === "650" && byId("zumper-sqft")?.source === "preset",
  );
  ok(
    "zumper v4: estimate disclosed in the description",
    /approximate square footage/i.test(byId("zumper-description")?.value ?? ""),
  );
  ok(
    "zumper v4: estimate hint flags it as replaceable",
    /estimate/i.test(byId("zumper-sqft")?.hint ?? ""),
  );
}

// --- Zumper v4: no sqft + no beds -> sqft is a manual field -----------------
{
  const z = buildFillSheet(SPARSE, "zumper");
  const byId = (id: string) => z.fields.find((f) => f.id === id);
  ok(
    "zumper v4 sparse: no beds + no sqft -> manual sqft (null)",
    byId("zumper-sqft")?.source === "manual" && byId("zumper-sqft")?.value === null,
  );
  ok(
    "zumper v4 sparse: no estimate disclosure when nothing to estimate",
    !/approximate square footage/i.test(byId("zumper-description")?.value ?? "") ||
      byId("zumper-description")?.value === null,
  );
  ok(
    "zumper v4 sparse: amenities fall back to manual",
    byId("zumper-unit-amenities")?.source === "manual" &&
      byId("zumper-unit-amenities")?.value === null,
  );
  ok(
    "zumper v4 sparse: property-type preset still present",
    byId("zumper-property-type")?.value === "Apartment",
  );
}

// --- Zumper v4: tour field still inserts after the description --------------
{
  const z = buildFillSheet(
    { ...FULL, virtualTourUrl: "https://youriguide.com/833_pillette/" },
    "zumper",
  );
  const desc = z.fields.find((f) => f.id === "zumper-description");
  const tour = z.fields.find((f) => f.id === "zumper-virtual-tour");
  ok("zumper v4 tour: present", !!tour);
  ok(
    "zumper v4 tour: inherits the description step",
    !!tour?.step && tour?.step === desc?.step,
  );
}

// --- standard-policy profile inheritance (0048, S273) ----------------------
{
  // A unit that inherits the building lease term + sleeve A/C from the profile.
  const input: FillSheetInput = {
    address: "833 Pillette Rd, Unit 27",
    rentCents: 125000,
    beds: 1,
    baths: 1,
    features: {
      lease_term: "month_to_month", // effective (resolved upstream)
      ac_type: "sleeve",
      smoking: "non_smoking",
      on_site_management: true,
    },
    inheritedPolicyFields: ["lease_term", "ac_type", "smoking", "on_site_management"],
  };
  const rentals = buildFillSheet(input, "rentals_ca");
  const zumper = buildFillSheet(input, "zumper");
  const rId = (id: string) => rentals.fields.find((f) => f.id === id);
  const zId = (id: string) => zumper.fields.find((f) => f.id === id);

  ok(
    "policy: rentalsca lease-term uses effective term + provenance note",
    rId("rentalsca-lease-term")?.value === "Month-to-month" &&
      rId("rentalsca-lease-term")?.source === "preset" &&
      (rId("rentalsca-lease-term")?.hint ?? "").includes("building standard policy"),
  );
  ok(
    "policy: zumper lease-length uses effective term",
    zId("zumper-lease-length")?.value === "Month-to-month",
  );
  ok(
    "policy: rentalsca unit features ticks A/C from ac_type (no boolean set)",
    (rId("rentalsca-unit-features")?.value ?? "").includes("Air Conditioning"),
  );
  ok(
    "policy: rentalsca building features includes On-Site Management",
    (rId("rentalsca-building-features")?.value ?? "").includes("On-Site Management"),
  );
}
{
  // A unit that OVERRIDES the lease term (not inherited) -> source listing, no note.
  const input: FillSheetInput = {
    address: "1 King St, Unit 2",
    rentCents: 200000,
    beds: 2,
    baths: 1,
    features: { lease_term: "2_year" },
    inheritedPolicyFields: [], // unit-set, not inherited
  };
  const z = buildFillSheet(input, "zumper").fields.find((f) => f.id === "zumper-lease-length");
  ok(
    "policy: unit-set lease term -> listing source, no provenance note",
    z?.value === "2-year lease" && z?.source === "listing" && !(z?.hint ?? "").includes("building standard policy"),
  );
}
{
  // No policy at all -> falls back to the long-standing "1 Year" preset.
  const z = buildFillSheet(
    {
      address: "9 Bay St",
      rentCents: 150000,
      beds: 1,
      baths: 1,
    },
    "zumper",
  ).fields.find((f) => f.id === "zumper-lease-length");
  ok("policy: no lease term -> 1 Year preset fallback", z?.value === "1 Year" && z?.source === "preset");
}

// --- summary ---------------------------------------------------------------
console.log(`\nlisting-fill-sheet: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
