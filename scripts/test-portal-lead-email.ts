// Unit tests for the pure portal-lead email parsing (S567).
// Run: npx tsx scripts/test-portal-lead-email.ts
//
// The two fixtures below are REAL messages, captured 2026-07-25 from the
// rentals@agileonline.ca mailbox. Renter details are left as they arrived
// because a parser test with invented data proves nothing about the format it
// will actually meet. Do not "tidy" the fixtures: the double space after
// "Email:", the space before the colon in "Message :", the run-on plain-text
// paragraph in the tour request and the "None" unit are all real, and each one
// broke a plausible parser during development.
import {
  bareAddress,
  classifyPortalLeadEmail,
  decodeQuotedPrintableIfNeeded,
  displayName,
  extractRentalsLeadJson,
  extractRequestedTimes,
  header,
  htmlToLines,
  labelledField,
  parsePortalLeadEmail,
  portalLeadNote,
  subjectAddressFor,
} from "../lib/portal-lead-email";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
    if (extra !== undefined) console.error("    ->", JSON.stringify(extra));
  }
}

// ---------------------------------------------------------------------------
// FIXTURE 1 — "Rentals.ca tenant lead for 50 Glenrose Avenue", 2026-07-24.
// From contact@rentals.ca. Carries the structured payload, the X- headers AND
// a Reply-To pointing at the renter.
// ---------------------------------------------------------------------------
const LEAD_TEXT = `You have a potential new tenant for 50 Glenrose Avenue

Name: Nelson Jack
Email:  nelsonjack12353@gmail.com
Phone: (229) 508-7780
Unit: None
Message : I came across your listing for 50 Glenrose Avenue, Toronto and would be interested in seeing the place. What are the next steps?

---

You can view the listing at the following URL:
https://url6872.rentals.ca/ls/click?upn=3Du001.bqd16ZFScqW9kWA83hTFFnVGXDEN`;

const LEAD_HTML = `<!doctype html>
<html><head><title></title>
<script id="rentals-lead-data" type="application/ld+json">
    {
        "source": null,
        "email_template_version_code": "1",
        "name": "Nelson Jack",
        "first_name": "Nelson",
        "last_name": "Jack",
        "email": "nelsonjack12353@gmail.com",
        "phone": "(229) 508-7780",
        "message": "I came across your listing for 50 Glenrose Avenue, Toronto and would be interested in seeing the place. What are the next steps?",
        "ad_id": 1455350,
        "ad_url": "https://rentals.ca/toronto/50-glenrose-avenue-2",
        "info": null
    }
</script>
</head><body>
<h1>You have a potential new tenant for 50 Glenrose Avenue.</h1>
<p>To respond, simply reply to this email</p>
<div>Name</div><div>Nelson Jack</div>
<div>Phone</div><div>(229) 508-7780</div>
<div>Email</div><div>nelsonjack12353@gmail.com</div>
<div>Unit</div><div>None</div>
<a href="https://url6872.rentals.ca/ls/click?upn=3Du001">View Listing</a>
</body></html>`;

const LEAD_INPUT = {
  subject: "Rentals.ca tenant lead for 50 Glenrose Avenue",
  from: '"Rentals.ca" <contact@rentals.ca>',
  replyTo: "Nelson Jack <nelsonjack12353@gmail.com>",
  htmlBody: LEAD_HTML,
  textBody: LEAD_TEXT,
  headers: {
    "X-Rentals-Lead-Site-Source": "rentals.ca",
    "X-Rentals-Lead-Type": "site-form",
    "X-Rentals-Property-ID": "1455350",
    "X-Rentals-Property-ILS": "rentals-ca",
  },
};

// ---------------------------------------------------------------------------
// FIXTURE 2 — "New tour request for 833 Pillette Road, Windsor, ON",
// 2026-06-21. From no-reply@rentals.ca. NO payload, NO X- headers, NO Reply-To,
// and its plain-text part is one flowed paragraph with no line breaks between
// fields. It carries requested tour times, which the inquiry template does not.
// ---------------------------------------------------------------------------
const TOUR_TEXT =
  "Hello Noam, You have received a new tour request for 833 Pillette Road, Windsor, ON " +
  "Renter details: Name: Sara Nguyen Email: sara_nguyen16@hotmail.com Phone: (519) 996-6235 " +
  "Message: I saw your listing on Rentals.ca and would like to request a tour, looking to move in " +
  "first week of July, and I have a small dog. I also requested another unit viewing in this building. " +
  "Requested tour times: Mon, Jun 22 — Evening (6 PM – 9 PM) " +
  "Please contact the renter to confirm a tour time or suggest an alternative if these times do not work. " +
  "Reply to this email or reach out directly using the renter's contact information above. " +
  "Thanks, Rentals.ca Team View Listing Details";

const TOUR_HTML = `<html><body>
<h2>Hello Noam,</h2>
<p>You have received a new tour request for <a href="https://rentals.ca/windsor/833-pillette-road">833 Pillette Road, Windsor, ON</a></p>
<p><b>Renter details:</b></p>
<ul>
<li><b>Name:</b> Sara Nguyen</li>
<li><b>Email:</b> <a href="mailto:sara_nguyen16@hotmail.com">sara_nguyen16@hotmail.com</a></li>
<li><b>Phone:</b> (519) 996-6235</li>
<li><b>Message:</b> I saw your listing on Rentals.ca and would like to request a tour, looking to move in first week of July, and I have a small dog. I also requested another unit viewing in this building.</li>
</ul>
<p><b>Requested tour times:</b></p>
<ul><li>Mon, Jun 22 — Evening (6 PM – 9 PM)</li></ul>
<p>Please contact the renter to confirm a tour time or suggest an alternative if these times do not work.</p>
</body></html>`;

const TOUR_INPUT = {
  subject: "New tour request for 833 Pillette Road, Windsor, ON",
  from: '"Rentals.ca" <no-reply@rentals.ca>',
  replyTo: null,
  htmlBody: TOUR_HTML,
  textBody: TOUR_TEXT,
  headers: { "X-Entity-ID": "u001.RM0sJ5eLSK1lewMoptbS2Q==" },
};

// --- helpers ---------------------------------------------------------------
ok("bareAddress unwraps angle brackets", bareAddress('"Rentals.ca" <contact@rentals.ca>') === "contact@rentals.ca");
ok("bareAddress lowercases", bareAddress("Contact@Rentals.CA") === "contact@rentals.ca");
ok("bareAddress rejects a non-address", bareAddress("Rentals.ca") === null);
ok("displayName reads the name", displayName("Nelson Jack <nelsonjack12353@gmail.com>") === "Nelson Jack");
ok("displayName null on a bare address", displayName("a@b.ca") === null);
ok("header is case-insensitive", header({ "x-rentals-property-id": "42" }, "X-Rentals-Property-ID") === "42");
ok("header null when absent", header({ a: "b" }, "X-Nope") === null);

// Quoted-printable only fires when the body looks encoded, so a decoded body
// containing a legitimate "=" survives untouched.
ok("QP decodes when encoded", decodeQuotedPrintableIfNeeded("a=3Db") === "a=b");
ok("QP joins soft line breaks", decodeQuotedPrintableIfNeeded("one=\ntwo") === "onetwo");
ok("QP leaves a plain body alone", decodeQuotedPrintableIfNeeded("2 + 2 = 4") === "2 + 2 = 4");

ok("htmlToLines breaks list items apart", htmlToLines("<ul><li>a</li><li>b</li></ul>").split("\n").length === 2);
ok("htmlToLines drops script contents", !htmlToLines('<script>var x = "secret";</script><p>hi</p>').includes("secret"));

// --- the structured payload ------------------------------------------------
const json = extractRentalsLeadJson(LEAD_HTML);
ok("payload found by id", json != null);
ok("payload ad_id", String(json?.ad_id) === "1455350", json?.ad_id);
ok("payload ad_url", json?.ad_url === "https://rentals.ca/toronto/50-glenrose-avenue-2");
ok("payload template version", json?.email_template_version_code === "1");
ok("no payload in the tour request", extractRentalsLeadJson(TOUR_HTML) === null);
ok("an unrelated ld+json is NOT mistaken for it", extractRentalsLeadJson('<script type="application/ld+json">{"a":1}</script>') === null);
ok("malformed payload returns null, never throws", extractRentalsLeadJson('<script id="rentals-lead-data" type="application/ld+json">{oops</script>') === null);

// --- labelled reads --------------------------------------------------------
ok(
  "a field label only stops a value when it carries a colon",
  labelledField("Message: my name is Bob and I like it Phone: 5551234", "Message", ["Name", "Phone"]) ===
    "my name is Bob and I like it",
  labelledField("Message: my name is Bob and I like it Phone: 5551234", "Message", ["Name", "Phone"]),
);
ok(
  "a boilerplate marker stops a value with no colon",
  labelledField("Requested tour times: Tue 5pm Please contact the renter to confirm", "Requested tour times", [], [
    "Please contact the renter",
  ]) === "Tue 5pm",
);
ok("missing label returns null", labelledField("nothing here", "Name", ["Email"]) === null);

ok(
  "tour times out of the flowed paragraph",
  JSON.stringify(extractRequestedTimes(TOUR_TEXT)) ===
    JSON.stringify(["Mon, Jun 22 — Evening (6 PM – 9 PM)"]),
  extractRequestedTimes(TOUR_TEXT),
);
ok(
  "tour times out of the html list",
  JSON.stringify(extractRequestedTimes(htmlToLines(TOUR_HTML))) ===
    JSON.stringify(["Mon, Jun 22 — Evening (6 PM – 9 PM)"]),
  extractRequestedTimes(htmlToLines(TOUR_HTML)),
);

// --- classification + subject ----------------------------------------------
ok("classify inquiry", classifyPortalLeadEmail(LEAD_INPUT) === "inquiry");
ok("classify tour request", classifyPortalLeadEmail(TOUR_INPUT) === "tour_request");
ok("classify by subject when the sender changes", classifyPortalLeadEmail({ from: "someone@else.ca", subject: "Rentals.ca tenant lead for X" }) === "inquiry");
ok("unrelated mail is not a lead", classifyPortalLeadEmail({ from: "a@b.ca", subject: "Your receipt" }) === null);
ok("subject address, inquiry", subjectAddressFor("inquiry", LEAD_INPUT.subject) === "50 Glenrose Avenue");
ok("subject address, tour", subjectAddressFor("tour_request", TOUR_INPUT.subject) === "833 Pillette Road, Windsor, ON");

// --- FIXTURE 1 end to end ---------------------------------------------------
const r1 = parsePortalLeadEmail(LEAD_INPUT);
ok("fixture 1 parses", r1.ok);
if (r1.ok) {
  const l = r1.lead;
  ok("f1 kind", l.kind === "inquiry");
  ok("f1 confidence is exact", l.confidence === "exact");
  ok("f1 name", l.name === "Nelson Jack", l.name);
  ok("f1 email", l.email === "nelsonjack12353@gmail.com", l.email);
  ok("f1 phone", l.phone === "(229) 508-7780", l.phone);
  ok("f1 message", l.message?.startsWith("I came across your listing") === true, l.message);
  ok("f1 message does not swallow the footer", l.message?.includes("view the listing") === false, l.message);
  ok("f1 ad id", l.adId === "1455350", l.adId);
  ok("f1 ad url", l.adUrl === "https://rentals.ca/toronto/50-glenrose-avenue-2", l.adUrl);
  ok("f1 unit None normalizes to null", l.unit === null, l.unit);
  ok("f1 no tour times", l.requestedTimes.length === 0);
  ok("f1 known template version, no warning", l.warnings.length === 0, l.warnings);
  ok("f1 note carries the renter's words first", portalLeadNote(l).startsWith("I came across your listing"));
  ok("f1 note carries the ad url", portalLeadNote(l).includes("https://rentals.ca/toronto/50-glenrose-avenue-2"));
}

// The payload is the good path, but it must not be the ONLY path: strip it and
// the headers and Reply-To still have to carry the lead.
const r1NoJson = parsePortalLeadEmail({ ...LEAD_INPUT, htmlBody: null });
ok("fixture 1 still parses with no payload", r1NoJson.ok);
if (r1NoJson.ok) {
  ok("f1 fallback email comes from Reply-To", r1NoJson.lead.email === "nelsonjack12353@gmail.com");
  ok("f1 fallback name comes from Reply-To", r1NoJson.lead.name === "Nelson Jack");
  ok("f1 fallback ad id comes from the header", r1NoJson.lead.adId === "1455350");
  ok("f1 fallback phone comes from the text", r1NoJson.lead.phone === "(229) 508-7780", r1NoJson.lead.phone);
  ok("f1 fallback is marked derived", r1NoJson.lead.confidence === "derived");
  ok("f1 fallback warns about the missing payload", r1NoJson.lead.warnings.some((w) => w.includes("no rentals-lead-data")));
}

// --- FIXTURE 2 end to end ---------------------------------------------------
const r2 = parsePortalLeadEmail(TOUR_INPUT);
ok("fixture 2 parses", r2.ok);
if (r2.ok) {
  const l = r2.lead;
  ok("f2 kind", l.kind === "tour_request");
  ok("f2 name", l.name === "Sara Nguyen", l.name);
  ok("f2 email", l.email === "sara_nguyen16@hotmail.com", l.email);
  ok("f2 phone", l.phone === "(519) 996-6235", l.phone);
  ok("f2 message", l.message?.startsWith("I saw your listing on Rentals.ca") === true, l.message);
  ok("f2 message stops before the boilerplate", l.message?.includes("Please contact the renter") === false, l.message);
  ok("f2 tour times captured", l.requestedTimes.length === 1, l.requestedTimes);
  ok("f2 confidence is derived", l.confidence === "derived");
  ok("f2 note names the tour times", portalLeadNote(l).includes("Requested tour times"));
}

// Same message with only the run-on plain-text part, which is what a provider
// that drops HTML would hand us.
const r2TextOnly = parsePortalLeadEmail({ ...TOUR_INPUT, htmlBody: null });
ok("fixture 2 parses from the flowed text alone", r2TextOnly.ok);
if (r2TextOnly.ok) {
  ok("f2 text-only name", r2TextOnly.lead.name === "Sara Nguyen", r2TextOnly.lead.name);
  ok("f2 text-only email", r2TextOnly.lead.email === "sara_nguyen16@hotmail.com");
  ok("f2 text-only message stops at the tour times", r2TextOnly.lead.message?.includes("Requested tour") === false, r2TextOnly.lead.message);
  ok("f2 text-only tour times", r2TextOnly.lead.requestedTimes.length === 1, r2TextOnly.lead.requestedTimes);
}

// --- the failures we care about --------------------------------------------
ok("unrelated mail is refused", parsePortalLeadEmail({ from: "a@b.ca", subject: "hello" }).ok === false);

const noContact = parsePortalLeadEmail({
  subject: "Rentals.ca tenant lead for Somewhere",
  from: '"Rentals.ca" <contact@rentals.ca>',
  textBody: "You have a potential new tenant for Somewhere",
});
ok("a lead with no contact details is refused, not filed empty", noContact.ok === false);
ok("...and says why", noContact.ok === false && noContact.reason === "no_contact_details_found");

// The quiet failure this parser exists to prevent: filing the portal's own
// address as the renter, which routes the operator to rentals.ca support.
const portalOwned = parsePortalLeadEmail({
  subject: "Rentals.ca tenant lead for Somewhere",
  from: '"Rentals.ca" <contact@rentals.ca>',
  textBody: "Name: Support Email: support@rentals.ca Phone: (555) 111-2222",
});
ok("a portal-owned email is discarded", portalOwned.ok && portalOwned.lead.email === null);
ok("...and warned about", portalOwned.ok && portalOwned.lead.warnings.some((w) => w.includes("portal-owned")));
ok("...but the phone still makes it a usable lead", portalOwned.ok && portalOwned.lead.phone === "(555) 111-2222");

// A template redesign must surface, not pass silently.
const newVersion = parsePortalLeadEmail({
  ...LEAD_INPUT,
  htmlBody: LEAD_HTML.replace('"email_template_version_code": "1"', '"email_template_version_code": "9"'),
});
ok("an unknown template version warns", newVersion.ok && newVersion.lead.warnings.some((w) => w.includes("unknown rentals.ca template version")));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
