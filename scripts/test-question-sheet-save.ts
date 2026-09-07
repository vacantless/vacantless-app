// Pure tests for lib/question-sheet-save.ts (SPEC-S688 Slice 2 sections 4.2 + 4.4, S692).
// Run: npx tsx scripts/test-question-sheet-save.ts

import {
  buildQuestionSheet,
  type OrgForSheet,
  type PropertyForSheet,
  type QuestionSheetInput,
} from "../lib/question-sheet";
import {
  applyQuestionSheetAnswers,
  mirrorEffectiveValues,
  parseMoneyToCents,
  parseTriState,
  sheetFormValuesFromFormData,
  type SheetFormValues,
} from "../lib/question-sheet-save";
import type { UnitFeatures } from "../lib/property-features";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${name}`);
  }
}
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) passed++;
  else {
    failed++;
    console.error(`  x ${name}: got ${g}, want ${w}`);
  }
}

const EMPTY_PROPERTY: PropertyForSheet = {
  id: "prop-1",
  rent_cents: null,
  beds: null,
  baths: null,
  sqft: null,
  available_date: null,
  unit_type: null,
  postal_code: null,
  description: null,
  furnished: null,
  air_conditioning: null,
  balcony: null,
  lease_term: null,
  pets_cats: null,
  pets_dogs: null,
  pets_dog_size: null,
  pets_notes: null,
  smoking: null,
  parking: null,
  parking_type: null,
  parking_count: null,
  heat_included: null,
  hydro_included: null,
  water_included: null,
  internet_included: null,
  cable_included: null,
  laundry: null,
  amenities: null,
  question_sheet_completed_at: null,
  question_sheet_channels: null,
};

// Everything held except the answer_once questions a Kijiji-only sheet asks.
const MOSTLY_HELD: PropertyForSheet = {
  ...EMPTY_PROPERTY,
  rent_cents: 175000,
  beds: 1,
  baths: 1,
  sqft: 802,
  available_date: "2026-12-01",
  unit_type: "apartment",
  postal_code: "M6G 2V7",
  description: "Bright lower unit on Manning with a great room, in-unit laundry and central air. ".repeat(2),
  laundry: "in_suite",
  parking_type: "none",
};

const ORG: OrgForSheet = {
  public_contact_phone: "416-555-0100",
  public_contact_email: "leads@example.com",
  reply_to_email: null,
  for_rent_by: "owner",
};

function effOf(p: PropertyForSheet, extra: UnitFeatures = {}): UnitFeatures {
  return {
    lease_term: p.lease_term,
    smoking: p.smoking,
    pets_cats: p.pets_cats,
    pets_dogs: p.pets_dogs,
    pets_dog_size: p.pets_dog_size,
    heat_included: p.heat_included,
    hydro_included: p.hydro_included,
    water_included: p.water_included,
    internet_included: p.internet_included,
    cable_included: p.cable_included,
    ...extra,
  };
}

const NOW = new Date("2026-09-07T21:30:00.000Z");

function sheetInput(overrides: Partial<QuestionSheetInput> = {}): QuestionSheetInput {
  const property = overrides.property ?? MOSTLY_HELD;
  return {
    property,
    org: overrides.org ?? ORG,
    photoCount: overrides.photoCount ?? 8,
    channels: overrides.channels ?? ["kijiji", "zumper", "rentals_ca"],
    effectiveFeatures: overrides.effectiveFeatures ?? effOf(property),
    callerCanEditOrg: overrides.callerCanEditOrg ?? true,
  };
}

function apply(values: SheetFormValues, overrides: Partial<QuestionSheetInput> = {}) {
  const input = sheetInput(overrides);
  const sheet = buildQuestionSheet(input);
  // properties.for_rent_by is NOT NULL default 'owner'; the fixtures' org says owner too.
  return { sheet, result: applyQuestionSheetAnswers({ sheet, sheetInput: input, values, now: NOW, propertyForRentBy: "owner" }) };
}

// --- parsers ----------------------------------------------------------------
eq("money: 1,250 -> 125000", parseMoneyToCents("1,250"), 125000);
eq("money: $1750.50 -> 175050", parseMoneyToCents("$1750.50"), 175050);
eq("money: 0 -> null", parseMoneyToCents("0"), null);
eq("money: text -> null", parseMoneyToCents("twelve"), null);
eq("tri: true", parseTriState("true"), true);
eq("tri: false", parseTriState("false"), false);
eq("tri: blank -> null", parseTriState(null), null);

// --- FormData bridge ----------------------------------------------------------
{
  const fd = new FormData();
  fd.append("rent", "1750");
  fd.append("utilities", "heat");
  fd.append("utilities", "water");
  const v = sheetFormValuesFromFormData(fd);
  eq("formdata: single value stays a string", v.rent, "1750");
  eq("formdata: repeated key becomes an array", v.utilities, ["heat", "water"]);
}

// --- blank submit writes nothing, stamps nothing --------------------------------
{
  const { sheet, result } = apply({});
  ok("blank: sheet had answer_once questions to ask", sheet.answerOnceRemaining > 0);
  eq("blank: no property patch", result.propertyPatch, {});
  eq("blank: no org patch", result.orgPatch, {});
  eq("blank: nothing answered", result.answeredKeys, []);
  ok("blank: not stamped", !result.stamped);
  eq("blank: no errors", result.errors, []);
}

// --- utilities: three tri-states; blank = skip; half = error; extras optional ---------
{
  const { result } = apply({ rent: "1250", furnished: "true" });
  ok("utilities: an untouched group writes nothing", !("heat_included" in result.propertyPatch) && !("internet_included" in result.propertyPatch));
  const { result: half } = apply({ utilities_heat: "true", utilities_water: "false" });
  eq("utilities: two of three is an error", half.errors.map((e) => e.key), ["utilities"]);
  ok("utilities: the error writes none of the three", !("heat_included" in half.propertyPatch));
  const { result: extras } = apply({ utilities_internet: "true" });
  eq("utilities: internet alone is written without answering the question", [extras.propertyPatch.internet_included, extras.answeredKeys.includes("utilities")], [true, false]);
}

// --- for_rent_by follows the org on every save, even a partial one (decision 5) ----------
{
  const input = sheetInput({ org: { ...ORG, for_rent_by: "professional" } });
  const sheet = buildQuestionSheet(input);
  const result = applyQuestionSheetAnswers({ sheet, sheetInput: input, values: { furnished: "true" }, now: NOW, propertyForRentBy: "owner" });
  eq("for_rent_by: partial save mirrors org professional onto the property", result.propertyPatch.for_rent_by, "professional");
  const same = applyQuestionSheetAnswers({ sheet, sheetInput: input, values: { furnished: "true" }, now: NOW, propertyForRentBy: "professional" });
  ok("for_rent_by: already equal, not rewritten", !("for_rent_by" in same.propertyPatch));
}

// --- a full answer_once submit stamps and unions channels ------------------------
const FULL_ANSWERS: SheetFormValues = {
  furnished: "false",
  air_conditioning: "true",
  lease_term: "1_year",
  smoking: "non_smoking",
  pets_cats: "false",
  pets_dogs: "true",
  pets_dog_size: "small",
  utilities_heat: "true",
  utilities_hydro: "false",
  utilities_water: "true",
  accessibility: "false",
  for_rent_by: "professional",
};
{
  const { result } = apply(FULL_ANSWERS);
  eq("full: errors", result.errors, []);
  ok("full: stamped", result.stamped);
  eq("full: stamp time", result.propertyPatch.question_sheet_completed_at, NOW.toISOString());
  eq("full: channels", result.propertyPatch.question_sheet_channels, ["kijiji", "zumper", "rentals_ca"]);
  eq("full: furnished false written", result.propertyPatch.furnished, false);
  eq("full: ac true", result.propertyPatch.air_conditioning, true);
  eq("full: pets", [result.propertyPatch.pets_cats, result.propertyPatch.pets_dogs, result.propertyPatch.pets_dog_size, result.propertyPatch.pet_friendly], [false, true, "small", true]);
  eq("full: utilities heat+water on, hydro off, internet/cable untouched", [result.propertyPatch.heat_included, result.propertyPatch.hydro_included, result.propertyPatch.water_included, "internet_included" in result.propertyPatch, "cable_included" in result.propertyPatch], [true, false, true, false, false]);
  eq("full: accessibility no -> amenities stays null", result.propertyPatch.amenities, null);
  // ORG already holds for_rent_by = owner, so the sheet never asked it; the
  // submitted "professional" is ignored and the stamp mirrors the org value.
  ok("full: for_rent_by not asked when the org holds it; property already equal, so untouched (decision 5)", result.orgPatch.for_rent_by === undefined && !("for_rent_by" in result.propertyPatch));
  ok("full: rebuilt sheet complete", result.rebuilt.complete);
  ok("full: nothing mirrored (every value was answered)", result.mirroredFields.length === 0);
}

// --- accessibility yes adds the amenity, keeps the others ----------------------------
{
  const { result } = apply(
    { ...FULL_ANSWERS, accessibility: "true" },
    { property: { ...MOSTLY_HELD, amenities: ["dishwasher"] } },
  );
  eq("accessibility yes -> amenity appended", result.propertyPatch.amenities, ["dishwasher", "wheelchair_accessible"]);
  const { result: r2 } = apply(
    { ...FULL_ANSWERS, accessibility: "false" },
    { property: { ...MOSTLY_HELD, amenities: ["wheelchair_accessible", "dishwasher"] } },
  );
  // The amenity present = held = the sheet does not ask; "no" is edited on the
  // property page's amenities, not here.
  ok("accessibility: amenity present means the sheet does not ask (no write)", !("amenities" in r2.propertyPatch));
}

// --- partial submit writes what was given, does not stamp ----------------------------
{
  const { result } = apply({ lease_term: "1_year", furnished: "true" });
  eq("partial: patch", result.propertyPatch, { furnished: true, lease_term: "1_year" });
  ok("partial: not stamped", !result.stamped);
  ok("partial: rebuilt sheet no longer asks lease_term", !result.rebuilt.questions.some((q) => q.key === "lease_term"));
  ok("partial: rebuilt sheet still asks smoking", result.rebuilt.questions.some((q) => q.key === "smoking"));
}

// --- a bad value is an error, other answers still land, no stamp --------------------
{
  const { result } = apply({ ...FULL_ANSWERS, lease_term: "forever" });
  eq("bad value: one error on lease_term", result.errors.map((e) => e.key), ["lease_term"]);
  ok("bad value: other fields still in the patch", result.propertyPatch.furnished === false);
  ok("bad value: never stamped", !result.stamped);
  ok("bad value: no stamp columns in patch", !("question_sheet_completed_at" in result.propertyPatch));
}

// --- required questions: rent / sqft / postal / description / beds / baths --------------
{
  const { sheet, result } = apply(
    { rent: "1,250", beds: "1", baths: "1.5", sqft: "1,020", available_date: "2026-11-01", unit_type: "apartment", postal_code: "m6g2v7", description: "x".repeat(60) },
    { property: EMPTY_PROPERTY, photoCount: 0 },
  );
  ok("required: sheet asked rent", sheet.questions.some((q) => q.key === "rent"));
  eq("required: rent cents", result.propertyPatch.rent_cents, 125000);
  eq("required: baths half step", result.propertyPatch.baths, 1.5);
  eq("required: sqft with comma", result.propertyPatch.sqft, 1020);
  eq("required: postal normalized", result.propertyPatch.postal_code, "M6G 2V7");
  eq("required: description", result.propertyPatch.description, "x".repeat(60));
  ok("required: still not complete (photos + answer_once remain)", !result.stamped);
}
{
  const { result } = apply({ rent: "abc", sqft: "50", postal_code: "12345", description: "short" }, { property: EMPTY_PROPERTY, photoCount: 0 });
  eq("required: four errors", result.errors.map((e) => e.key).sort(), ["description", "postal_code", "rent", "sqft"]);
}

// --- parking -------------------------------------------------------------------------
{
  const { result } = apply({ ...FULL_ANSWERS, parking_type: "covered", parking_count: "1" }, { property: { ...MOSTLY_HELD, parking_type: null, parking: "1 covered carport" } });
  eq("parking: covered 1", [result.propertyPatch.parking_type, result.propertyPatch.parking_count], ["covered", 1]);
  eq("parking: free text refreshed", result.propertyPatch.parking, "1 covered parking space");
  const { result: none } = apply({ ...FULL_ANSWERS, parking_type: "none" }, { property: { ...MOSTLY_HELD, parking_type: null } });
  eq("parking: none -> count null, text No parking", [none.propertyPatch.parking_type, none.propertyPatch.parking_count, none.propertyPatch.parking], ["none", null, "No parking"]);
  const { result: noCount } = apply({ ...FULL_ANSWERS, parking_type: "garage" }, { property: { ...MOSTLY_HELD, parking_type: null } });
  eq("parking: typed without a count is an error", noCount.errors.map((e) => e.key), ["parking"]);
}

// --- org scope, caller cannot manage settings: skipped, reported, no error --------------
{
  const { result } = apply(
    { ...FULL_ANSWERS, contact_phone: "416-555-0199" },
    { org: { ...ORG, for_rent_by: null, public_contact_phone: null }, channels: ["kijiji"], callerCanEditOrg: false },
  );
  eq("readonly org: skipped fields reported", result.skippedOrgFields.sort(), ["contact_phone", "for_rent_by"]);
  eq("readonly org: org patch empty", result.orgPatch, {});
  eq("readonly org: no errors", result.errors, []);
  ok("readonly org: not stamped (for_rent_by + contact_phone still open)", !result.stamped);
}
{
  const { result } = apply(
    { ...FULL_ANSWERS, contact_phone: "416-555-0199", contact_email: "Leads@Example.com" },
    { org: { ...ORG, for_rent_by: null, public_contact_phone: null, public_contact_email: null }, channels: ["kijiji", "rentals_ca"] },
  );
  eq("org write: phone + email + for_rent_by", result.orgPatch, { public_contact_phone: "416-555-0199", public_contact_email: "leads@example.com", for_rent_by: "professional" });
  ok("org write: stamped", result.stamped);
}

// --- the mirror (spec 4.4 rule 1) --------------------------------------------------------
{
  // lease_term, smoking, utilities and pets come from the building/org profile:
  // the sheet never asks them, so the stamp must copy them onto the property.
  const inherited: UnitFeatures = {
    lease_term: "1_year",
    smoking: "non_smoking",
    pets_cats: true,
    pets_dogs: false,
    pets_dog_size: null,
    heat_included: true,
    hydro_included: false,
    water_included: true,
    internet_included: null,
    cable_included: null,
  };
  const { sheet, result } = apply(
    { furnished: "false", air_conditioning: "false", accessibility: "false", for_rent_by: "owner" },
    { property: MOSTLY_HELD, effectiveFeatures: inherited },
  );
  ok("mirror: sheet did not ask lease_term (held through inheritance)", !sheet.questions.some((q) => q.key === "lease_term"));
  ok("mirror: stamped", result.stamped);
  eq("mirror: fields copied", result.mirroredFields.sort(), ["heat_included", "hydro_included", "lease_term", "pets_cats", "pets_dogs", "smoking", "water_included"].sort());
  eq("mirror: values", [result.propertyPatch.lease_term, result.propertyPatch.smoking, result.propertyPatch.pets_cats, result.propertyPatch.pets_dogs, result.propertyPatch.heat_included, result.propertyPatch.hydro_included, result.propertyPatch.water_included], ["1_year", "non_smoking", true, false, true, false, true]);
  eq("mirror: pet_friendly derived from the mirrored pets", result.propertyPatch.pet_friendly, true);
  ok("mirror: null effective internet/cable not written", !("internet_included" in result.propertyPatch) && !("cable_included" in result.propertyPatch));
}
{
  // Not stamped -> no mirror (partial save keeps inheritance intact).
  const { result } = apply({ furnished: "false" }, { property: MOSTLY_HELD, effectiveFeatures: effOf(MOSTLY_HELD, { lease_term: "1_year" }) });
  ok("mirror: partial save copies nothing", result.mirroredFields.length === 0 && !("lease_term" in result.propertyPatch));
}
{
  // A value the landlord just wrote wins over the inherited one.
  const patch = { smoking: "smoking_permitted" } as Parameters<typeof mirrorEffectiveValues>[2];
  const copied = mirrorEffectiveValues(MOSTLY_HELD, { smoking: "non_smoking", lease_term: "month_to_month" }, patch);
  eq("mirror: answered field not overwritten", patch.smoking, "smoking_permitted");
  eq("mirror: only lease_term copied", copied, ["lease_term"]);
}
{
  // Bad inherited vocabulary is never copied.
  const patch = {} as Parameters<typeof mirrorEffectiveValues>[2];
  const copied = mirrorEffectiveValues(MOSTLY_HELD, { lease_term: "forever", smoking: "sometimes" }, patch);
  eq("mirror: invalid effective values skipped", copied, []);
}

// --- channel union on re-stamp --------------------------------------------------------
{
  const { result } = apply(FULL_ANSWERS, { property: { ...MOSTLY_HELD, question_sheet_completed_at: "2026-09-01T00:00:00Z", question_sheet_channels: ["facebook", "kijiji"] }, channels: ["zumper"] });
  ok("union: stamped again", result.stamped);
  eq("union: channels unioned, order kept", result.propertyPatch.question_sheet_channels, ["facebook", "kijiji", "zumper"]);
}

// --- pets: half an answer is an error; dogs=false clears the size ---------------------
{
  const { result } = apply({ ...FULL_ANSWERS, pets_cats: "true", pets_dogs: "" });
  eq("pets: cats without dogs is an error", result.errors.map((e) => e.key), ["pets"]);
  const { result: noDogs } = apply({ ...FULL_ANSWERS, pets_cats: "true", pets_dogs: "false", pets_dog_size: "large" });
  eq("pets: dogs=false clears size", noDogs.propertyPatch.pets_dog_size, null);
  const { result: blankNotes } = apply({ ...FULL_ANSWERS, pets_notes: "" });
  ok("pets: blank notes are skipped, never cleared", !("pets_notes" in blankNotes.propertyPatch));
}

console.log(`\nquestion-sheet-save: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
