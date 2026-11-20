// Unit tests for reading Realtor.ca enquiry emails (S823d). The layout below is
// the one read off a real 2026-11 message; the people in it are made up.
// Run: npx tsx scripts/test-realtor-ca-lead.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PORTAL_LEAD_SENDERS,
  REALTOR_CA_LEAD_SENDER,
  addressMatchesZumperProperty,
  classifyPortalLeadEmail,
  parsePortalLeadEmail,
  parseRealtorCaAddress,
  portalLeadNote,
  portalSiteName,
  realtorCaSubjectParts,
} from "../lib/portal-lead-email";
import {
  PORTAL_REGISTRY,
  isKnownPortalSender,
  isTrustedPortalSender,
  portalKeyForSender,
} from "../lib/portal-senders";
import { PORTAL_INBOX_LABEL, PORTAL_INBOX_ORDER, portalIngestEnabled, portalInboxSites } from "../lib/portal-inbox";

const SUBJECT =
  "Showing request for 124 - 251 MANITOBA STREET, Toronto (Mimico), Ontario M8Y0C7, #W14120476";
const ADDR = "124 - 251 MANITOBA STREET, Toronto (Mimico), Ontario M8Y0C7";

function html(opts: { phone?: string | null; mailto?: string } = {}): string {
  const phone = opts.phone === undefined ? "(416) 555-0142" : opts.phone;
  return `<html><body><table>
<tr><td><h1>EMAIL A REALTOR&reg; FROM LISTING</h1><p>A potential client is interested in your listing.</p></td></tr>
<tr><td><p>PAT AGENT,</p></td></tr>
<tr><td><p><b>Dana Whitfield</b> would like <b>to book a showing</b> at <b>${ADDR}</b>.</p></td></tr>
<tr><td><p>This inquiry is brought to you as a benefit of your CREA membership through REALTOR.ca.</p></td></tr>
<tr><td><p>Book a Showing:</p><p>Preferred Date/Times for showing: Any Date - Any Time</p></td></tr>
<tr><td><p>Message from Dana Whitfield:</p><p>I would appreciate more information about ${ADDR}.</p></td></tr>
<tr><td><p>More about Dana Whitfield:</p><p>Viewed this listing 1 time(s)</p><p>Plans to: Rent a home</p></td></tr>
<tr><td><p>Contact Information:</p><p>Dana would prefer to be contacted by email.</p>
<p><a href="mailto:${opts.mailto ?? "dana.w@example.com"}">Contact via Email</a></p>
${phone ? `<p><a href="tel:${phone}">${phone}</a></p>` : ""}</td></tr>
<tr><td><p>How was this lead?</p><p>Rate this lead on a scale 1-5</p><p><a href="tel:18005550100">1-800-555-0100</a></p></td></tr>
</table></body></html>`;
}

const base = {
  subject: SUBJECT,
  from: "REALTOR.ca <noreply@leads.realtor.ca>",
  replyTo: "Dana Whitfield <Dana.W@example.com>",
  htmlBody: html(),
  textBody: null,
  headers: {},
};

// sender and registry, as read off the real message
assert.equal(REALTOR_CA_LEAD_SENDER, "noreply@leads.realtor.ca");
assert.ok(PORTAL_LEAD_SENDERS.includes(REALTOR_CA_LEAD_SENDER));
assert.deepEqual(PORTAL_REGISTRY.realtor_ca.addresses, ["noreply@leads.realtor.ca"]);
assert.equal(portalKeyForSender(base.from), "realtor_ca");
assert.ok(isKnownPortalSender(base.from));
const REAL_AUTH = {
  "Authentication-Results":
    "mx.google.com; dkim=pass header.i=@leads.realtor.ca header.s=s1 header.b=abc; spf=pass (google.com: domain of bounces@em2630.leads.realtor.ca designates 1.2.3.4 as permitted sender) smtp.mailfrom=\"bounces@em2630.leads.realtor.ca\"; dmarc=pass (p=REJECT) header.from=leads.realtor.ca",
};
assert.ok(isTrustedPortalSender(base.from, REAL_AUTH), "the real auth shape is trusted");
assert.ok(
  !isTrustedPortalSender(base.from, {
    "Authentication-Results": "mx; dkim=pass header.d=evil.example; spf=pass smtp.mailfrom=x@evil.example; dmarc=fail header.from=leads.realtor.ca",
  }),
  "a spoofed From with someone else's signature is not trusted",
);
assert.ok(!isTrustedPortalSender(base.from, {}), "no verdict, no trust");

// the cards for ordinary landlords do not ask for Realtor.ca
assert.equal(PORTAL_INBOX_LABEL.realtor_ca, "Realtor.ca");
assert.ok(!PORTAL_INBOX_ORDER.includes("realtor_ca"));
assert.ok(!portalInboxSites({}).some((s) => s.key === "realtor_ca"));
assert.equal(portalIngestEnabled("realtor_ca", {}), true);
assert.equal(portalIngestEnabled("realtor_ca", { REALTOR_CA_LEAD_INGEST_ENABLED: "false" }), false);

// subject
assert.deepEqual(realtorCaSubjectParts(SUBJECT), { address: ADDR, mls: "W14120476" });
assert.deepEqual(
  realtorCaSubjectParts("General inquiry for 18 SHORNCLIFFE AVENUE, Toronto (Casa Loma), Ontario M4V1T1, #C13144390"),
  { address: "18 SHORNCLIFFE AVENUE, Toronto (Casa Loma), Ontario M4V1T1", mls: "C13144390" },
);
assert.deepEqual(realtorCaSubjectParts("Hello"), { address: null, mls: null });

// address key, compared against our own addresses
const key = parseRealtorCaAddress(ADDR);
assert.deepEqual(key, { civic: "251", streetWord: "manitoba", unit: "124" });
assert.ok(addressMatchesZumperProperty("251 Manitoba St, Suite 124", key!));
assert.ok(addressMatchesZumperProperty("251 Manitoba St, Unit 124, Toronto, ON", key!));
assert.ok(!addressMatchesZumperProperty("251 Manitoba St, Suite 1240", key!), "124 never matches 1240");
assert.ok(!addressMatchesZumperProperty("251 Manitoba St, Suite 12", key!));
assert.ok(!addressMatchesZumperProperty("25 Manitoba St, Suite 124", key!));
assert.deepEqual(parseRealtorCaAddress("18 SHORNCLIFFE AVENUE, Toronto (Casa Loma), Ontario M4V1T1"), {
  civic: "18",
  streetWord: "shorncliffe",
  unit: null,
});
assert.equal(parseRealtorCaAddress("Somewhere nice"), null);
assert.equal(parseRealtorCaAddress(null), null);

// kind
assert.equal(classifyPortalLeadEmail(base), "tour_request");
assert.equal(classifyPortalLeadEmail({ ...base, subject: "General inquiry for 1 A ST, #C1234567" }), "inquiry");

// the whole message
const r = parsePortalLeadEmail(base);
assert.ok(r.ok);
if (r.ok) {
  const l = r.lead;
  assert.equal(l.portal, "realtor_ca");
  assert.equal(l.kind, "tour_request");
  assert.equal(l.name, "Dana Whitfield", "the enquirer, never the agent named in the greeting");
  assert.equal(l.email, "dana.w@example.com");
  assert.equal(l.phone, "(416) 555-0142", "the enquirer's number, not the footer's");
  assert.equal(l.message, `I would appreciate more information about ${ADDR}.`);
  assert.deepEqual(l.requestedTimes, ["Any Date - Any Time"]);
  assert.equal(l.subjectAddress, ADDR);
  assert.equal(l.mlsNumber, "W14120476");
  assert.equal(l.plansTo, "Rent a home");
  assert.equal(l.adId, null, "the MLS number is not an ad id");
  assert.equal(l.adUrl, null);
  assert.equal(l.confidence, "exact");
  assert.deepEqual(l.warnings, []);
  const note = portalLeadNote(l);
  assert.ok(note.includes("Received from Realtor.ca (viewing request)."));
  assert.ok(note.includes("Preferred viewing time: Any Date - Any Time."));
  assert.ok(note.includes("Told Realtor.ca they plan to: Rent a home."));
  assert.ok(note.includes("MLS number: W14120476."));
  assert.ok(!/[\u2013\u2014]/.test(note));
}

// no phone given: the footer number is not picked up
const noPhone = parsePortalLeadEmail({ ...base, htmlBody: html({ phone: null }) });
assert.ok(noPhone.ok && noPhone.lead.phone === null);

// no Reply-To: the body's mailto is used and flagged
const noReply = parsePortalLeadEmail({ ...base, replyTo: null });
assert.ok(noReply.ok && noReply.lead.email === "dana.w@example.com");
assert.ok(noReply.ok && noReply.lead.warnings.some((w) => w.includes("no Reply-To")));

// Realtor.ca's own address is never the renter
const owned = parsePortalLeadEmail({
  ...base,
  replyTo: "noreply@leads.realtor.ca",
  htmlBody: html({ phone: null, mailto: "support@realtor.ca" }),
});
assert.ok(!owned.ok && owned.reason === "no_contact_details_found");

assert.equal(portalSiteName("realtor_ca"), "Realtor.ca");
assert.equal(portalSiteName("rentals_ca"), "Rentals.ca");

// the ingest: only this account's rentals, never a sale listing, never another org
const ingest = readFileSync("lib/portal-lead-ingest-server.ts", "utf8");
assert.ok(ingest.includes('handled: "realtor_ca_not_a_rental"'));
const fn = ingest.slice(ingest.indexOf("async function resolveRealtorCaTarget"), ingest.indexOf("* Resolve the unit this lead is about"));
assert.ok(fn.includes('.eq("organization_id", orgId)'), "scoped to the account the address belongs to");
assert.ok(fn.includes("rows.length === 1"), "an ambiguous address is not guessed");
const mig = readFileSync("supabase/migrations/0313_inbound_portal_events_realtor_ca.sql", "utf8");
assert.ok(mig.includes("'realtor_ca'") && mig.includes("'gmail_forwarding'") && mig.includes("'zumper'"));

console.log("ok test-realtor-ca-lead");
