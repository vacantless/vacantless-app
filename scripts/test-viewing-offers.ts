// Unit tests for "Offer times to a renter" (S823c).
// Run: npx tsx scripts/test-viewing-offers.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAX_VIEWING_OFFER_SLOTS,
  OFFER_TIMES_MESSAGES,
  futureOfferSlots,
  normalizeOfferSlots,
  offerReplyText,
  offerStatusForReason,
  offerTimesTone,
} from "../lib/viewing-offers";

const now = new Date("2026-11-19T20:00:00Z");
const a = "2026-11-21T15:00:00.000Z";
const b = "2026-11-21T19:30:00.000Z";
const c = "2026-11-22T16:00:00.000Z";
const d = "2026-11-23T16:00:00.000Z";

// slots: future only, distinct, soonest first, three at most
assert.equal(MAX_VIEWING_OFFER_SLOTS, 3);
assert.deepEqual(normalizeOfferSlots([c, a, b], now), [a, b, c]);
assert.deepEqual(normalizeOfferSlots([a, a, new Date(a)], now), [a]);
assert.deepEqual(normalizeOfferSlots([d, c, b, a], now), [a, b, c]);
assert.deepEqual(normalizeOfferSlots(["2026-11-19T19:00:00Z", a], now), [a]);
assert.deepEqual(normalizeOfferSlots([null, "", "junk", undefined], now), []);
assert.deepEqual(normalizeOfferSlots([now], now), []);

assert.deepEqual(futureOfferSlots([a, b], now), [a, b]);
assert.deepEqual(futureOfferSlots([a, b], new Date(b)), []);
assert.deepEqual(futureOfferSlots([a, 5, null], now), [a]);
assert.deepEqual(futureOfferSlots("nope", now), []);

// the message to paste
const one = offerReplyText({
  renterName: "Dana Lee",
  address: "251 Manitoba St, Suite 124",
  whenLabels: ["Saturday, November 21 at 10:00 AM"],
  url: "https://app.vacantless.com/showing/offer/t",
});
assert.ok(one.startsWith("Hi Dana,"));
assert.ok(one.includes("I can show you 251 Manitoba St, Suite 124 on Saturday, November 21 at 10:00 AM."));
assert.ok(one.includes("Tap here to confirm it: https://app.vacantless.com/showing/offer/t"));
const many = offerReplyText({
  renterName: null,
  address: null,
  whenLabels: ["Sat 10:00 AM", "Sat 2:30 PM"],
  url: "https://x/y",
});
assert.ok(many.startsWith("Hi there,"));
assert.ok(many.includes("the rental at one of these times:"));
assert.ok(many.includes("  Sat 10:00 AM\n  Sat 2:30 PM"));
assert.ok(many.includes("It is booked right away: https://x/y"));
for (const text of [one, many, ...Object.values(OFFER_TIMES_MESSAGES)]) {
  assert.ok(!/[\u2013\u2014]/.test(text), "no dashes in renter or landlord copy");
}

// accept reasons
assert.equal(offerStatusForReason("not_found"), "invalid");
assert.equal(offerStatusForReason("slot_not_proposed"), "invalid");
assert.equal(offerStatusForReason("taken"), "taken");
assert.equal(offerStatusForReason("past"), "past");
assert.equal(offerStatusForReason("not_pending"), "expired");
assert.equal(offerStatusForReason("listing_unavailable"), "expired");
assert.equal(offerStatusForReason(undefined), "error");

assert.equal(offerTimesTone("sent"), "good");
assert.equal(offerTimesTone("saved"), "good");
assert.equal(offerTimesTone("send_failed"), "warn");
assert.equal(offerTimesTone("past"), "warn");

// the migration keeps its promises
const sql = readFileSync("supabase/migrations/0312_viewing_offers.sql", "utf8");
assert.ok(sql.includes("to service_role"), "rule 431: service_role grant in the same file");
assert.ok(sql.includes("to authenticated"));
assert.ok(sql.includes("enable row level security"));
assert.ok(sql.includes("when unique_violation"), "a taken time is reported, not thrown");
assert.ok(sql.includes("status = 'available'"), "a rented rental cannot be booked");
assert.ok(!/booking_lead_hours|availability_rules/.test(sql), "offered times skip the viewing windows on purpose");

// the public page shows offered times only, never a calendar
const page = readFileSync("app/showing/offer/[token]/page.tsx", "utf8");
assert.ok(!page.includes("/r/"), "no link to the open calendar from an offer");
assert.ok(page.includes("acceptOfferedTime"));

console.log("ok test-viewing-offers");
