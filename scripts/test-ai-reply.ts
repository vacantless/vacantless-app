// Unit tests for the dark AI reply draft helper.
// Run: npx tsx scripts/test-ai-reply.ts
import {
  aiReplyEnabled,
  buildAiReplyDraft,
  suggestedCaptureQuestion,
  preferredWindow,
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

ok(
  "capture question: parking maps to canonical question",
  suggestedCaptureQuestion("Is there a garage spot?") ===
    "Is parking available?",
);
ok(
  "capture question: laundry maps to canonical question",
  suggestedCaptureQuestion("Does it have a washer and dryer?") ===
    "Is laundry available?",
);
ok(
  "capture question: pets maps to canonical question",
  suggestedCaptureQuestion("Can I bring my dog?") ===
    "What is the pet policy?",
);
ok(
  "capture question: utilities maps to canonical question",
  suggestedCaptureQuestion("Are heat, hydro, and water included?") ===
    "Which utilities are included?",
);
ok(
  "capture question: application maps to canonical question",
  suggestedCaptureQuestion("How do I apply?") === "How do I apply?",
);
ok(
  "capture question: viewing-only is not reusable",
  suggestedCaptureQuestion("Can I book a showing tomorrow?") === null,
);
ok(
  "capture question: unknown is null",
  suggestedCaptureQuestion("Hello, I am interested.") === null,
);

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
ok("draft: includes move-in as a friendly date (S724)", draft.body.includes("desired move-in date: Sep 1."));
{
  // S724: the booking link rides in every draft that has one.
  const withLink = buildAiReplyDraft({
    renterName: "James Park",
    orgName: "Lakeview Rentals",
    inquiryText: "Is this available? Could I see it on a weekend?",
    listing: { address: "100 Lakeview Ave", rentCents: 150000, beds: 1, baths: 1, availableDate: "2026-11-01" },
    bookingUrl: "https://app.vacantless.com/r/abc",
  });
  ok("S724 draft: booking link", withLink.body.includes("pick a time yourself here: https://app.vacantless.com/r/abc"));
  ok("S724 draft: available as Nov 1", withLink.body.includes("available Nov 1") && !withLink.body.includes("2026-11-01"));
  ok("S724 draft: no em dash", !withLink.body.includes("\u2014"));
}
ok("draft: includes slot offer", draft.slotOffer === "I will look for an evening viewing time for you.");
ok("draft: signs org name", draft.body.endsWith("Thanks,\nNorth Star Rentals"));
ok(
  "draft: suggests capture question",
  draft.suggestedQuestion === "Is parking available?",
);

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
ok("fallback: no capture question", fallback.suggestedQuestion === null);

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


// S726: the James Park demo enquiry.
{
  const d = buildAiReplyDraft({
    renterName: "James Park",
    orgName: "Lakeview Rentals",
    inquiryText: "Hi, is this still available? I work evenings, could I see it on a weekend?",
    noSuitableTime: true,
    listing: { address: "100 Lakeview Ave", rentCents: 150000, beds: 1, baths: 1, availableDate: "2026-11-01" },
    bookingUrl: "https://app.vacantless.com/r/x",
  });
  ok("S726: still available answers yes", d.body.includes("Yes, it is still available."));
  ok("S726: still available is not a move-in question", !d.body.includes("move-in window"));
  ok("S726: no generic read-your-note after a yes", !d.body.includes("I read your note"));
  ok("S726: named weekend is offered back", d.body.includes("I will look for a weekend time."));
  ok("S726: no three-way window question", !d.body.includes("weekday evening, weekend, or daytime"));
  ok("S726: date reads Nov 1", d.body.includes("available Nov 1"));
  ok("S726: closing does not re-ask the window", d.body.includes("Or reply here, and I will confirm the time.") && !d.body.includes("window that works best"));
}
ok("S726: work evenings is not an evening window", preferredWindow("I work evenings") === null);
ok("S726: after work is evening", preferredWindow("can I come after work?") === "evening");
ok("S726: saturday is weekend", preferredWindow("Saturday works") === "weekend");
ok("S726: no window", preferredWindow("Is parking included?") === null);
ok("S726: when available is still timing", buildAiReplyDraft({renterName:"A",orgName:"O",inquiryText:"When is it available to move in?",listing:null}).body.includes("move-in window"));
ok("S726: pets after still available keeps pet cue", buildAiReplyDraft({renterName:"A",orgName:"O",inquiryText:"Is this still available? Do you allow cats?",listing:null}).body.includes("Yes, it is still available. I noticed your pet question"));

console.log(`\nai-reply: ${passed} passed, 0 failed`);

// S727: cats-only must not read "pet friendly"
{
  const base = { renterName: "A", orgName: "O", inquiryText: "Hi", bookingUrl: null };
  const listing = { address: "1 X St", rentCents: 120000, beds: 1, baths: 1, petFriendly: true };
  const cats = buildAiReplyDraft({ ...base, listing: { ...listing, petsCats: true, petsDogs: false } }).body;
  ok("S727: cats only says cats welcome (no dogs)", cats.includes("cats welcome (no dogs)") && !cats.includes("pet friendly"));
  const both = buildAiReplyDraft({ ...base, listing: { ...listing, petsCats: true, petsDogs: true } }).body;
  ok("S727: both says cats and dogs welcome", both.includes("cats and dogs welcome"));
  const unset = buildAiReplyDraft({ ...base, listing }).body;
  ok("S727: kind unset keeps pet friendly", unset.includes("pet friendly"));
}
