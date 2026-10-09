// Run with: npx tsx scripts/test-s702-walk-fixes.ts
// The three fixes from the S702 stranger walk.
import { readFileSync } from "node:fs";
let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}
const r = readFileSync("app/r/[propertyId]/page.tsx", "utf8");
ok("public page reads the org's closed_at", r.includes("organizations(closed_at)"));
ok("closed org shows no waiting list", r.includes("!isAvailable && orgClosed ?") && r.indexOf("orgClosed ?") < r.indexOf("joinWaitlist}"));
const page = readFileSync("app/dashboard/settings/page.tsx", "utf8");
ok("feature panel is staff only", page.includes("canManageOwnerSettings && isPlatformAdmin &&"));
const actions = readFileSync("app/dashboard/settings/actions.ts", "utf8");
const i = actions.indexOf("export async function updateOrganizationFeatureFlag");
const body = actions.slice(i, actions.indexOf("export async function", i + 10));
ok("feature save checks staff", body.includes("isAdminEmail(who?.email, adminEmails())"));
const j = actions.indexOf("export async function closeAccount");
const close = actions.slice(j, actions.indexOf("export async function", j + 10) > 0 ? actions.indexOf("export async function", j + 10) : undefined);
ok("refused close lands on the card", close.includes("close=${decision.reason}#close-account"));
ok("card has the anchor", page.includes('id="close-account"'));
console.log(`\ns702-walk-fixes: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
