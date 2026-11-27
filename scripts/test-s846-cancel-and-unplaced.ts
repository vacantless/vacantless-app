// S846: team Cancel viewing (KI1823) and the unplaced chat renter (Tammy).
// Run: npx tsx scripts/test-s846-cancel-and-unplaced.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  actorLabel,
  canTeamCancel,
  isTeamCancelReason,
  operatorReleaseNote,
  teamCancelNote,
  teamCancelReasonLabel,
} from "../lib/showing-cancel";
import { cancelledByTeamHtml, cancelledByTeamSubject } from "../lib/email";
import { findUnplacedChatLead, type ChatLeadCandidate } from "../lib/chat-leads";
import { getNotificationEvent } from "../lib/notifications";
import { CATALOG_MESSAGES } from "../lib/message-catalog";

const now = Date.parse("2026-11-26T23:00:00Z");
const day = 24 * 60 * 60_000;

// reasons
assert.ok(isTeamCancelReason("unit_rented"));
assert.ok(isTeamCancelReason("other"));
assert.ok(!isTeamCancelReason("unconfirmed"));
assert.ok(!isTeamCancelReason(null));
assert.equal(teamCancelReasonLabel("unit_rented"), "the unit is rented");

// who
assert.equal(actorLabel({ email: "a@x.ca", user_metadata: { full_name: "Aaliyah K" } }), "Aaliyah K");
assert.equal(actorLabel({ email: "a@x.ca", user_metadata: {} }), "a@x.ca");
assert.equal(actorLabel(null), "a team member");

// notes never say unconfirmed for a team cancel; they name who
const note = teamCancelNote({ reason: "unit_rented", actor: "Aaliyah K", whenLabel: "Fri, Nov 27, 3:00 PM" });
assert.match(note, /cancelled by Aaliyah K because the unit is rented/);
assert.doesNotMatch(note, /unconfirmed/i);
assert.match(operatorReleaseNote("noam@x.ca"), /released by noam@x\.ca because it was still unconfirmed/);

// only open, future viewings; confirmed is fine
assert.ok(canTeamCancel({ outcome: "scheduled", scheduled_at: new Date(now + day).toISOString() }, now));
assert.ok(canTeamCancel({ outcome: null, scheduled_at: new Date(now + day).toISOString() }, now));
assert.ok(!canTeamCancel({ outcome: "cancelled", scheduled_at: new Date(now + day).toISOString() }, now));
assert.ok(!canTeamCancel({ outcome: "scheduled", scheduled_at: new Date(now - 1).toISOString() }, now));
assert.ok(!canTeamCancel({ outcome: "scheduled", scheduled_at: null }, now));

// renter email: rented wording, no "unconfirmed", no book-again button
const base = {
  renter_name: "Allyson Shuba",
  renter_email: "a@b.ca",
  org_name: "Agile",
  brand_color: null,
  logo_url: null,
  reply_to_email: null,
  property_address: "123 Main St Unit 9",
  when_label: "Fri, Nov 27, 3:00 PM",
  renter_url: "https://app.vacantless.com/r/p1",
};
const rented = cancelledByTeamHtml({ ...base, reason: "unit_rented" });
assert.match(rented, /This home has been rented/);
assert.doesNotMatch(rented, /unconfirmed|not been confirmed/i);
assert.doesNotMatch(rented, /Book another time/);
assert.doesNotMatch(rented, /\u2014/);
const other = cancelledByTeamHtml({ ...base, reason: "other" });
assert.match(other, /We had to cancel your viewing/);
assert.match(other, /Book another time/);
assert.equal(cancelledByTeamSubject(base), "Your viewing at 123 Main St Unit 9 is cancelled");

// agent alert is registered and active; renter email is in the catalog
const ev = getNotificationEvent("leasing.showing_cancelled_by_team");
assert.ok(ev && ev.active);
assert.doesNotMatch(ev!.defaultBody, /unconfirmed/i);
assert.ok(CATALOG_MESSAGES.some((m) => m.code.send?.includes("sendShowingCancelledByTeam")));

// UI wires both reasons
const ui = readFileSync("app/dashboard/showings/cancel-control.tsx", "utf8");
assert.match(ui, /value="unit_rented"/);
assert.match(ui, /value="other"/);
assert.match(readFileSync("app/dashboard/showings/page.tsx", "utf8"), /<CancelControl showingId=\{s\.id\} \/>/);

// unplaced chat renter
const c = (o: Partial<ChatLeadCandidate>): ChatLeadCandidate =>
  ({ id: "x", propertyId: null, name: "Tammy", email: null, phone: null, status: "replied", notes: null, createdAt: new Date(now - day).toISOString(), ...o }) as ChatLeadCandidate;
assert.equal(findUnplacedChatLead([c({ id: "t1" })], { name: "Tammy", now })?.id, "t1");
assert.equal(findUnplacedChatLead([c({ id: "t1" }), c({ id: "t2" })], { name: "Tammy", now }), null, "two Tammys: never guess");
assert.equal(findUnplacedChatLead([c({ id: "t1", propertyId: "p9" })], { name: "Tammy", now }), null);
assert.equal(findUnplacedChatLead([c({ id: "t1", createdAt: new Date(now - 20 * day).toISOString() })], { name: "Tammy", now }), null);
assert.equal(findUnplacedChatLead([c({ id: "t1", status: "lost" })], { name: "Tammy", now }), null);

// the rented path passes allowRented; leased is accepted only with it
const srv = readFileSync("lib/chat-leads-server.ts", "utf8");
assert.match(srv, /input\.allowRented === true && p\?\.status === "leased"/);
assert.match(readFileSync("lib/send-shortcut-server.ts", "utf8"), /allowRented: Boolean\(rentedHit\)/);

console.log("test-s846-cancel-and-unplaced: all passed");
