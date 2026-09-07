// Pure tests for the Post Everywhere question sheet (SPEC-S688 Slice 2, 4.1 + 7).
// Run: npx tsx scripts/test-question-sheet.ts

import {
  QUESTION_KEYS,
  buildQuestionSheet,
  inferParking,
  normalizePostalCode,
  questionFieldKey,
  questionSheetFieldFacts,
  type OrgForSheet,
  type PropertyForSheet,
  type QuestionKey,
  type QuestionSheetInput,
} from "../lib/question-sheet";
import { buildListingPacketReadiness } from "../lib/listing-packet-readiness";
import { MIN_PHOTOS_BY_CHANNEL, minPhotosForChannels } from "../lib/listing-feed";
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

// --- Fixtures ---------------------------------------------------------------

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

const FULL_PROPERTY: PropertyForSheet = {
  ...EMPTY_PROPERTY,
  rent_cents: 175000,
  beds: 1,
  baths: 1,
  sqft: 802,
  available_date: "2026-12-01",
  unit_type: "apartment",
  postal_code: "M6G 2V7",
  description: "Bright lower unit on Manning with a great room, in-unit laundry and central air. ".repeat(2),
  furnished: false,
  air_conditioning: true,
  balcony: false,
  lease_term: "1_year",
  pets_cats: false,
  pets_dogs: false,
  smoking: "non_smoking",
  parking_type: "none",
  parking_count: null,
  heat_included: true,
  hydro_included: true,
  water_included: true,
  laundry: "in_suite",
  amenities: ["dishwasher"],
  question_sheet_completed_at: "2026-09-07T16:00:00Z",
  question_sheet_channels: ["kijiji", "zumper", "rentals_ca"],
};

const EMPTY_ORG: OrgForSheet = {
  public_contact_phone: null,
  public_contact_email: null,
  reply_to_email: null,
  for_rent_by: null,
};
const FULL_ORG: OrgForSheet = {
  public_contact_phone: "416-555-0100",
  public_contact_email: "leads@example.com",
  reply_to_email: null,
  for_rent_by: "owner",
};

function effOf(p: PropertyForSheet): UnitFeatures {
  // Mirror resolveEffectiveFeatures with no profile: unit values pass through.
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
  };
}

type BuildOverrides = Omit<Partial<QuestionSheetInput>, "property"> & {
  property?: Partial<PropertyForSheet>;
};

function build(
  overrides: BuildOverrides,
) {
  const property: PropertyForSheet = { ...EMPTY_PROPERTY, ...(overrides.property ?? {}) };
  const input: QuestionSheetInput = {
    property,
    org: overrides.org ?? EMPTY_ORG,
    photoCount: overrides.photoCount ?? 0,
    channels: overrides.channels ?? ["kijiji", "zumper", "rentals_ca"],
    effectiveFeatures: overrides.effectiveFeatures ?? effOf(property),
    callerCanEditOrg: overrides.callerCanEditOrg ?? true,
    answeredKeys: overrides.answeredKeys,
  };
  return buildQuestionSheet(input);
}

const keysOf = (sheet: ReturnType<typeof build>, tier?: string) =>
  sheet.questions.filter((q) => !tier || q.tier === tier).map((q) => q.key);

// --- Acceptance 1: address + rent + 1 photo, three channels ------------------

const acc1 = build({
  property: { rent_cents: 175000 },
  photoCount: 1,
  channels: ["kijiji", "zumper", "rentals_ca"],
});
eq(
  "acceptance 1: required questions, exactly",
  [...keysOf(acc1, "required")].sort(),
  ["available_date", "baths", "beds", "description", "pets", "photos", "postal_code", "sqft", "unit_type", "contact_phone", "contact_email"].sort(),
);
eq(
  "acceptance 1: answer-once block, exactly",
  [...keysOf(acc1, "answer_once")].sort(),
  ["furnished", "lease_term", "air_conditioning", "smoking", "parking", "utilities", "laundry", "for_rent_by", "accessibility"].sort(),
);
ok("acceptance 1: rent is not asked (held)", !keysOf(acc1).includes("rent"));
ok("acceptance 1: nothing in the recommended tier", keysOf(acc1, "recommended").length === 0);
ok("acceptance 1: required first, then answer_once", (() => {
  const tiers = acc1.questions.map((q) => q.tier);
  const firstAnswerOnce = tiers.indexOf("answer_once");
  return tiers.slice(0, firstAnswerOnce).every((t) => t === "required") && tiers.slice(firstAnswerOnce).every((t) => t === "answer_once");
})());
ok("acceptance 1: photos says needs 2", (() => {
  const q = acc1.questions.find((x) => x.key === "photos");
  return q?.input.kind === "photos" && q.input.min === 2 && q.input.current === 1;
})());
ok("acceptance 1: not complete", !acc1.answersComplete && !acc1.complete);
eq("acceptance 1: requiredRemaining", acc1.requiredRemaining, 11);
eq("acceptance 1: channels kept in selection order", acc1.channels, ["kijiji", "zumper", "rentals_ca"]);

// --- Held vs not held, one pair per key ---------------------------------------

type HeldPair = { key: QuestionKey; held: BuildOverrides; notHeld: BuildOverrides };
const ALL: readonly string[] = ["kijiji", "zumper", "rentals_ca"];
const pairs: HeldPair[] = [
  { key: "rent", held: { property: { rent_cents: 100 } }, notHeld: { property: { rent_cents: 0 } } },
  { key: "beds", held: { property: { beds: 0 } }, notHeld: { property: { beds: null } } },
  { key: "baths", held: { property: { baths: 1.5 } }, notHeld: { property: { baths: null } } },
  { key: "sqft", held: { property: { sqft: 500 } }, notHeld: { property: { sqft: 0 } } },
  { key: "available_date", held: { property: { available_date: "2026-12-01" } }, notHeld: { property: { available_date: "soon" } } },
  { key: "unit_type", held: { property: { unit_type: "condo" } }, notHeld: { property: { unit_type: "loft" } } },
  { key: "postal_code", held: { property: { postal_code: "m6g2v7" } }, notHeld: { property: { postal_code: "12345" } } },
  { key: "description", held: { property: { description: "x".repeat(50) } }, notHeld: { property: { description: "x".repeat(49) } } },
  { key: "photos", held: { photoCount: 2 }, notHeld: { photoCount: 1 } },
  { key: "furnished", held: { property: { furnished: false } }, notHeld: { property: { furnished: null } } },
  { key: "air_conditioning", held: { property: { air_conditioning: false } }, notHeld: { property: { air_conditioning: null } } },
  { key: "lease_term", held: { property: { lease_term: "month_to_month" } }, notHeld: { property: { lease_term: "forever" } } },
  { key: "pets", held: { property: { pets_cats: true, pets_dogs: false } }, notHeld: { property: { pets_cats: true, pets_dogs: null } } },
  { key: "smoking", held: { property: { smoking: "smoking_permitted" } }, notHeld: { property: { smoking: null } } },
  { key: "parking", held: { property: { parking_type: "covered", parking_count: 1 } }, notHeld: { property: { parking_type: "covered", parking_count: null } } },
  { key: "utilities", held: { property: { heat_included: true, hydro_included: false, water_included: false } }, notHeld: { property: { heat_included: true, hydro_included: false, water_included: null } } },
  { key: "laundry", held: { property: { laundry: "in_suite" } }, notHeld: { property: { laundry: "yes" } } },
  { key: "for_rent_by", held: { org: { ...EMPTY_ORG, for_rent_by: "professional" } }, notHeld: { org: { ...EMPTY_ORG, for_rent_by: "agent" } } },
  { key: "accessibility", held: { property: { amenities: ["wheelchair_accessible"] } }, notHeld: { property: { amenities: [] } } },
  { key: "contact_phone", held: { org: { ...EMPTY_ORG, public_contact_phone: "416" } }, notHeld: { org: { ...EMPTY_ORG, public_contact_phone: "  " } } },
  { key: "contact_email", held: { org: { ...EMPTY_ORG, reply_to_email: "a@b.c" } }, notHeld: { org: EMPTY_ORG } },
];
for (const pair of pairs) {
  const heldProp = { ...EMPTY_PROPERTY, ...(pair.held.property ?? {}) };
  const notProp = { ...EMPTY_PROPERTY, ...(pair.notHeld.property ?? {}) };
  const held = build({ ...pair.held, channels: ALL, effectiveFeatures: effOf(heldProp) });
  const not = build({ ...pair.notHeld, channels: ALL, effectiveFeatures: effOf(notProp) });
  ok(`${pair.key}: held -> not asked`, !keysOf(held).includes(pair.key));
  ok(`${pair.key}: not held -> asked`, keysOf(not).includes(pair.key));
}
ok("every question key has a held/not-held pair", pairs.length === QUESTION_KEYS.length);

// parking "none" needs no count
ok("parking none without count is held", !keysOf(build({ property: { parking_type: "none" }, channels: ALL })).includes("parking"));
// accessibility: completed sheet (for the channels that ask it) with no amenity = held (answer was No)
ok("accessibility held once the sheet is completed for kijiji", !keysOf(build({ property: { question_sheet_completed_at: "2026-09-07T00:00:00Z", question_sheet_channels: ["kijiji"], amenities: [] }, channels: ALL })).includes("accessibility"));
ok("accessibility re-asked when the completed sheet never covered kijiji", keysOf(build({ property: { question_sheet_completed_at: "2026-09-07T00:00:00Z", question_sheet_channels: ["zumper"], amenities: [] }, channels: ["zumper", "kijiji"] })).includes("accessibility"));
ok("accessibility yes is held before completion", !keysOf(build({ property: { amenities: ["wheelchair_accessible"] }, channels: ALL })).includes("accessibility"));
eq("accessibility prefill blank when never asked", build({ property: { amenities: [] }, channels: ["kijiji"] }).questions.find((q) => q.key === "accessibility")?.current, null);
// legacy false vs null (spec 7)
ok("furnished = false (legacy) is HELD", !keysOf(build({ property: { furnished: false }, channels: ALL })).includes("furnished"));
ok("furnished = null is asked", keysOf(build({ property: { furnished: null }, channels: ALL })).includes("furnished"));
// answeredKeys overlay
ok("answeredKeys counts as held for this rebuild", !keysOf(build({ channels: ALL, answeredKeys: ["accessibility", "sqft"] })).includes("accessibility"));

// --- Tier assignment per channel selection -------------------------------------

const kijijiOnly = build({ channels: ["kijiji"], property: { rent_cents: 1 } });
ok("kijiji-only: postal code required", keysOf(kijijiOnly, "required").includes("postal_code"));
ok("kijiji-only: sqft required", keysOf(kijijiOnly, "required").includes("sqft"));
ok("kijiji-only: available date is answer_once (worker defaults to today)", keysOf(kijijiOnly, "answer_once").includes("available_date"));
ok("kijiji-only: pets is answer_once", keysOf(kijijiOnly, "answer_once").includes("pets"));
ok("kijiji-only: for_rent_by asked", keysOf(kijijiOnly).includes("for_rent_by"));
ok("kijiji-only: accessibility asked", keysOf(kijijiOnly).includes("accessibility"));
ok("kijiji-only: contact phone required (partner doc)", keysOf(kijijiOnly, "required").includes("contact_phone"));
ok("kijiji-only: description required", keysOf(kijijiOnly, "required").includes("description"));
ok("kijiji-only: photos min 1", (() => { const q = kijijiOnly.questions.find((x) => x.key === "photos"); return q?.input.kind === "photos" && q.input.min === 1; })());

const zumperOnly = build({ channels: ["zumper"], property: { rent_cents: 1 } });
ok("zumper-only: no postal code question", !keysOf(zumperOnly).includes("postal_code"));
ok("zumper-only: available date required", keysOf(zumperOnly, "required").includes("available_date"));
ok("zumper-only: description required", keysOf(zumperOnly, "required").includes("description"));
ok("zumper-only: no for_rent_by, smoking, utilities, accessibility", ["for_rent_by", "smoking", "accessibility"].every((k) => !keysOf(zumperOnly).includes(k as QuestionKey)));
ok("zumper-only: utilities is recommended, not answer_once", zumperOnly.questions.find((q) => q.key === "utilities")?.tier === "recommended");

const rentalsOnly = build({ channels: ["rentals_ca"], property: { rent_cents: 1 } });
ok("rentals_ca-only: pets required (decision 4)", keysOf(rentalsOnly, "required").includes("pets"));
ok("rentals_ca-only: contact email required", keysOf(rentalsOnly, "required").includes("contact_email"));
ok("rentals_ca-only: photos min 2", (() => { const q = rentalsOnly.questions.find((x) => x.key === "photos"); return q?.input.kind === "photos" && q.input.min === 2; })());
ok("rentals_ca-only: sqft not required", !keysOf(rentalsOnly, "required").includes("sqft"));
ok("rentals_ca-only: description is recommended", rentalsOnly.questions.find((q) => q.key === "description")?.tier === "recommended");

// neededBy
const sqftQ = acc1.questions.find((q) => q.key === "sqft");
eq("neededBy for sqft = kijiji, zumper", sqftQ?.neededBy, ["kijiji", "zumper"]);
const petsQ = acc1.questions.find((q) => q.key === "pets");
ok("pets is required (rentals_ca hard block, decision 4)", petsQ?.tier === "required");
eq("pets neededBy lists every selected site that asks it", petsQ?.neededBy, ["kijiji", "zumper", "rentals_ca"]);
ok("first required question is needed by all three sites", acc1.questions[0]?.neededBy.length === 3);
const kijPets = kijijiOnly.questions.find((q) => q.key === "pets");
eq("kijiji-only pets answer_once lists kijiji", kijPets?.neededBy, ["kijiji"]);
ok("required sorted by neededBy count desc then label", (() => {
  const req = acc1.questions.filter((q) => q.tier === "required");
  for (let i = 1; i < req.length; i++) {
    const a = req[i - 1]!, b = req[i]!;
    if (a.neededBy.length < b.neededBy.length) return false;
    if (a.neededBy.length === b.neededBy.length && a.label.localeCompare(b.label) > 0) return false;
  }
  return true;
})());

// scope
ok("contact rows have scope organization", acc1.questions.filter((q) => q.key === "contact_phone" || q.key === "contact_email").every((q) => q.scope === "organization"));
ok("for_rent_by has scope organization", acc1.questions.find((q) => q.key === "for_rent_by")?.scope === "organization");
ok("property questions have scope property", acc1.questions.filter((q) => !["contact_phone", "contact_email", "for_rent_by"].includes(q.key)).every((q) => q.scope === "property"));
ok("answer_once rows carry the guessed default", acc1.questions.filter((q) => q.tier === "answer_once").every((q) => typeof q.guessedDefault === "string"));
ok("required rows carry no guessed default", acc1.questions.filter((q) => q.tier === "required").every((q) => q.guessedDefault === null));

// non-portal channel keys are ignored, duplicates collapsed
const mixed = build({ channels: ["kijiji", "site", "email", "kijiji", "nonsense"], property: { rent_cents: 1 } });
eq("non-portal keys ignored", mixed.ignoredChannels, ["site", "email", "nonsense"]);
eq("duplicate channels collapse", mixed.channels, ["kijiji"]);

// --- complete -----------------------------------------------------------------

const full = build({ property: FULL_PROPERTY, org: FULL_ORG, photoCount: 8, effectiveFeatures: effOf(FULL_PROPERTY) });
ok("full record: no questions", full.questions.length === 0);
ok("full record: answersComplete and complete", full.answersComplete && full.complete);
const fullNewChannel = build({ property: FULL_PROPERTY, org: FULL_ORG, photoCount: 8, effectiveFeatures: effOf(FULL_PROPERTY), channels: ["kijiji", "zumper", "rentals_ca", "facebook"] });
ok("adding a channel re-opens: answersComplete stays true, complete false", fullNewChannel.answersComplete && !fullNewChannel.complete);
eq("channelsNotYetCompleted names the new channel", fullNewChannel.channelsNotYetCompleted, ["facebook"]);
// First save: the record cannot show an accessibility "no" before completion
// (no column; absent amenity = never asked), so without the overlay the sheet
// still asks it, and with the save action's answeredKeys it completes.
const firstSaveNoOverlay = build({ property: { ...FULL_PROPERTY, question_sheet_completed_at: null, question_sheet_channels: null }, org: FULL_ORG, photoCount: 8, effectiveFeatures: effOf(FULL_PROPERTY) });
eq("first save without overlay: only accessibility remains", keysOf(firstSaveNoOverlay), ["accessibility"]);
const firstSave = build({ property: { ...FULL_PROPERTY, question_sheet_completed_at: null, question_sheet_channels: null }, org: FULL_ORG, photoCount: 8, effectiveFeatures: effOf(FULL_PROPERTY), answeredKeys: ["accessibility"] });
ok("first save with overlay: answersComplete true before channels are recorded", firstSave.answersComplete && !firstSave.complete);
eq("first save: every selected channel is not yet completed", firstSave.channelsNotYetCompleted, ["kijiji", "zumper", "rentals_ca"]);
const oneLeft = build({ property: { ...FULL_PROPERTY, lease_term: null }, org: FULL_ORG, photoCount: 8, effectiveFeatures: effOf({ ...FULL_PROPERTY, lease_term: null }) });
ok("one answer_once left: not complete", !oneLeft.answersComplete && oneLeft.answerOnceRemaining === 1 && oneLeft.requiredRemaining === 0);
const recOnly = build({ property: { ...FULL_PROPERTY, description: null }, org: FULL_ORG, photoCount: 8, effectiveFeatures: effOf(FULL_PROPERTY), channels: ["rentals_ca"] });
ok("only a recommended question left: complete", recOnly.answersComplete && recOnly.recommendedRemaining === 1);

// callerCanEditOrg does not change the question list; it flags org questions read-only (decision 6)
const noOrg = build({ property: { rent_cents: 1 }, callerCanEditOrg: false });
eq("callerCanEditOrg false keeps org questions in the list", keysOf(noOrg).filter((k) => ["contact_phone", "contact_email", "for_rent_by"].includes(k)).length, 3);
ok("callerCanEditOrg false marks org questions read-only, property ones not", noOrg.questions.every((q) => q.readOnly === (q.scope === "organization")));
ok("callerCanEditOrg true marks nothing read-only", acc1.questions.every((q) => !q.readOnly));

// --- Facts derived from the same rules match the packet card ------------------

const facts = questionSheetFieldFacts({
  property: { ...EMPTY_PROPERTY, rent_cents: 175000 },
  org: EMPTY_ORG,
  photoCount: 1,
  channels: ["kijiji", "zumper", "rentals_ca"],
  effectiveFeatures: {},
});
const packet = buildListingPacketReadiness({
  fieldFacts: { ...facts, title: true, address: true },
  channels: ["kijiji", "zumper", "rentals_ca"],
});
const packetMissing = new Set(packet.missingRequired.map((m) => m.field));
const sheetMissing = new Set(acc1.questions.filter((q) => q.tier === "required").map((q) => questionFieldKey(q.key)));
// postal_code is sheet-only (SHEET_ONLY_REQUIRED), so the packet card does not list it.
sheetMissing.delete("postal_code");
eq("packet card missingRequired == fields behind the sheet's required questions (minus sheet-only)", [...packetMissing].sort(), [...sheetMissing].sort());
eq("requiredFieldsRemaining == packet card missingRequired length", acc1.requiredFieldsRemaining, packet.missingRequired.length);
ok("requiredRemaining counts questions (beds + baths + postal code make it larger)", acc1.requiredRemaining === acc1.requiredFieldsRemaining + 2);
ok("photos fact honours the rentals_ca floor", facts.photos === false);
ok("beds_baths fact needs both", facts.beds_baths === false);

// --- Helpers ------------------------------------------------------------------

eq("MIN_PHOTOS_BY_CHANNEL.rentals_ca", MIN_PHOTOS_BY_CHANNEL.rentals_ca, 2);
eq("minPhotosForChannels default 1", minPhotosForChannels(["kijiji", "zumper"]), 1);
eq("minPhotosForChannels with rentals_ca", minPhotosForChannels(["kijiji", "rentals_ca"]), 2);
eq("postal code normalized", normalizePostalCode(" m6g2v7 "), "M6G 2V7");
eq("postal code with space kept", normalizePostalCode("M6G 2V7"), "M6G 2V7");
eq("bad postal code null", normalizePostalCode("M6G-2V7"), null);
eq("inferParking: 1 covered carport", inferParking("1 covered carport"), { parking_type: "covered", parking_count: 1 });
eq("inferParking: no parking", inferParking("No parking"), { parking_type: "none", parking_count: null });
eq("inferParking: none", inferParking("none"), { parking_type: "none", parking_count: null });
eq("inferParking: underground, two spots", inferParking("Two underground spots"), { parking_type: "underground", parking_count: 2 });
eq("inferParking: garage defaults to 1", inferParking("garage"), { parking_type: "garage", parking_count: 1 });
eq("inferParking: street", inferParking("street permit"), { parking_type: "street", parking_count: 1 });
eq("inferParking: count only", inferParking("2 spots included"), { parking_type: null, parking_count: 2 });
eq("inferParking: blank", inferParking("  "), null);
eq("inferParking: price is not a count", inferParking("Parking $50/month"), null);
eq("inferParking: street permit price is not a count", inferParking("street permit $25/mo"), { parking_type: "street", parking_count: 1 });
eq("inferParking: 'every' is not EV", inferParking("driveway, available every day"), { parking_type: "outdoor", parking_count: 1 });
eq("inferParking: EV charger", inferParking("1 spot with EV charger"), { parking_type: "ev_charging", parking_count: 1 });
eq("inferParking: parking not included", inferParking("parking not included"), { parking_type: "none", parking_count: null });
eq("available_date: Feb 31 is not a date", keysOf(build({ property: { available_date: "2026-02-31" }, channels: ["zumper"] })).includes("available_date"), true);
eq("postal code with double space is held (normalized)", keysOf(build({ property: { postal_code: "M6G  2V7" }, channels: ["kijiji"] })).includes("postal_code"), false);
eq("duplicate ignored keys collapse", build({ channels: ["site", "site", "kijiji"] }).ignoredChannels, ["site"]);
ok("photos help names the site with the floor", acc1.questions.find((q) => q.key === "photos")?.help?.includes("Rentals.ca") === true);
eq("inferParking: unrecognised", inferParking("ask"), null);
// prefill from free text
const prefill = build({ property: { parking: "1 covered carport" }, channels: ALL });
eq("parking prefill inferred from free text", prefill.questions.find((q) => q.key === "parking")?.current, { parking_type: "covered", parking_count: 1, inferred: true });

console.log(`question-sheet: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
