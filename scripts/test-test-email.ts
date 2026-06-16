// Unit tests for the pure "Send a test email" helpers.
// Run: npx tsx scripts/test-test-email.ts
import {
  validateTestRecipient,
  TEST_SAMPLE,
  TEST_SUBJECT_PREFIX,
} from "../lib/test-email";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

// --- validateTestRecipient: accepts good addresses ------------------------
{
  for (const good of [
    "noam@example.com",
    "a.b+tag@sub.domain.co",
    "  spaced@example.com  ",
    "Mixed.Case@Example.COM",
  ]) {
    const r = validateTestRecipient(good);
    ok(`accepts ${JSON.stringify(good)}`, r.ok === true);
  }
}

// --- validateTestRecipient: normalizes (trim + lowercase) -----------------
{
  const r = validateTestRecipient("  Noam@Example.COM ");
  ok("trims + lowercases", r.ok === true && r.value === "noam@example.com");
}

// --- validateTestRecipient: rejects blank/missing -------------------------
{
  for (const blank of ["", "   ", null, undefined]) {
    const r = validateTestRecipient(blank as string | null | undefined);
    ok(`rejects blank ${JSON.stringify(blank)}`, r.ok === false);
  }
}

// --- validateTestRecipient: rejects malformed -----------------------------
{
  for (const bad of [
    "noam",
    "noam@",
    "@example.com",
    "noam@example",
    "no am@example.com",
    "a@b@example.com",
    "noam@example.com, two@example.com",
    "<noam@example.com>",
    'name"@example.com',
  ]) {
    const r = validateTestRecipient(bad);
    ok(`rejects ${JSON.stringify(bad)}`, r.ok === false);
  }
}

// --- validateTestRecipient: rejects over-long -----------------------------
{
  const longLocal = "a".repeat(250);
  const r = validateTestRecipient(`${longLocal}@example.com`);
  ok("rejects > 254 chars", r.ok === false);
}

// --- TEST_SAMPLE: realistic, fully-populated sample -----------------------
{
  ok("sample has a renter name", TEST_SAMPLE.renter_name.length > 0);
  ok("sample has a property address", TEST_SAMPLE.property_address.length > 0);
  ok("sample rent is a positive integer (cents)",
    Number.isInteger(TEST_SAMPLE.rent_cents) && TEST_SAMPLE.rent_cents > 0);
}

// --- TEST_SUBJECT_PREFIX: marks the send as a test ------------------------
{
  ok("subject prefix is non-empty", TEST_SUBJECT_PREFIX.trim().length > 0);
  ok("subject prefix mentions Test", /test/i.test(TEST_SUBJECT_PREFIX));
}

// --- Summary ---------------------------------------------------------------
console.log(`\ntest-test-email: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
