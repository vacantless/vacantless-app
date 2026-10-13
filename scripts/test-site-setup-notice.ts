// S713d: the robot's named site blocker reaches the rental page.
// Run: npx tsx scripts/test-site-setup-notice.ts
import { readFileSync } from "node:fs";
import { siteSetupNotice, ZUMPER_LANDLORD_SETUP_CODE } from "../lib/distribution-publish";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${name}`);
  }
}

const n = siteSetupNotice("needs_operator", ZUMPER_LANDLORD_SETUP_CODE);
ok("a waiting Zumper renter account gets a notice", n != null);
ok("notice links to Zumper's upgrade page", n?.href === "https://www.zumper.com/manage/upgrade");
ok("notice says Landlord and ID", /Landlord/.test(n?.message ?? "") && /ID/.test(n?.message ?? ""));
ok("notice has no em dash", !/—/.test(n?.message ?? ""));
ok("code matches the worker's", ZUMPER_LANDLORD_SETUP_CODE === "zumper_landlord_setup");
ok("no notice once live", siteSetupNotice("live", ZUMPER_LANDLORD_SETUP_CODE) == null);
ok("no notice while posting", siteSetupNotice("submitting", ZUMPER_LANDLORD_SETUP_CODE) == null);
ok("no notice for other codes", siteSetupNotice("needs_operator", "spend_period_cap") == null);
ok("no notice without a code", siteSetupNotice("needs_operator", null) == null);

const page = readFileSync("app/dashboard/properties/[id]/page.tsx", "utf8");
ok("page reads error_code", /error_message, error_code, audit_message/.test(page) && /errorCode: r\.error_code/.test(page));
const tab = readFileSync("app/dashboard/properties/[id]/distribute-tab.tsx", "utf8");
ok("tab passes the notice to the row", /siteSetup: siteSetupNotice\(it\.publishStatus, it\.errorCode\)/.test(tab));
const row = readFileSync("app/dashboard/properties/[id]/publish-everywhere.tsx", "utf8");
ok("row shows Needs you", /siteSetup\s*\n?\s*\? \{ label: "Needs you"/.test(row));
ok("row renders the message and link", /\{siteSetup\.message\}/.test(row) && /href=\{siteSetup\.href\}/.test(row));
const actions = readFileSync("app/dashboard/properties/distribution-actions.ts", "utf8");
ok("approving again clears the blocker", /operator_submit_approved_by: uid,[\s\S]{0,300}error_code: null,\s*error_message: null,/.test(actions));

console.log(`site setup notice: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
