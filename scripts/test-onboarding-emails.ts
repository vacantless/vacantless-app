// Run with: npx tsx scripts/test-onboarding-emails.ts
import { readFileSync } from "node:fs";
import { decideOnboardingEmail } from "../lib/onboarding-emails";
import { checkPlainLanguage } from "../lib/i18n/plain-words";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}

const w = decideOnboardingEmail({ stage: "signed_up", daysSinceSignup: 0, stepSent: 0 });
ok("welcome first", w?.step === 1);
ok("welcome points at adding a rental", w?.actionPath === "/dashboard/properties/new");
ok("welcome lists 3 steps", (w?.body ?? "").includes("3. Paste your rental link"));
ok("no nudge on day 0", decideOnboardingEmail({ stage: "signed_up", daysSinceSignup: 0, stepSent: 1 }) === null);
const n = decideOnboardingEmail({ stage: "live", daysSinceSignup: 1, stepSent: 1 });
ok("nudge on day 1 when stuck", n?.step === 2 && n.actionPath === "/dashboard/availability");
ok("no nudge once viewing times are set", decideOnboardingEmail({ stage: "viewing_times", daysSinceSignup: 2, stepSent: 1 }) === null);
ok("no nudge after an enquiry", decideOnboardingEmail({ stage: "first_enquiry", daysSinceSignup: 2, stepSent: 1 }) === null);
ok("never a third email", decideOnboardingEmail({ stage: "signed_up", daysSinceSignup: 9, stepSent: 2 }) === null);
const busy = decideOnboardingEmail({ stage: "first_booking", daysSinceSignup: 0, stepSent: 0 });
ok("welcome still sent to a fast starter", busy?.step === 1 && busy.actionPath === "/dashboard");

for (const e of [w, n, busy]) {
  const text = `${e?.subject}\n\n${e?.body}`;
  ok(`no em dash: ${e?.subject}`, !text.includes("—"));
  for (const para of (e?.body ?? "").split("\n\n")) {
    if (/^\d\./.test(para)) continue;
    const f = checkPlainLanguage(para);
    ok(`plain language: ${para.slice(0, 40)}`, f.length === 0);
    if (f.length) console.error(f);
  }
}

const route = readFileSync("app/api/cron/onboarding-emails/route.ts", "utf8");
ok("route needs CRON_SECRET", route.includes("CRON_SECRET"));
ok("route skips old accounts", route.includes("ONBOARDING_EMAILS_START"));
ok("route skips quiet test orgs", route.includes("isQuietNotificationOrg"));
ok("route skips closed accounts", route.includes('.is("closed_at", null)'));
ok("route stamps the step after sending", route.includes("onboarding_email_step: email.step"));

console.log(`\nonboarding-emails: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
