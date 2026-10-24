// S736: email the landlord once when a site signs them out.
// Run: npx tsx scripts/test-signin-lost.ts
import { readFileSync } from "node:fs";
import { signinLostAction, signinLostEmail } from "../lib/signin-lost";
import { SWEEP_PATHS } from "../lib/cron-sweeps";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${name}`);
  }
}

ok("signed out, not told yet: notify", signinLostAction({ alive: false, lastCheckCode: "needs_login", lostNotifiedAt: null }) === "notify");
ok("no saved sign-in counts as signed out", signinLostAction({ alive: false, lastCheckCode: "no_session", lostNotifiedAt: null }) === "notify");
ok("already told: nothing", signinLostAction({ alive: false, lastCheckCode: "needs_login", lostNotifiedAt: "2026-10-24T10:00:00Z" }) === "none");
ok("a site block is not a sign-out", signinLostAction({ alive: false, lastCheckCode: "cloudflare", lostNotifiedAt: null }) === "none");
ok("never checked: nothing", signinLostAction({ alive: null, lastCheckCode: null, lostNotifiedAt: null }) === "none");
ok("working again after an email: clear", signinLostAction({ alive: true, lastCheckCode: "ok", lostNotifiedAt: "2026-10-24T10:00:00Z" }) === "clear");
ok("working and never told: nothing", signinLostAction({ alive: true, lastCheckCode: "ok", lostNotifiedAt: null }) === "none");

const mail = signinLostEmail({ siteLabel: "Kijiji", orgName: "Lakeview Rentals" });
ok("subject names the site", mail.subject === "Sign in to Kijiji again");
ok("body names the account and what stopped", mail.body.includes("Lakeview Rentals") && mail.body.includes("post your rentals on Kijiji"));
ok("button names the site", mail.actionLabel === "Sign in to Kijiji");
ok("no em dash", !/—/.test(mail.subject + mail.body));
ok("without a name", signinLostEmail({ siteLabel: "Zumper", orgName: null }).body.includes("your account"));

const route = readFileSync("app/api/cron/signin-lost/route.ts", "utf8");
ok("only Posting accounts are emailed", route.includes("canUseRobotPosting(org)"));
ok("closed accounts are skipped", route.includes("org.closed_at"));
ok("goes to owners", route.includes('.eq("role", "owner_admin")'));
ok("stamps once per sign-out", route.includes("lost_notified_at: new Date().toISOString()"));
ok("needs the cron secret", route.includes("CRON_SECRET"));
ok("in the 15-minute sweep", (SWEEP_PATHS as readonly string[]).includes("/api/cron/signin-lost"));
ok("in the GitHub backup", readFileSync(".github/workflows/reminders.yml", "utf8").includes("/api/cron/signin-lost"));

console.log(`\nsignin-lost: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
