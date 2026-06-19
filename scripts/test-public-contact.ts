// Unit tests for the pure public-contact validators (lib/public-contact.ts).
// Run: npx tsx scripts/test-public-contact.ts
import {
  validatePublicContactPhone,
  validatePublicContactEmail,
  validatePublicContact,
  MAX_PUBLIC_PHONE_LEN,
} from "../lib/public-contact";

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${label}`);
  }
}

// --- phone -----------------------------------------------------------------
ok("blank phone -> null/ok", (() => {
  const r = validatePublicContactPhone("");
  return r.ok && r.value === null;
})());
ok("whitespace phone -> null/ok", (() => {
  const r = validatePublicContactPhone("   ");
  return r.ok && r.value === null;
})());
ok("null phone -> null/ok", (() => {
  const r = validatePublicContactPhone(null);
  return r.ok && r.value === null;
})());
ok("formatted NANP preserved verbatim", (() => {
  const r = validatePublicContactPhone("(226) 773-7555");
  return r.ok && r.value === "(226) 773-7555";
})());
ok("E.164-style preserved verbatim", (() => {
  const r = validatePublicContactPhone("+1 226-773-7555");
  return r.ok && r.value === "+1 226-773-7555";
})());
ok("trims surrounding whitespace", (() => {
  const r = validatePublicContactPhone("  226-773-7555  ");
  return r.ok && r.value === "226-773-7555";
})());
ok("7-digit local accepted", validatePublicContactPhone("773-7555").ok);
ok("too few digits rejected", !validatePublicContactPhone("12345").ok);
ok("too many digits rejected", !validatePublicContactPhone("1234567890123456").ok);
ok("letters rejected", !validatePublicContactPhone("226-CALL-NOW").ok);
ok("over-length rejected", !validatePublicContactPhone("1".repeat(MAX_PUBLIC_PHONE_LEN + 1)).ok);

// --- email -----------------------------------------------------------------
ok("blank email -> null/ok", (() => {
  const r = validatePublicContactEmail("");
  return r.ok && r.value === null;
})());
ok("valid email lowercased", (() => {
  const r = validatePublicContactEmail("Leasing@Agile.CA");
  return r.ok && r.value === "leasing@agile.ca";
})());
ok("email trimmed", (() => {
  const r = validatePublicContactEmail("  a@b.co  ");
  return r.ok && r.value === "a@b.co";
})());
ok("malformed email rejected", !validatePublicContactEmail("not-an-email").ok);
ok("email with display name rejected", !validatePublicContactEmail("Name <a@b.co>").ok);

// --- combined --------------------------------------------------------------
ok("both blank -> ok with nulls", (() => {
  const r = validatePublicContact({ phone: "", email: "" });
  return (
    r.ok &&
    r.values.public_contact_phone === null &&
    r.values.public_contact_email === null
  );
})());
ok("both valid -> normalized values", (() => {
  const r = validatePublicContact({
    phone: "226-773-7555",
    email: "Leasing@Agile.CA",
  });
  return (
    r.ok &&
    r.values.public_contact_phone === "226-773-7555" &&
    r.values.public_contact_email === "leasing@agile.ca"
  );
})());
ok("bad phone -> fails on phone field", (() => {
  const r = validatePublicContact({ phone: "abc", email: "a@b.co" });
  return !r.ok && r.field === "phone";
})());
ok("good phone, bad email -> fails on email field", (() => {
  const r = validatePublicContact({ phone: "226-773-7555", email: "nope" });
  return !r.ok && r.field === "email";
})());

console.log(`\npublic-contact: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
