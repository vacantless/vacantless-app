// S737: the "your ads are live" email (review item 2).
// Run: npx tsx scripts/test-posted-results-email.ts
import { readFileSync } from "node:fs";
import {
  RESULTS_EMAIL_MAX_AGE_MS,
  RESULTS_EMAIL_WAIT_MS,
  resultsEmail,
  resultsEmailDecision,
  type ResultsEmailPost,
} from "../lib/posted-results-email";
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

const now = Date.parse("2026-10-25T18:00:00Z");
const hoursAgo = (h: number) => new Date(now - h * 3600_000).toISOString();
const post = (portal: string, h: number, status = "live", url = `https://example.com/${portal}`): ResultsEmailPost => ({
  portal,
  status,
  url,
  createdAt: hoursAgo(h),
});

ok("wait is two hours", RESULTS_EMAIL_WAIT_MS === 2 * 3600_000);
ok("max age is three days", RESULTS_EMAIL_MAX_AGE_MS === 72 * 3600_000);
const base = { propertyStatus: "available", lastSentAt: null, now };
ok("first ad 3 hours ago: send", resultsEmailDecision({ ...base, posts: [post("kijiji", 3)] }) === "send");
ok("first ad 1 hour ago: wait", resultsEmailDecision({ ...base, posts: [post("kijiji", 1)] }) === "wait");
ok("oldest live ad decides", resultsEmailDecision({ ...base, posts: [post("kijiji", 1), post("zumper", 5)] }) === "send");
ok("older than three days: none (no email for old rentals)", resultsEmailDecision({ ...base, posts: [post("kijiji", 80)] }) === "none");
ok("no live ads: none", resultsEmailDecision({ ...base, posts: [post("kijiji", 5, "draft")] }) === "none");
ok("a live ad without a link does not count", resultsEmailDecision({ ...base, posts: [post("kijiji", 5, "live", "")] }) === "none");
ok("rental not available: none", resultsEmailDecision({ ...base, propertyStatus: "leased", posts: [post("kijiji", 5)] }) === "none");
ok("already sent this turn: none", resultsEmailDecision({ ...base, lastSentAt: hoursAgo(2), posts: [post("kijiji", 5)] }) === "none");
ok("sent last turn, new ads now: send", resultsEmailDecision({ ...base, lastSentAt: hoursAgo(200), posts: [post("kijiji", 5)] }) === "send");

const mail = resultsEmail({
  address: "88 Lakeview Ave, Unit 2",
  posts: [post("zumper", 5), post("kijiji", 5), post("facebook_feed", 5), post("kijiji", 4, "removed")],
  bookingUrl: "https://app.vacantless.com/r/abc",
  appUrl: "https://app.vacantless.com",
  nextStep: { key: "marketplace", title: "Facebook Marketplace, free", body: "", href: "/dashboard/properties/abc?tab=distribute#for-you-facebook", action: "Open" },
});
ok("subject counts our page plus 3 sites", mail.subject === "88 Lakeview Ave, Unit 2 is live on 4 sites");
ok("body lists each live site with its link", mail.body.includes("Kijiji: https://example.com/kijiji") && mail.body.includes("Zumper: https://example.com/zumper"));
ok("removed ads are not listed twice", mail.body.split("Kijiji:").length === 2);
ok("booking link is in the body", mail.body.includes("https://app.vacantless.com/r/abc"));
ok("next step link is absolute", mail.body.includes("https://app.vacantless.com/dashboard/properties/abc?tab=distribute#for-you-facebook"));
ok("button", mail.actionLabel === "Open your rental");
ok("no em dash", !/—/.test(mail.subject + mail.body));
ok("no next step line when there is none", !resultsEmail({ address: null, posts: [post("kijiji", 5)], bookingUrl: "u", appUrl: "a", nextStep: null }).body.includes("Want more renters"));
ok("without an address", resultsEmail({ address: null, posts: [], bookingUrl: "u", appUrl: "a", nextStep: null }).subject === "Your rental is live");

const route = readFileSync("app/api/cron/posted-results-email/route.ts", "utf8");
ok("route checks the cron secret", route.includes("CRON_SECRET"));
ok("route stamps results_emailed_at", route.includes("results_emailed_at"));
ok("route skips Agile", route.includes("921f7c08-98af-428f-a238-36f4a781b0de"));
ok("route has a dry run", route.includes('get("dry") === "1"'));
ok("in the 15-minute sweep", (SWEEP_PATHS as readonly string[]).includes("/api/cron/posted-results-email"));
ok("in the GitHub backup", readFileSync(".github/workflows/reminders.yml", "utf8").includes("/api/cron/posted-results-email"));
ok("migration adds the stamp", readFileSync("supabase/migrations/0262_posted_results_email.sql", "utf8").includes("results_emailed_at"));

console.log(`\nposted-results-email: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
