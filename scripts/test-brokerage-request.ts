// Unit tests for the Realtor.ca partner-agent request helpers (S735).
// Run: npx tsx scripts/test-brokerage-request.ts
import assert from "node:assert/strict";
import {
  brokerageRouteFor,
  provinceFromAddress,
  validateBrokerageRequest,
} from "../lib/brokerage-request";
import { brokerageRequestEmail } from "../lib/brokerage-request-email";

// Province reading.
assert.equal(provinceFromAddress("833 Pillette Rd, Unit 3, Windsor, ON N8Y 3B4"), "ON");
assert.equal(provinceFromAddress("506 Manning Avenue, Toronto, ON"), "ON");
assert.equal(provinceFromAddress("12 Jasper Ave, Edmonton, AB T5J 0N3"), "AB");
assert.equal(provinceFromAddress("12 Jasper Ave, Edmonton, Alberta"), "AB");
assert.equal(provinceFromAddress("1 Rue Sainte-Catherine, Montréal, Québec"), "QC");
// An Ontario city with no province token still reads as Ontario.
assert.equal(provinceFromAddress("1195 Bruce Ave, Unit 303, Windsor"), "ON");
// The word "on" inside an address is not the province.
assert.equal(provinceFromAddress("Unit on 5th floor, Calgary AB"), "AB");
assert.equal(provinceFromAddress(""), null);
assert.equal(provinceFromAddress(null), null);
assert.equal(provinceFromAddress("Somewhere Street 12"), null);

// Routes.
const on = brokerageRouteFor("833 Pillette Rd, Windsor, ON");
assert.equal(on.kind, "realtor_ca_listing");
assert.equal(on.province, "ON");
assert.match(on.body, /MLS/);
const ab = brokerageRouteFor("12 Jasper Ave, Edmonton, AB");
assert.equal(ab.kind, "local_agent");
assert.equal(ab.province, "AB");
assert.match(ab.action, /local agent/);
// Unknown province reads as Ontario (the follow-up sorts it).
assert.equal(brokerageRouteFor("Somewhere Street 12").kind, "realtor_ca_listing");

// Validation: one way to reach the landlord, and a real-looking email.
assert.deepEqual(validateBrokerageRequest({ contactPhone: "", contactEmail: "" }), { ok: false, field: "contact" });
assert.deepEqual(validateBrokerageRequest({ contactPhone: "", contactEmail: "nope" }), { ok: false, field: "email" });
const ok = validateBrokerageRequest({
  contactName: "  Noam ",
  contactPhone: "519-555-0123",
  contactEmail: "",
  note: "x".repeat(2000),
});
assert.equal(ok.ok, true);
if (ok.ok) {
  assert.equal(ok.values.contactName, "Noam");
  assert.equal(ok.values.note.length, 1000);
}

// The admin email names the rental, the kind and the contact.
const mail = brokerageRequestEmail({
  kind: "realtor_ca_listing",
  province: "ON",
  orgName: "Agile Real Estate Group",
  orgId: "org-1",
  propertyId: "prop-1",
  address: "833 Pillette Rd, Unit 3, Windsor, ON",
  rentCents: 127500,
  requesterEmail: "a@b.ca",
  values: { contactName: "Aaliyah", contactPhone: "519-555-0123", contactEmail: "", note: "" },
  appUrl: "https://app.vacantless.com",
});
assert.equal(mail.subject, "Realtor.ca request: 833 Pillette Rd, Unit 3, Windsor, ON");
assert.match(mail.body, /Ontario Realtor\.ca listing/);
assert.match(mail.body, /\$1,275 a month/);
assert.match(mail.body, /Phone: 519-555-0123/);
assert.match(mail.body, /app\.vacantless\.com\/dashboard\/properties\/prop-1/);
assert.match(mail.body, /never by Vacantless/);

console.log("test-brokerage-request: all passed");
