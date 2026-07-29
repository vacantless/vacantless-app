// Unit tests for the dark AI reply draft helper.
// Run: npx tsx scripts/test-ai-reply.ts
import {
  aiReplyEnabled,
  buildAiReplyDraft,
} from "../lib/ai-reply";

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

ok("flag: true enables", aiReplyEnabled("true") === true);
ok("flag: 1 enables", aiReplyEnabled("1") === true);
ok("flag: yes enables", aiReplyEnabled("YES") === true);
ok("flag: false disables", aiReplyEnabled("false") === false);
ok("flag: blank disables", aiReplyEnabled("") === false);

const draft = buildAiReplyDraft({
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
});

ok("draft: subject names listing", draft.subject === "Re: your inquiry about 12 Donwoods Dr");
ok("draft: greets first name", draft.body.includes("Hi Aaliyah,"));
ok("draft: includes rent", draft.body.includes("$2,450/month"));
ok("draft: includes beds and baths", draft.body.includes("2 beds, 1.5 baths"));
ok("draft: includes listing fact only when supplied", draft.body.includes("parking: 1 surface spot"));
ok("draft: includes inquiry cue", draft.body.includes("I noticed your parking question"));
ok("draft: includes move-in", draft.body.includes("desired move-in date: 2026-09-01"));
ok("draft: includes slot offer", draft.slotOffer.includes("viewing slot"));
ok("draft: signs org name", draft.body.endsWith("Thanks,\nNorth Star Rentals"));

const fallback = buildAiReplyDraft({
  renterName: null,
  orgName: "",
  inquiryText: null,
  listing: null,
});

ok("fallback: greets there", fallback.body.includes("Hi there,"));
ok("fallback: rental fallback", fallback.subject === "Re: your inquiry about the rental");
ok("fallback: no fabricated facts", !fallback.body.includes("parking:"));
ok("fallback: default signer", fallback.body.endsWith("Thanks,\nVacantless"));

const noSuitable = buildAiReplyDraft({
  renterName: "Sam",
  orgName: "North Star Rentals",
  inquiryText: "None of the listed times work.",
  noSuitableTime: true,
  listing: { address: "88 King St", rentCents: null, beds: null, baths: null },
});

ok("no suitable time: offers another slot", noSuitable.slotOffer.startsWith("I can offer another viewing slot."));

if (failed > 0) {
  console.error(`\nai-reply: ${passed} passed, ${failed} failed`);
  process.exit(1);
}

console.log(`\nai-reply: ${passed} passed, 0 failed`);
