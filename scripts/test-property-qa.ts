// Unit tests for the pure property Q&A knowledge seam.
// Run: npx tsx scripts/test-property-qa.ts
import { buildAiReplyDraft } from "../lib/ai-reply";
import {
  buildQaUpsert,
  matchKnowledge,
  normalizeQuestionKey,
  type PropertyQaEntry,
} from "../lib/property-qa";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  X ${name}`);
  }
}

function same(name: string, got: unknown, want: unknown) {
  ok(name, got === want);
  if (got !== want) {
    console.error(`    got: ${String(got)}`);
    console.error(`    want: ${String(want)}`);
  }
}

function entry(
  over: Partial<PropertyQaEntry> & {
    questionText: string;
    answerText: string;
  },
): PropertyQaEntry {
  const propertyId = Object.prototype.hasOwnProperty.call(over, "propertyId")
    ? over.propertyId ?? null
    : "property-1";
  return {
    id: over.id ?? "qa-entry",
    organizationId: over.organizationId ?? "org-1",
    propertyId,
    questionKey: over.questionKey ?? normalizeQuestionKey(over.questionText),
    questionText: over.questionText,
    answerText: over.answerText,
    source: over.source ?? "operator",
    createdAt: over.createdAt ?? null,
    updatedAt: over.updatedAt ?? null,
  };
}

same(
  "normalizeQuestionKey strips case punctuation and stopwords",
  normalizeQuestionKey("Hi! Is PARKING included, please?"),
  "parking",
);
same(
  "normalizeQuestionKey keeps equivalent parking phrasings stable",
  normalizeQuestionKey("Does it include parking?"),
  normalizeQuestionKey("Is parking included?"),
);
same(
  "normalizeQuestionKey sorts stable unique tokens",
  normalizeQuestionKey("Laundry and parking, parking laundry"),
  "laundry-parking",
);

const orgParking = entry({
  id: "org-parking",
  propertyId: null,
  questionText: "Is parking included?",
  answerText: "Parking is available for $100/month.",
});
const propertyParking = entry({
  id: "property-parking",
  propertyId: "property-1",
  questionText: "Is parking included?",
  answerText: "Yes, one underground parking spot is included.",
});
const laundry = entry({
  id: "laundry",
  propertyId: null,
  questionText: "Is laundry ensuite?",
  answerText: "Laundry is in the building.",
});

same(
  "matchKnowledge property-scoped beats org-wide",
  matchKnowledge("Is parking included with this unit?", [
    orgParking,
    propertyParking,
  ])?.id,
  "property-parking",
);
same(
  "matchKnowledge keyword overlap hits org-wide",
  matchKnowledge("Can you tell me about laundry?", [orgParking, laundry])?.id,
  "laundry",
);
same(
  "matchKnowledge no confident match returns null",
  matchKnowledge("Do you allow short term stays?", [orgParking, laundry]),
  null,
);

const upsert = buildQaUpsert({
  organizationId: "org-1",
  propertyId: "property-1",
  questionText: "Is parking included?",
  answerText: "Yes, one spot is included.",
  source: "operator",
});
ok(
  "buildQaUpsert applies normalized key",
  upsert?.question_key === "parking" &&
    upsert.property_id === "property-1" &&
    upsert.source === "operator",
);
same(
  "buildQaUpsert rejects empty answer",
  buildQaUpsert({
    organizationId: "org-1",
    propertyId: null,
    questionText: "Is parking included?",
    answerText: "",
  }),
  null,
);

const draftInput = {
  renterName: "Aaliyah Chen",
  orgName: "North Star Rentals",
  inquiryText: "Hi, is parking included? Could I come view it after work?",
  moveInDate: "2026-09-01",
  listing: {
    address: "12 Donwoods Dr",
    rentCents: 245000,
    beds: 2,
    baths: 1.5,
    parking: "1 surface spot",
    availableDate: "2026-09-01",
    laundry: "in_suite",
    petFriendly: true,
  },
};
const noKnowledge = buildAiReplyDraft(draftInput);
const emptyKnowledge = buildAiReplyDraft({ ...draftInput, knowledge: [] });
const withKnowledge = buildAiReplyDraft({
  ...draftInput,
  knowledge: [propertyParking],
});

same(
  "buildAiReplyDraft no-knowledge seam is byte-identical",
  emptyKnowledge.body,
  noKnowledge.body,
);
ok(
  "buildAiReplyDraft knowledge hit injects stored answer",
  withKnowledge.body.includes("Yes, one underground parking spot is included."),
);
ok(
  "buildAiReplyDraft knowledge hit replaces generic cue",
  !withKnowledge.body.includes("I noticed your parking question"),
);

if (failed > 0) {
  console.error(`\nproperty-qa: ${passed} passed, ${failed} failed`);
  process.exit(1);
}

console.log(`\nproperty-qa: ${passed} passed, 0 failed`);
