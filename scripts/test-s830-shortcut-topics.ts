// S830a/b: Send to Vacantless on Noam's real Marketplace chats (REVIEW-S830).
// Run: npx tsx scripts/test-s830-shortcut-topics.ts
import assert from "node:assert/strict";
import { answerKeyForQuestion, answerKeyForTopic, answerKeysForTopic, planSend, rentedForReader, sendResultLine, shortcutReply } from "../lib/send-shortcut";
import { buildReplyKitCards } from "../lib/reply-kit";
import { buildScreenshotPrompt } from "../lib/ai-screenshot-lead";
import { normalizeEnquiryRead } from "../lib/ai-enquiry";

let n = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  n++;
};

// The word rules, on what renters actually wrote (fallback when the reader names no topic).
const k = answerKeyForQuestion;
ok(k("Hello, when are you available for viewing?") === "viewing", "Theophilus: a viewing, not a move-in date");
ok(k("21 november at 7 pm") === "viewing", "Mandeep: a time is a viewing");
ok(k("Can I see it today") === "viewing", "Asadullah");
ok(k("can i get a virtual tour if possible?") === "viewing", "Ru");
ok(k("I just submited the request") === "applied", "Shnya, misspelt");
ok(k("I've already submitted from the link.") === "applied", "Allyson");
ok(k("I set up a viewing. Thank you") === "applied", "Crystal: booked is applied, not a viewing ask");
ok(k("Hello, would you consider $1200 all inclusive?") === "rent", "Kelsey: an offer, not utilities");
ok(k("Hello would you be open to all inclusive I work for the city my client max to pay is 1100") === "rent", "Lamar");
ok(k("Is hydro included?") === "utilities", "a real utilities question stays");
ok(k("Is this still available? For Dec 1st move-in") === "move_in", "Greeshma");
ok(k("Is this still available?") === null, "availability is the first reply");

// The reader's topic wins over the words.
ok(answerKeyForTopic("viewing") === "viewing" && answerKeyForTopic("Move-in") === "move_in", "topics map to keys");
ok(answerKeyForTopic("available") === "first", "available = first reply");
ok(answerKeyForTopic("lease") === "none" && answerKeyForTopic("other") === "none", "lease and other have no answer");
ok(answerKeyForTopic("weather") === null && answerKeyForTopic(null) === null, "unknown topic falls back to the words");

const APP = "https://app.vacantless.com";
const cards = buildReplyKitCards({
  appUrl: APP,
  properties: [{ id: "a9", address: "1551 Assumption St, Unit 9, Windsor, ON", rent_cents: 109500, beds: 1, baths: 1, status: "available", archived_at: null }],
  posts: [{ id: "fb9", property_id: "a9", portal: "facebook", status: "live" }],
  timesByProperty: new Map([["a9", { hasViewingTimes: false, nextTimes: null }]]),
  featuresByProperty: new Map([["a9", { pets_cats: false, pets_dogs: false, heat_included: true, hydro_included: false }]]),
});
const card = cards[0];
const send = (question: string, topic: string | null) =>
  shortcutReply({ card, site: "Facebook Marketplace", question, topic, phone: null, renterName: "Victor" });

const viewing = send("Hello, when are you available for viewing?", "viewing");
ok(viewing.why === "ok" && !!viewing.text && viewing.text.includes("showing agent will get back to you") && viewing.text.includes("fb9"), "viewing: Noam's words and the Marketplace link");
ok(!/move in|available from/i.test(viewing.text ?? ""), "viewing never gives the move-in date");
const applied = send("I just submited the request", "applied");
ok(applied.text === "Hi Victor, thanks, we got it. Please allow some time for the showing agent to get back to you.", "applied: no link sent again");
const rent = send("would you consider $1200 all inclusive?", "rent");
ok(!!rent.text && rent.text.includes("questions about the rent") && !/hydro/.test(rent.text), "rent: the showing agent, not the utilities answer");
const noPets = send("No pets, children, parties, smoking", "available");
ok(!!noPets.text && !/pets are not allowed/.test(noPets.text), "Steven: saying no pets gets the first reply");
const lease = send("Would a 6 month lease work for you?", "lease");
ok(lease.text === null && lease.why === "no_answer", "Jaider: lease length has no answer, nothing copied");
const fallback = send("Do you allow dogs?", null);
ok(!!fallback.text && /pets are not allowed/.test(fallback.text), "no topic: the word rules still answer");
ok(card.answers.map((a) => a.label).join(",") === "Viewing time,Sent the form,Pets,Utilities,Rent offer", "Quick replies chips");

// S830b: agents and promoters are never saved.
ok(planSend({ name: "Prabhas", email: null, phone: null, rentalId: "a9", notRenter: true }).kind === "not_renter", "Prabhas is not saved");
ok(planSend({ name: "Lui", email: null, phone: null, rentalId: "a9", notRenter: false }).kind === "chat_name", "an agent for a renter client is saved");
ok(/No one was added/.test(sendResultLine({ outcome: "not_renter" })), "not a renter line");
ok(!/[—–]/.test(sendResultLine({ outcome: "not_renter" })), "no dashes");

// The reader is asked for both, and its answers come through.
const prompt = buildScreenshotPrompt([{ id: "a9", address: "1551 Assumption St, Unit 9", rentDollars: 1095, beds: 1 }]);
ok(prompt.includes('"topic"') && prompt.includes('"not_renter"') && prompt.includes("same price"), "prompt asks for topic and not_renter");
const read = normalizeEnquiryRead({ is_enquiry: true, name: "Joe", topic: "Other", not_renter: true }, []);
ok(read?.topic === "other" && read?.notRenter === true, "topic and not_renter are read");
ok(normalizeEnquiryRead({ is_enquiry: true, name: "Ann" }, [])?.notRenter === false, "missing not_renter is false");

console.log(`s830 shortcut topics: ${n} passed, 0 failed`);

// S830e: rented units, never the rented twin of an open price.
{
  const open = [{ id: "p3", address: "833 Pillette Rd, Unit 3", rentDollars: 1250, beds: 1 }];
  const rented = [
    { id: "b303", address: "1195 Bruce Ave, Unit 303", rentDollars: 1250, beds: 1 },
    { id: "p20", address: "833 Pillette Rd, Unit 20", rentDollars: 1195, beds: 1 },
  ];
  const seen = rentedForReader(open, rented);
  if (seen.length !== 1 || seen[0].id !== "p20" || !seen[0].address.endsWith(", rented now")) throw new Error("rented list wrong");
  if (!/is rented, so no renter was added/.test(sendResultLine({ outcome: "rented", rental: "833 Pillette Rd, Unit 20" }))) throw new Error("rented line");
  if (!/is not available/.test(sendResultLine({ outcome: "not_available" }))) throw new Error("draft line unchanged");
  console.log("ok   S830e rented units");
}
// S830f: two answers in one reply; same first name hint.
{
  if (JSON.stringify(answerKeysForTopic("pets, move_in")) !== '["pets","move_in"]') throw new Error("two topics");
  const both = shortcutReply({ card, site: "Facebook Marketplace", question: "1 cat, move in dec 1st", topic: "pets, utilities", phone: null, renterName: "Koby" });
  if (!both.text || !/pets are not allowed/.test(both.text) || !/Heat is included/.test(both.text)) throw new Error(`two answers: ${both.text}`);
  const oneMissing = shortcutReply({ card, site: "Facebook Marketplace", question: "", topic: "pets, parking", phone: null, renterName: "Koby" });
  if (!oneMissing.text || !/pets are not allowed/.test(oneMissing.text)) throw new Error("one missing falls back to the first");
  const hint = sendResultLine({ outcome: "exists", name: "Brittany", rental: "Unit 9", firstNameOnly: true });
  if (!/If this is someone new, add them on Renters\./.test(hint)) throw new Error("first name hint");
  if (/someone new/.test(sendResultLine({ outcome: "exists", name: "Brittany Cunningham", rental: "Unit 9" }))) throw new Error("no hint on a full name");
  console.log("ok   S830f two answers and first-name hint");
}
