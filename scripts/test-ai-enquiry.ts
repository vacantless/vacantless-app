// Run with: npx tsx scripts/test-ai-enquiry.ts
// S702: the AI enquiry reader and AI renter answer (pure parts + wiring).
import { readFileSync } from "node:fs";
import {
  buildEnquiryPrompt,
  isFileableEnquiry,
  listingFacts,
  looksLikeEnquiryText,
  normalizeEnquiryRead,
  usableAnswer,
  worthAnswering,
} from "../lib/ai-enquiry";
import { firstJsonObject } from "../lib/ai-call";
import { ORGS_THAT_ANSWER_THEMSELVES } from "../lib/ai-enquiry-ingest";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}

const rentals = [
  { id: "p1", address: "833 Pillette Rd, Unit 33", rentDollars: 1225, beds: 1 },
  { id: "p2", address: "1195 Bruce Ave, Unit 303", rentDollars: 1250, beds: 1 },
];

// Routing filter
ok("enquiry text detected", looksLikeEnquiryText("Re: 1 bedroom apartment", "Hi, is the unit still available? I'd like a viewing."));
ok("receipt not detected", !looksLikeEnquiryText("Your Home Depot receipt", "Thank you for shopping. Total $43.10"));

// Prompt carries the rental list and ids
const prompt = buildEnquiryPrompt({ subject: "Bruce apt", from: "a@b.com", replyTo: null, body: "Is it available?" }, rentals);
ok("prompt lists ids", prompt.includes("id p1") && prompt.includes("id p2"));
ok("prompt shows rent with comma", prompt.includes("$1,225/month"));

// Normalizer
const good = normalizeEnquiryRead(
  firstJsonObject('Sure: {"is_enquiry": true, "confidence": 0.92, "name": "Sam Lee", "email": "SAM@Example.com", "phone": "519-555-0101", "question": "Is parking included?", "rental_id": "p2", "site": "Craigslist"}'),
  rentals,
);
ok("reads name", good?.name === "Sam Lee");
ok("lowercases email", good?.email === "sam@example.com");
ok("keeps valid rental id", good?.rentalId === "p2");
ok("fileable", isFileableEnquiry(good));
const fake = normalizeEnquiryRead({ is_enquiry: true, confidence: 0.9, email: "x@y.com", rental_id: "not-ours" }, rentals);
ok("drops a rental id not in the list", fake?.rentalId === null);
const noreply = normalizeEnquiryRead({ is_enquiry: true, confidence: 0.9, email: "no-reply@rentals.ca" }, rentals);
ok("drops no-reply email", noreply?.email === null && !isFileableEnquiry(noreply));
const own = normalizeEnquiryRead({ is_enquiry: true, confidence: 0.9, email: "landlord@agile.ca" }, rentals, ["landlord@agile.ca"]);
ok("drops the landlord's own address", own?.email === null);
const shortPhone = normalizeEnquiryRead({ is_enquiry: true, confidence: 0.9, phone: "555-0101" }, rentals);
ok("drops a too-short phone", shortPhone?.phone === null);
ok("low confidence not fileable", !isFileableEnquiry(normalizeEnquiryRead({ is_enquiry: true, confidence: 0.6, email: "a@b.com" }, rentals)));
ok("untrusted bar is higher", !isFileableEnquiry(normalizeEnquiryRead({ is_enquiry: true, confidence: 0.75, email: "a@b.com" }, rentals), 0.8));
ok("not an enquiry", !isFileableEnquiry(normalizeEnquiryRead({ is_enquiry: false, confidence: 0.99, email: "a@b.com" }, rentals)));
ok("garbage reply", normalizeEnquiryRead(firstJsonObject("I cannot help"), rentals) === null);

// Answers
ok("availability-only is not answered", !worthAnswering("Is this still available?"));
ok("real question is answered", worthAnswering("Are cats allowed in the unit?"));
ok("NO_ANSWER dropped", usableAnswer("NO_ANSWER") === null);
ok("links dropped", usableAnswer("See https://x.com") === null);
ok("em dash replaced", !(usableAnswer("Yes — cats are fine.") ?? "").includes("—"));
const facts = listingFacts({ address: "1 Main", rent_cents: 125000, pet_policy_set: false, pets_cats: false, parking: "1 spot" });
ok("facts show rent with comma", facts.includes("$1,250"));
ok("unset pet policy is not stated", !facts.includes("Cats allowed"));
ok("facts include parking", facts.includes("Parking: 1 spot"));

// Wiring
ok("Agile answers renters itself", ORGS_THAT_ANSWER_THEMSELVES.includes("921f7c08-98af-428f-a238-36f4a781b0de"));
const ingest = readFileSync("lib/portal-lead-ingest-server.ts", "utf8");
ok("unknown sender goes to the AI first", ingest.indexOf("tryAiEnquiry(true)") < ingest.indexOf('handled: "sender_not_allowed"'));
ok("unparsed goes to the AI first", ingest.indexOf("tryAiEnquiry(false)") < ingest.indexOf('handled: "not_parsed"'));
ok("site leads get the instant reply", ingest.includes("autoReplyIngestedLead(admin"));
const dispatch = readFileSync("lib/inbound-postmark-dispatch.ts", "utf8");
ok("enquiry-like mail routes to the lead path", dispatch.includes("looksLikeEnquiryText("));
const r = readFileSync("app/r/[propertyId]/actions.ts", "utf8");
ok("website reply answers the question", r.includes("answerRenterQuestion(admin, propertyId, notes)"));

console.log(`\nai-enquiry: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
