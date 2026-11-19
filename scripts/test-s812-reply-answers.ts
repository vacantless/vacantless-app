// S812: answers on Quick replies. Run: npx tsx scripts/test-s812-reply-answers.ts
import { answerReplyText, buildReplyAnswers } from "../lib/reply-answers";
import { buildReplyKitCards, replyKitText } from "../lib/reply-kit";

let pass = 0;
let fail = 0;
function eq(got: unknown, want: unknown, msg: string) {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else {
    fail++;
    console.error(`FAIL: ${msg} - got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}
const NOW = new Date("2026-11-17T12:00:00Z");
const text = (f: Parameters<typeof buildReplyAnswers>[0], key: string) => buildReplyAnswers(f, NOW).find((a) => a.key === key)?.text ?? null;

// Nothing on file: nothing to paste (the no-fake rule).
eq(buildReplyAnswers({}, NOW), [], "an empty record gives no answers");
eq(buildReplyAnswers(null, NOW), [], "no record gives no answers");
eq(buildReplyAnswers({ air_conditioning: false, pets_cats: null, pets_dogs: false }, NOW), [], "a default 'no' box and a half-answered pets line are not answers");

// Pets.
eq(text({ pets_cats: false, pets_dogs: false }, "pets"), "Sorry, pets are not allowed in this rental.", "no pets");
eq(text({ pets_cats: true, pets_dogs: true }, "pets"), "Yes, cats and dogs are welcome.", "cats and dogs");
eq(text({ pets_cats: true, pets_dogs: true, pets_dog_size: "small" }, "pets"), "Yes, cats and dogs are welcome. Small dogs only.", "small dogs");
eq(text({ pets_cats: true, pets_dogs: false, pets_notes: "One cat at most" }, "pets"), "Cats are welcome. Sorry, no dogs. One cat at most.", "cats only, with the landlord's note");
eq(text({ pets_cats: false, pets_dogs: true, pets_dog_size: "medium" }, "pets"), "Dogs are welcome. Small or medium dogs only. Sorry, no cats.", "dogs only");
eq(text({ pets_cats: false, pets_dogs: false, pets_notes: "Cats ok" }, "pets"), "Sorry, pets are not allowed in this rental.", "a note never contradicts a no");

// Utilities: only what the record says.
eq(text({ heat_included: true, hydro_included: false, water_included: true }, "utilities"), "Heat and water are included in the rent. You pay hydro.", "Pillette: heat and water in, hydro out");
eq(text({ heat_included: true, hydro_included: false, water_included: null }, "utilities"), "Heat is included in the rent. You pay hydro.", "an unanswered water line is left out");
eq(text({ heat_included: false, hydro_included: false, water_included: false }, "utilities"), "You pay heat, hydro and water.", "nothing included");
eq(text({ heat_included: true, hydro_included: true, water_included: true, internet_included: true }, "utilities"), "Heat, hydro, water and internet are included in the rent.", "all in");
eq(text({ internet_included: true }, "utilities"), null, "internet alone does not answer the utilities question");

// Parking.
eq(text({ parking_type: "none" }, "parking"), "Sorry, there is no parking with this rental.", "no parking");
eq(text({ parking_type: "underground", parking_count: 1 }, "parking"), "There is 1 underground parking space.", "one counted space");
eq(text({ parking_type: "outdoor", parking_count: 2, parking_fee_cents: 5000 }, "parking"), "There are 2 outdoor parking spaces for $50 a month.", "two spaces with a fee");
eq(text({ parking_type: "outdoor", parking_count: 1, parking_fee_cents: 0 }, "parking"), "There is 1 outdoor parking space, included in the rent.", "a zero fee reads included");
eq(text({ parking_type: "street" }, "parking"), "There is street parking.", "street parking, no count");
eq(text({ parking: "1 carport spot included." }, "parking"), "Parking: 1 carport spot included.", "the landlord's own words when no kind is set");
eq(text({}, "parking"), null, "no parking facts, no parking answer");

// Laundry, move-in, appliances, air conditioning.
eq(text({ laundry: "in_building" }, "laundry"), "There is laundry in the building.", "laundry in building");
eq(text({ laundry: "none" }, "laundry"), "Sorry, there is no laundry on site.", "no laundry");
eq(text({ available_date: "2026-11-09" }, "move_in"), "It is available now.", "a past date is now");
eq(text({ available_date: "2026-12-15" }, "move_in"), "It is available from Dec 15.", "a coming date");
eq(text({ appliances: ["fridge", "stove"] }, "appliances"), "It comes with these appliances: fridge and stove.", "building default appliances");
eq(text({ ac_type: "none" }, "ac"), "It does not come with air conditioning.", "no air conditioning, answered");
eq(text({ ac_type: "central" }, "ac"), "Yes, it has central air.", "central air");
eq(text({ ac_type: "window" }, "ac"), "Yes, it has a window air conditioner.", "window unit");
// S822: the landlord's own A/C note follows the answer; a note alone is not an answer.
eq(
  text({ ac_type: "none", ac_notes: "Bring a portable unit sized for the wall sleeve" }, "ac"),
  "It does not come with air conditioning. Bring a portable unit sized for the wall sleeve.",
  "an A/C note follows the answer",
);
eq(text({ ac_notes: "Bring your own" }, "ac"), null, "a note without an A/C answer gives no answer");
eq(text({ ac_type: "none", ac_notes: "x".repeat(200) }, "ac"), "It does not come with air conditioning.", "an over-long note is left out");

// Order and labels.
eq(
  buildReplyAnswers({ ac_type: "window", laundry: "shared", pets_cats: true, pets_dogs: true, available_date: "2026-12-01" }, NOW).map((a) => a.label),
  ["Pets", "Laundry", "Move-in date", "Air conditioning"],
  "answers come in the order renters ask",
);

// The whole reply.
const pets = buildReplyAnswers({ pets_cats: false, pets_dogs: false }, NOW)[0];
eq(
  answerReplyText({ answer: pets, bookingUrl: "https://x/r/p3?p=fb3", hasViewingTimes: true, renterName: "Tess Smith" }),
  "Hi Tess, thanks for asking. Sorry, pets are not allowed in this rental. If that works for you, you can pick a viewing time here: https://x/r/p3?p=fb3",
  "first name, the answer, the booking link",
);
eq(
  answerReplyText({ answer: pets, bookingUrl: "https://x/r/p3", hasViewingTimes: false, renterName: "" }),
  'Hi, thanks for asking. Sorry, pets are not allowed in this rental. If that works for you, open the link and tap "Request a viewing": https://x/r/p3',
  "no name and no viewing times",
);

// Through the kit: cards carry answers; rented cards carry none; an unknown key falls back.
const APP = "https://app.vacantless.com";
const cards = buildReplyKitCards({
  appUrl: APP,
  properties: [
    { id: "p3", address: "833 Pillette Rd, Unit 3, Windsor, ON", rent_cents: 125000, beds: 1, baths: 1, status: "available", archived_at: null },
    { id: "p303", address: "Bruce 303", rent_cents: 150000, beds: 2, baths: 1, status: "leased", archived_at: null },
  ],
  posts: [
    { id: "fb3", property_id: "p3", portal: "facebook", status: "live" },
    { id: "fb303", property_id: "p303", portal: "facebook", status: "live" },
  ],
  timesByProperty: new Map([["p3", { hasViewingTimes: true, nextTimes: null }]]),
  featuresByProperty: new Map([
    ["p3", { heat_included: true, hydro_included: false, water_included: true }],
    ["p303", { pets_cats: true, pets_dogs: true }],
  ]),
  now: NOW,
});
const c3 = cards.find((c) => c.propertyId === "p3")!;
const c303 = cards.find((c) => c.propertyId === "p303")!;
eq(c3.answers.map((a) => a.key), ["utilities"], "the card carries the answers on file");
eq(c303.answers, [], "a rented rental offers no answers");
eq(
  replyKitText({ card: c3, site: c3.sites[0], phone: "519-555-0100", renterName: "Sam", answerKey: "utilities" }),
  `Hi Sam, thanks for asking. Heat and water are included in the rent. You pay hydro. If that works for you, you can pick a viewing time here: ${APP}/r/p3?p=fb3`,
  "the kit writes the answer with the site's own link",
);
eq(
  replyKitText({ card: c3, site: c3.sites[0], phone: null, renterName: "Sam", answerKey: "pets" }),
  replyKitText({ card: c3, site: c3.sites[0], phone: null, renterName: "Sam" }),
  "an answer the record cannot give falls back to the available reply",
);
eq(
  replyKitText({ card: c303, site: c303.sites[0], phone: null, renterName: "Sam", answerKey: "pets" }),
  "Hi Sam, thanks for asking. Bruce 303 is rented now.",
  "a rented rental always says rented",
);

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
