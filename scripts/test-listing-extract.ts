// Unit tests for the PURE AI listing-extract contract (Feature B, S428): the
// normalizer (clamping, alias keys, tri-state booleans, laundry/date coercion),
// the empty-draft guard, and the MERGE (applyAiListing - the heart of this
// build: deterministic base always wins, AI fills only gaps, booleans only fill
// a `true` the regex missed). The impure vision call
// (lib/listing-extract-vision.ts) is NOT tested here - it live-proves on deploy.
// Run: node --experimental-strip-types --import ./ts-register.mjs scripts/test-listing-extract.ts
import {
  normalizeListingDraft,
  isEmptyListingDraft,
  emptyListingDraft,
  applyAiListing,
  buildListingExtractionPrompt,
  LISTING_SYSTEM_PROMPT,
  MAX_DESCRIPTION_LEN,
  MAX_RENT_CENTS,
  MAX_ROOMS,
  type ListingDraft,
} from "../lib/listing-extract";
import { emptyParsedListing, type ParsedListing } from "../lib/mls-import";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

// --- normalizeListingDraft: basics ------------------------------------------
ok("non-object -> null", normalizeListingDraft(42) === null);
ok("array -> null", normalizeListingDraft([1, 2]) === null);
ok("empty object -> all null draft", (() => {
  const d = normalizeListingDraft({});
  return !!d && d.address === null && d.rentCents === null && d.laundry === null;
})());

// --- money / rooms / sqft clamping ------------------------------------------
ok("rent cents integer", normalizeListingDraft({ rentCents: 185000 })?.rentCents === 185000);
// Dollar-denominated model output must scale to cents, never persist 100x too
// low (Codex P2, S429). "$1,850" is $1,850/mo -> 185000 cents, not 1850.
ok("rent from string with $ and commas -> cents", normalizeListingDraft({ rent: "$1,850" })?.rentCents === 185000);
ok("rent from bare dollar integer -> cents", normalizeListingDraft({ rent: 1850 })?.rentCents === 185000);
ok("rent from dollar string no $ -> cents", normalizeListingDraft({ rentCents: "1850" })?.rentCents === 185000);
ok("rent from dollars with decimal -> cents", normalizeListingDraft({ rent: "1850.00" })?.rentCents === 185000);
ok("rent from dollars fractional -> cents", normalizeListingDraft({ rent: "1850.50" })?.rentCents === 185050);
ok("rent already in cents kept", normalizeListingDraft({ rentCents: 90000 })?.rentCents === 90000);
ok("rent low dollar figure scaled", normalizeListingDraft({ rentCents: 900 })?.rentCents === 90000);
ok("rent over ceiling -> null", normalizeListingDraft({ rentCents: MAX_RENT_CENTS + 1 })?.rentCents === null);
ok("rent zero -> null", normalizeListingDraft({ rentCents: 0 })?.rentCents === null);
ok("beds studio 0 kept", normalizeListingDraft({ beds: 0 })?.beds === 0);
ok("beds over ceiling -> null", normalizeListingDraft({ beds: MAX_ROOMS + 5 })?.beds === null);
ok("baths half kept", normalizeListingDraft({ baths: 1.5 })?.baths === 1.5);
ok("baths rounds to nearest half", normalizeListingDraft({ baths: 1.4 })?.baths === 1.5);
ok("baths negative -> null", normalizeListingDraft({ baths: -1 })?.baths === null);
ok("sqft integer", normalizeListingDraft({ sqft: "850" })?.sqft === 850);
ok("beds alias bedrooms", normalizeListingDraft({ bedrooms: 2 })?.beds === 2);
ok("sqft alias square_feet", normalizeListingDraft({ square_feet: 700 })?.sqft === 700);

// --- date -------------------------------------------------------------------
ok("iso date kept", normalizeListingDraft({ availableDate: "2026-09-01" })?.availableDate === "2026-09-01");
ok("date alias available_date", normalizeListingDraft({ available_date: "2026-09-01" })?.availableDate === "2026-09-01");
ok("bad date -> null", normalizeListingDraft({ availableDate: "Sept 1" })?.availableDate === null);
ok("out-of-range year -> null", normalizeListingDraft({ availableDate: "1980-01-01" })?.availableDate === null);
ok("impossible month -> null", normalizeListingDraft({ availableDate: "2026-13-01" })?.availableDate === null);

// --- tri-state booleans -----------------------------------------------------
ok("ac true", normalizeListingDraft({ airConditioning: true })?.airConditioning === true);
ok("ac false kept as false", normalizeListingDraft({ airConditioning: false })?.airConditioning === false);
ok("ac unknown -> null", normalizeListingDraft({})?.airConditioning === null);
ok("ac string yes -> true", normalizeListingDraft({ ac: "yes" })?.airConditioning === true);
ok("heat included alias", normalizeListingDraft({ heat_included: true })?.heatIncluded === true);
ok("hydro string no -> false", normalizeListingDraft({ hydro: "no" })?.hydroIncluded === false);
ok("furnished garbage -> null", normalizeListingDraft({ furnished: "maybe" })?.furnished === null);

// --- laundry enum -----------------------------------------------------------
ok("laundry in_suite", normalizeListingDraft({ laundry: "in_suite" })?.laundry === "in_suite");
ok("laundry normalizes spaces/dashes", normalizeListingDraft({ laundry: "in building" })?.laundry === "in_building");
ok("laundry invalid -> null", normalizeListingDraft({ laundry: "coin-op-basement" })?.laundry === null);

// --- text fields ------------------------------------------------------------
ok("parking text kept", normalizeListingDraft({ parking: "1 surface spot" })?.parking === "1 surface spot");
ok("null-ish text -> null", normalizeListingDraft({ parking: "N/A" })?.parking === null);
ok("address alias unit_address", normalizeListingDraft({ unit_address: "12 King St" })?.address === "12 King St");
ok("description keeps newlines", (() => {
  const d = normalizeListingDraft({ description: "Line 1\nLine 2" });
  return d?.description === "Line 1\nLine 2";
})());
ok("description clamped to ceiling", (() => {
  const long = "x".repeat(MAX_DESCRIPTION_LEN + 500);
  return (normalizeListingDraft({ description: long })?.description?.length ?? 0) === MAX_DESCRIPTION_LEN;
})());
// A listing carries no pet field by design - a stray pets key must be ignored.
ok("pets key ignored (not in contract)", (() => {
  const d = normalizeListingDraft({ pets_allowed: true, rentCents: 1000 }) as unknown as Record<string, unknown>;
  return !("pets_allowed" in d) && !("pets" in d);
})());

// --- isEmptyListingDraft ----------------------------------------------------
ok("empty draft is empty", isEmptyListingDraft(emptyListingDraft()) === true);
ok("draft with rent is non-empty", isEmptyListingDraft({ ...emptyListingDraft(), rentCents: 1000 }) === false);
ok("draft with only a true bool is non-empty", isEmptyListingDraft({ ...emptyListingDraft(), balcony: true }) === false);
ok("draft with only a false bool is empty", isEmptyListingDraft({ ...emptyListingDraft(), balcony: false }) === true);
ok("draft with only laundry is non-empty", isEmptyListingDraft({ ...emptyListingDraft(), laundry: "none" }) === false);

// --- applyAiListing: the merge ----------------------------------------------
function baseWith(overrides: Partial<ParsedListing>): ParsedListing {
  return { ...emptyParsedListing(), ...overrides };
}
const fullAi: ListingDraft = {
  ...emptyListingDraft(),
  address: "500 AI Ave",
  rentCents: 200000,
  beds: 2,
  baths: 1,
  sqft: 800,
  parking: "1 spot",
  description: "A lovely unit",
  availableDate: "2026-10-01",
  airConditioning: true,
  balcony: true,
  furnished: true,
  laundry: "in_suite",
  heatIncluded: true,
  hydroIncluded: true,
  waterIncluded: true,
};

// AI fills every gap on an empty base.
{
  const { merged, added } = applyAiListing(emptyParsedListing(), fullAi);
  ok("merge fills address on empty base", merged.address === "500 AI Ave");
  ok("merge fills rent", merged.rentCents === 200000);
  ok("merge fills booleans true", merged.airConditioning === true && merged.balcony === true);
  ok("merge fills laundry", merged.laundry === "in_suite");
  ok("merge records added labels", added.includes("Address") && added.includes("Rent") && added.includes("Air conditioning"));
  ok("merge foundFields includes AI-added", merged.foundFields.includes("Laundry"));
}

// Deterministic base ALWAYS wins - AI never overwrites a found value.
{
  const base = baseWith({
    address: "1 Real St",
    rentCents: 150000,
    foundFields: ["Address", "Rent"],
  });
  const { merged, added } = applyAiListing(base, fullAi);
  ok("base address preserved", merged.address === "1 Real St");
  ok("base rent preserved", merged.rentCents === 150000);
  ok("AI still fills the gaps base left", merged.beds === 2 && merged.sqft === 800);
  ok("added does not double-count base fields", !added.includes("Address") && !added.includes("Rent"));
  ok("beds label added once", added.filter((l) => l === "Beds").length === 1);
}

// Booleans: AI only fills a `true` the base didn't already find; AI false/null never touches base.
{
  // Base found A/C true already (label present) - AI true must not duplicate the label.
  const base = baseWith({ airConditioning: true, foundFields: ["Air conditioning"] });
  const { merged, added } = applyAiListing(base, { ...emptyListingDraft(), airConditioning: true });
  ok("base-found bool not duplicated in added", !added.includes("Air conditioning"));
  ok("base-found bool foundFields not duplicated", merged.foundFields.filter((l) => l === "Air conditioning").length === 1);
}
{
  // Base did NOT find balcony (default false, no label); AI says false -> stays false, no add.
  const { merged, added } = applyAiListing(emptyParsedListing(), { ...emptyListingDraft(), balcony: false });
  ok("AI false does not set a boolean", merged.balcony === false);
  ok("AI false adds no label", !added.includes("Balcony"));
}
{
  // AI null boolean never fills.
  const { merged, added } = applyAiListing(emptyParsedListing(), { ...emptyListingDraft(), furnished: null });
  ok("AI null boolean does not fill", merged.furnished === false && !added.includes("Furnished"));
}
{
  // A scalar the base set to a value must not be overwritten even by a different AI value.
  const base = baseWith({ description: "Base desc", foundFields: ["Description"] });
  const { merged } = applyAiListing(base, { ...emptyListingDraft(), description: "AI desc" });
  ok("base scalar not overwritten by AI", merged.description === "Base desc");
}
{
  // Merge returns a NEW object; base is not mutated.
  const base = emptyParsedListing();
  applyAiListing(base, fullAi);
  ok("merge does not mutate base", base.address === null && base.foundFields.length === 0);
}

// --- prompt shape -----------------------------------------------------------
ok("system prompt mentions listing", /listing/i.test(LISTING_SYSTEM_PROMPT));
ok("system prompt forbids pet inference", /pet/i.test(LISTING_SYSTEM_PROMPT));
ok("extraction prompt names the keys", (() => {
  const p = buildListingExtractionPrompt();
  return p.includes('"rentCents"') && p.includes('"laundry"') && !p.includes("pets");
})());

// --- report -----------------------------------------------------------------
if (failed > 0) {
  console.error(`\nlisting-extract: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`listing-extract: ${passed} passed, ${failed} failed`);
