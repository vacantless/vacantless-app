// Unit tests for the pure guided-description helper (lib/listing-description.ts).
// Run: npx tsx scripts/test-listing-description.ts
import {
  DESCRIPTION_SECTIONS,
  summarizeCaptured,
  capturedSummaryLine,
  buildDescriptionScaffold,
  isDescriptionBlank,
  buildDescriptionDraft,
  neighbourhoodSentence,
  flagDiscriminatoryLanguage,
  flagAnswers,
  type CapturedInput,
  type DraftFacts,
} from "../lib/listing-description";
import {
  chooseAutoListingCopy,
  descriptionNeedsAutoDraft,
  deterministicAutoDescription,
  envFlagEnabled,
  usableAutoDescription,
} from "../lib/auto-listing-copy";

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${label}`);
  }
}

// --- sections ---------------------------------------------------------------
ok("has 7 guided sections", DESCRIPTION_SECTIONS.length === 7);
ok("first section is layout & light", DESCRIPTION_SECTIONS[0].key === "layout_light");
ok(
  "every section has placeholder + prompt + examples",
  DESCRIPTION_SECTIONS.every((s) => s.placeholder && s.title && s.prompt && s.examples.length > 0),
);
ok(
  "placeholders match the spec field names",
  DESCRIPTION_SECTIONS[0].placeholder === "layout_and_light_notes" &&
    DESCRIPTION_SECTIONS.some((s) => s.placeholder === "renter_lifestyle_notes"),
);
ok(
  "examples are the kind filters can't hold (corner unit)",
  DESCRIPTION_SECTIONS[0].examples.some((e) => /corner unit/i.test(e)),
);
ok(
  "lifestyle section carries a fair-housing note",
  !!DESCRIPTION_SECTIONS.find((s) => s.key === "renter_lifestyle")?.complianceNote,
);
ok(
  "no em dashes in prompts or examples",
  DESCRIPTION_SECTIONS.every(
    (s) =>
      !s.prompt.includes("—") &&
      s.examples.every((e) => !e.includes("—")),
  ),
);

// --- summarizeCaptured ------------------------------------------------------
const full: CapturedInput = {
  beds: 2,
  baths: 1,
  sqft: 800,
  floor: "2nd",
  parking: "1 spot",
  laundry: "in_suite",
  air_conditioning: true,
  balcony: true,
  furnished: false,
  pet_friendly: true,
  heat_included: true,
  hydro_included: false,
  water_included: true,
  available_date: "2026-07-01",
};
const captured = summarizeCaptured(full);
ok("captured includes beds", captured.some((c) => /2 beds/i.test(c)));
ok("captured includes baths", captured.some((c) => /1 bath/i.test(c)));
ok("captured includes A/C", captured.some((c) => /air conditioning/i.test(c)));
ok("captured includes laundry", captured.some((c) => /in-suite laundry/i.test(c)));
ok("captured includes utilities", captured.some((c) => /included/i.test(c)));
ok(
  "captured includes availability",
  captured.some((c) => /available/i.test(c)),
);
ok(
  "pet friendly not duplicated",
  captured.filter((c) => /pet friendly/i.test(c)).length === 1,
);

const empty: CapturedInput = {};
ok(
  "empty unit still reports availability (available now)",
  summarizeCaptured(empty).some((c) => /available now/i.test(c)),
);

// --- capturedSummaryLine ----------------------------------------------------
const line = capturedSummaryLine(full);
ok("summary line mentions don't repeat", !!line && /no need to repeat/i.test(line));
ok("summary line uses 'and' before last", !!line && / and /.test(line));
ok("summary line has no em dash", !!line && !line.includes("—"));

// --- buildDescriptionScaffold -----------------------------------------------
const scaffold = buildDescriptionScaffold();
ok("scaffold has all section titles", DESCRIPTION_SECTIONS.every((s) => scaffold.includes(`${s.title}:`)));
ok("scaffold has fill-in bullets", (scaffold.match(/- /g) ?? []).length === DESCRIPTION_SECTIONS.length);
ok("scaffold has no em dash", !scaffold.includes("—"));

// --- isDescriptionBlank -----------------------------------------------------
ok("blank null", isDescriptionBlank(null) === true);
ok("blank whitespace", isDescriptionBlank("   ") === true);
ok("not blank with text", isDescriptionBlank("Bright unit") === false);

// --- buildDescriptionDraft --------------------------------------------------
const facts: DraftFacts = {
  beds: 2,
  baths: 1,
  unit_type: "apartment",
  parking: "carport",
  laundry: "in_building",
  air_conditioning: true,
  balcony: true,
  furnished: false,
  heat_included: true,
  water_included: true,
  available_date: "2026-07-01",
  rent_cents: 135000,
};
const answers = {
  layout_and_light_notes: "open-concept corner unit with lots of natural light",
  special_features_notes: "a breakfast nook and a kitchen pass-through",
  condition_and_finish_notes: "freshly painted with updated flooring",
  practical_extra_notes: "private carport spot at the rear",
  building_notes: "quiet, well-kept low-rise",
  neighbourhood_notes: "transit, groceries, and parks",
  renter_lifestyle_notes: "quiet, low-maintenance living",
};
const draft = buildDescriptionDraft(facts, answers);
ok("draft leads with the layout, not bedroom count", /^Open-concept corner unit/.test(draft));
ok("draft includes features", /breakfast nook/i.test(draft));
ok("draft includes condition", /freshly painted/i.test(draft));
ok("draft includes structured practicals", /air conditioning/i.test(draft));
ok("draft includes utilities", /included/i.test(draft));
ok("draft includes neighbourhood", /Close to transit/i.test(draft));
ok("draft lifestyle is place-not-person", /Well-suited to quiet, low-maintenance living/i.test(draft));
ok("draft has availability", /Available/i.test(draft));
ok("draft has rent", /Rent is \$1350 per month/.test(draft));
ok("draft has viewing CTA", /Inquire to book a viewing/.test(draft));
ok("draft has paragraphs", draft.includes("\n\n"));
ok("draft has no links", !/https?:\/\//.test(draft));
ok("draft has no em dash", !draft.includes("—"));

// --- S532 auto listing copy decision ---------------------------------------
ok("env flag accepts true", envFlagEnabled("true"));
ok("env flag accepts 1", envFlagEnabled("1"));
ok("env flag rejects unset", !envFlagEnabled(""));
ok("blank description needs auto draft", descriptionNeedsAutoDraft("   "));
ok("existing description is dirty and preserved", !descriptionNeedsAutoDraft("Cozy unit"));
ok("usable auto description rejects short copy", usableAutoDescription("Too short") === null);
{
  const decision = chooseAutoListingCopy({
    enabled: false,
    currentDescription: "",
    facts,
    aiDescription: "Bright unit close to transit with in-suite laundry and a practical layout.",
  });
  ok("auto copy flag off is no-op", !decision.shouldWrite && decision.source === "disabled");
}
{
  const decision = chooseAutoListingCopy({
    enabled: true,
    currentDescription: "Operator wrote this",
    facts,
    aiDescription:
      "Bright unit with a practical layout and clear rental details. Inquire to book a viewing.",
  });
  ok("auto copy never overwrites operator text", !decision.shouldWrite && decision.source === "existing");
}
{
  const decision = chooseAutoListingCopy({
    enabled: true,
    currentDescription: "",
    facts,
    aiDescription:
      "Bright unit with a practical layout, useful storage, and clear rental details. Inquire to book a viewing.",
  });
  ok("auto copy uses usable AI draft", decision.shouldWrite && decision.source === "ai");
}
{
  const decision = chooseAutoListingCopy({
    enabled: true,
    currentDescription: "",
    facts,
    aiDescription: null,
  });
  ok("auto copy falls back to deterministic draft", decision.shouldWrite && decision.source === "deterministic");
  ok("deterministic auto draft clears 50 char floor", (decision.description ?? "").length >= 50);
}
ok("deterministic auto description exists", !!deterministicAutoDescription(facts));

// Sparse input: still produces something useful, invents nothing.
const sparse = buildDescriptionDraft({ beds: 1 }, {});
ok("sparse draft is non-empty", sparse.length > 0);
ok("sparse draft has CTA", /Inquire to book a viewing/.test(sparse));
ok("sparse draft invents no features", !/breakfast|granite|renovated/i.test(sparse));

// Link stripping in an answer.
const linky = buildDescriptionDraft({ beds: 1 }, { layout_and_light_notes: "bright unit see https://x.com" });
ok("draft strips links from answers", !/https?:\/\//.test(linky));

// All-caps answer gets de-shouted.
const shout = buildDescriptionDraft({ beds: 1 }, { layout_and_light_notes: "AMAZING BRIGHT UNIT" });
ok("draft de-shouts all-caps", !/AMAZING BRIGHT UNIT/.test(shout) && /bright unit/i.test(shout));

// --- flagDiscriminatoryLanguage ---------------------------------------------
ok("flags no children", flagDiscriminatoryLanguage("Great unit, no children").length === 1);
ok("flags adults only", flagDiscriminatoryLanguage("adults only building").length >= 1);
ok("flags professionals only", flagDiscriminatoryLanguage("working professionals only").length >= 1);
ok("flags no ODSP", flagDiscriminatoryLanguage("no ODSP please").length >= 1);
ok("flags no newcomers", flagDiscriminatoryLanguage("no newcomers").length >= 1);
ok("flags no pets (RTA s.14)", flagDiscriminatoryLanguage("absolutely no pets").length >= 1);
ok("clean text has no flags", flagDiscriminatoryLanguage("Bright unit close to transit and parks").length === 0);
ok("flag carries a suggestion", !!flagDiscriminatoryLanguage("no children")[0].suggestion);
ok(
  "flagAnswers scans all answers",
  flagAnswers({ renter_lifestyle_notes: "mature tenants only", layout_and_light_notes: "bright" }).length >= 1,
);
ok("flagAnswers clean", flagAnswers({ layout_and_light_notes: "open concept, bright" }).length === 0);

// --- neighbourhood "Close to" de-doubling (S250) ----------------------------
ok("hood: plain note gets 'Close to' prefix",
  neighbourhoodSentence("the lake and downtown") === "Close to the lake and downtown.");
ok("hood: 'Steps to ...' not double-prefixed",
  neighbourhoodSentence("Steps to transit, grocery, and cafes") === "Steps to transit, grocery, and cafes.");
ok("hood: 'Walking distance ...' kept verbatim",
  neighbourhoodSentence("Walking distance to the subway") === "Walking distance to the subway.");
ok("hood: 'Minutes from ...' kept verbatim",
  neighbourhoodSentence("Minutes from the highway") === "Minutes from the highway.");
ok("hood: 'Near ...' kept verbatim",
  neighbourhoodSentence("Near parks and trails") === "Near parks and trails.");
ok("hood: already 'Close to ...' not doubled",
  neighbourhoodSentence("Close to everything") === "Close to everything.");
ok("hood: 'Across from ...' kept verbatim",
  neighbourhoodSentence("Across from the park") === "Across from the park.");
{
  const draft = buildDescriptionDraft(
    { beds: 1, unit_type: "unit" } as DraftFacts,
    { neighbourhood_notes: "Steps to transit, grocery, and cafes" },
  );
  ok("draft: no 'Close to Steps to' doubling", !/Close to Steps to/i.test(draft));
  ok("draft: keeps the operator's proximity phrase", /Steps to transit/i.test(draft));
}

// ----------------------------------------------------------------------------
console.log(`listing-description: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
