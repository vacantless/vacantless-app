// S736: email the landlord once when a site signs them out.
// Run: npx tsx scripts/test-signin-lost.ts
import { readFileSync } from "node:fs";
import { signinLostAction, signinLostEmail, signinLostText, signinLostTextAction } from "../lib/signin-lost";
import { siteSigninOpenHref, shouldAutoOpenSignin, SIGNIN_WINDOW_MINUTES } from "../lib/site-signin";
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
// S767: Free accounts sign in too (their one live rental is robot-posted free).
ok("only accounts that can use the robot sites are emailed", route.includes("canSetUpRobotSites(org)"));
ok("closed accounts are skipped", route.includes("org.closed_at"));
ok("goes to owners", route.includes('.eq("role", "owner_admin")'));
// S742c: the stamp is claimed before the send, so two runs never both email.
ok("claims the stamp once per sign-out", route.includes('"lost_notified_at",') && route.includes("claimNull("));
ok("needs the cron secret", route.includes("CRON_SECRET"));
ok("in the 15-minute sweep", (SWEEP_PATHS as readonly string[]).includes("/api/cron/signin-lost"));
ok("in the GitHub backup", readFileSync(".github/workflows/reminders.yml", "utf8").includes("/api/cron/signin-lost"));

// S762: the text, the one-tap link and the longer window.
const t = (o: Partial<Parameters<typeof signinLostTextAction>[0]>) =>
  signinLostTextAction({ alive: false, lastCheckCode: "needs_login", lostTextedAt: null, alertMobile: "+15195550123", textsOn: true, quiet: false, ...o });
ok("signed out, mobile saved, texting on: text", t({}) === "text");
ok("quiet hours: waits for the morning", t({ quiet: true }) === "wait");
ok("already texted: nothing", t({ lostTextedAt: "2026-11-08T10:00:00Z" }) === "none");
ok("no mobile saved: nothing", t({ alertMobile: null }) === "none");
ok("texting off or not Growth: nothing", t({ textsOn: false }) === "none");
ok("a site block is not a sign-out (text)", t({ lastCheckCode: "cloudflare" }) === "none");
ok("working again after a text: clear", t({ alive: true, lastCheckCode: "ok", lostTextedAt: "2026-11-08T10:00:00Z" }) === "clear");
const sms = signinLostText({ siteLabel: "Zumper", url: "https://app.vacantless.com/dashboard/site-signin/zumper?open=1" });
ok("text names the site and carries the link", sms.includes("Zumper signed you out") && sms.includes("?open=1"));
ok("text has the opt-out line", sms.includes("Reply STOP to opt out."));
ok("text has no em dash", !/[—–]/.test(sms));
ok("text fits two segments", sms.length <= 306);
ok("one-tap link opens the window", siteSigninOpenHref("kijiji") === "/dashboard/site-signin/kijiji?open=1");
ok("one-tap link keeps the rental", siteSigninOpenHref("zumper", "15a8a7de-271f-4348-9fee-b5a664a4e439").endsWith("?property=15a8a7de-271f-4348-9fee-b5a664a4e439&open=1"));
ok("auto-opens from the link", shouldAutoOpenSignin({ openParam: "1", canStart: true, recentStatus: null }));
ok("no auto-open without the link", !shouldAutoOpenSignin({ openParam: undefined, canStart: true, recentStatus: null }));
ok("no auto-open over an open window", !shouldAutoOpenSignin({ openParam: "1", canStart: false, recentStatus: "ready" }));
ok("no auto-open right after a finished sign-in", !shouldAutoOpenSignin({ openParam: "1", canStart: true, recentStatus: "done" }));
ok("auto-opens again after an expired window", shouldAutoOpenSignin({ openParam: "1", canStart: true, recentStatus: "expired" }));
ok("window is 25 minutes", SIGNIN_WINDOW_MINUTES === 25);
ok("email and text use the one-tap link", route.includes("siteSigninOpenHref(r.channel)"));
ok("text claims its own stamp", route.includes('"lost_texted_at",'));
ok("text only on Growth with texting on", route.includes("canUseRenterSms(org.plan)") && route.includes("org.sms_enabled === true"));
ok("text respects quiet hours", route.includes("isWithinQuietHours("));
ok("text goes from the account's number", route.includes("organizationId: r.organization_id"));
const page = readFileSync("app/dashboard/site-signin/[channel]/page.tsx", "utf8");
ok("page auto-opens from the link", page.includes("shouldAutoOpenSignin(") && page.includes('<AutoSubmit formId="site-signin-start" />') && page.includes('id="site-signin-start"'));
ok("no page says 10 minutes", !page.includes("10 minutes") && !readFileSync("app/dashboard/site-signin/page.tsx", "utf8").includes("10 minutes"));
ok("migration adds the mobile and the stamp", /alert_mobile_e164/.test(readFileSync("supabase/migrations/0274_signin_lost_text_and_kijiji_edit.sql", "utf8")) && /lost_texted_at/.test(readFileSync("supabase/migrations/0274_signin_lost_text_and_kijiji_edit.sql", "utf8")));

console.log(`\nsignin-lost: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
