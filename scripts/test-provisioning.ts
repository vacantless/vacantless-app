// Unit tests for the pure account-provisioning logic.
// Run: npx tsx scripts/test-provisioning.ts
import {
  normalizeEmail,
  isValidEmail,
  cleanName,
  slugifyOrg,
  validateProvisionInput,
  parseAdminEmails,
  isAdminEmail,
  failureMessage,
  inviteStatusLabel,
  inviteSourceLabel,
} from "../lib/provisioning";

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

// --- normalizeEmail --------------------------------------------------------
ok("normalizeEmail lowercases + trims", normalizeEmail("  Paul@Example.COM ") === "paul@example.com");
ok("normalizeEmail null -> ''", normalizeEmail(null) === "");

// --- isValidEmail ----------------------------------------------------------
ok("valid email passes", isValidEmail("zak@gmail.com") === true);
ok("valid email mixed case passes", isValidEmail(" Zak@Gmail.Com ") === true);
ok("no @ fails", isValidEmail("zak.gmail.com") === false);
ok("no domain dot fails", isValidEmail("zak@gmail") === false);
ok("whitespace inside fails", isValidEmail("za k@gmail.com") === false);
ok("empty fails", isValidEmail("") === false);

// --- cleanName -------------------------------------------------------------
ok("cleanName trims + collapses spaces", cleanName("  Zak   Smith ") === "Zak Smith");
ok("cleanName empty -> null", cleanName("   ") === null);
ok("cleanName null -> null", cleanName(null) === null);

// --- slugifyOrg ------------------------------------------------------------
ok("slugify basic", slugifyOrg("Zak Smith") === "zak-smith");
ok("slugify strips punctuation", slugifyOrg("Harel & Co. Rentals!") === "harel-co-rentals");
ok("slugify trims leading/trailing hyphens", slugifyOrg("  -Hello-  ") === "hello");
ok("slugify empty -> 'org'", slugifyOrg("!!!") === "org");
ok("slugify caps at 40 chars", slugifyOrg("a".repeat(60)).length === 40);

// --- validateProvisionInput ------------------------------------------------
{
  const r = validateProvisionInput({ email: " Zak@Gmail.com ", orgName: "  Zak Smith  " });
  ok("validate ok normalizes email", r.ok === true && r.value.email === "zak@gmail.com");
  ok("validate ok trims org name", r.ok === true && r.value.orgName === "Zak Smith");
  ok("validate defaults source to operator", r.ok === true && r.value.source === "operator");
  ok("validate operator clears referral attribution", r.ok === true && r.value.referredByOrgId === null);
}
{
  const r = validateProvisionInput({ email: "bad", orgName: "X" });
  ok("validate rejects bad email", r.ok === false);
}
{
  const r = validateProvisionInput({ email: "a@b.co", orgName: "   " });
  ok("validate rejects empty org name", r.ok === false);
}
{
  const r = validateProvisionInput({ email: "a@b.co", orgName: "X".repeat(121) });
  ok("validate rejects over-long org name", r.ok === false);
}
{
  // referral missing attribution
  const r = validateProvisionInput({ email: "a@b.co", orgName: "X", source: "referral" });
  ok("validate referral requires referredByOrgId", r.ok === false);
}
{
  const r = validateProvisionInput({
    email: "a@b.co",
    orgName: "X",
    source: "referral",
    referredByOrgId: "org-1",
    referredByUserId: "user-1",
  });
  ok("validate referral keeps attribution", r.ok === true && r.value.source === "referral" && r.value.referredByOrgId === "org-1");
}
{
  // operator request that accidentally carries attribution -> stripped
  const r = validateProvisionInput({
    email: "a@b.co",
    orgName: "X",
    source: "operator",
    referredByOrgId: "org-1",
  });
  ok("validate operator strips stray attribution", r.ok === true && r.value.referredByOrgId === null);
}

// --- parseAdminEmails / isAdminEmail ---------------------------------------
{
  const list = parseAdminEmails("Noam@Example.com, second@x.io ; third@y.io");
  ok("parseAdminEmails splits on , ; and space", list.length === 3);
  ok("parseAdminEmails lowercases", list.includes("noam@example.com"));
  ok("parseAdminEmails empty -> []", parseAdminEmails("") .length === 0);
  ok("parseAdminEmails null -> []", parseAdminEmails(null).length === 0);

  ok("isAdminEmail matches (case-insensitive)", isAdminEmail("NOAM@example.com", list) === true);
  ok("isAdminEmail rejects non-member", isAdminEmail("nope@x.io", list) === false);
  ok("isAdminEmail rejects null", isAdminEmail(null, list) === false);
  ok("isAdminEmail rejects against empty list", isAdminEmail("noam@example.com", []) === false);
}

// --- labels / messages -----------------------------------------------------
ok("status label provisioned", inviteStatusLabel("provisioned") === "Provisioned");
ok("status label unknown -> dash", inviteStatusLabel("weird") === "—");
ok("source label referral", inviteSourceLabel("referral") === "Referral");
ok("source label default operator", inviteSourceLabel(null) === "Operator");
ok("failureMessage already_has_account", failureMessage("already_has_account").length > 0);

// --- Report ----------------------------------------------------------------
console.log(`\nprovisioning: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
