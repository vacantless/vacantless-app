// Run with: npx tsx scripts/test-s715-email-review.ts
// S715: fixes from reading every Vacantless email as the reader sees it.
import { readFileSync } from "node:fs";
import { notificationHtml, scrubEmDashes, sentByLine, stripActionUrlLines } from "../lib/email";
import { getNotificationEvent, polishTokenVars, renderNotification } from "../lib/notifications";
import { adAgeDays, adStateLabel, buildListingHealthDigest } from "../lib/listing-health";
import { isDaytime, localHour } from "../lib/send-hours";
import { SWEEP_PATHS } from "../lib/cron-sweeps";
import { buildWatchRows } from "../lib/new-account-watch";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`, extra ?? "");
  }
}

// 1. Welcome email rides the database timer.
ok("onboarding on the 15-minute database timer", (SWEEP_PATHS as readonly string[]).includes("/api/cron/onboarding-emails"));

// 2. One copy of the link, not three.
const url = "https://app.vacantless.com/dashboard/leads/abc";
const body = `Renter booked.\n\nWhen: Thu\n\nOpen the inquiry: ${url}`;
ok("strips the duplicate link line", !stripActionUrlLines(body, url).includes(url));
ok("keeps the rest", stripActionUrlLines(body, url).includes("When: Thu"));
ok("no url, no change", stripActionUrlLines(body, null) === body);
const html = notificationHtml({
  to_email: "a@b.c", subject: "s", body, action_label: "Open the inquiry", action_url: url,
  org_name: "Agile", brand_color: null, logo_url: null, reply_to_email: null,
});
ok("rendered alert carries the link twice (button + paste box), not three times", html.split(url).length - 1 === 2, html.split(url).length - 1);

// 3. Footer.
ok("Vacantless footer", sentByLine("Vacantless") === "Sent by Vacantless.");
ok("org footer", sentByLine("Agile") === "Sent by Agile via Vacantless.");
ok("shell uses the short footer", notificationHtml({
  to_email: "a", subject: "s", body: "b", org_name: null, brand_color: null, logo_url: null, reply_to_email: null,
}).replace(/\s+/g, " ").includes("Sent by Vacantless. </div>"));

// 4/5. Ad age, plural, renew box.
ok("age in days", adAgeDays("2026-09-30", "2026-10-14T04:15:00Z") === 14);
ok("posted label", adStateLabel("stale", 14) === "posted 14 days ago");
ok("one day", adStateLabel("stale", 1) === "posted 1 day ago");
ok("gone label", adStateLabel("expired_or_removed", 3) === "no longer up");
const digest = buildListingHealthDigest(
  [{ propertyId: "p9", address: "1551 Assumption St, Unit 9", channel: "facebook", channelLabel: "Facebook Marketplace", reason: "stale", postIds: ["x"], alertablePostIds: ["x"], liveUrl: "https://fb", lastPostedOn: "2026-09-30" }],
  "https://app.vacantless.com",
  "2026-10-14T13:00:00Z",
);
ok("digest says how old", digest.detailsText.includes("Facebook Marketplace, posted 14 days ago"), digest.detailsText);
ok("digest links the Renew box", digest.firstDistributeUrl?.endsWith("?tab=distribute#renew-ads") === true);
const lh = getNotificationEvent("leasing.listing_health")!;
const lhOut = renderNotification(lh, null, { affected_ads_count: "1", listing_health_summary: digest.summaryText, listing_health_details: digest.detailsText, dashboard_url: "u" });
ok("refresh subject singular", lhOut.subject === "1 ad needs a refresh", lhOut.subject);
ok("refresh subject plural", renderNotification(lh, null, { affected_ads_count: "5" }).subject === "5 ads need a refresh");
ok("refresh body says how to fix", lhOut.body.includes("I already renewed it"));
ok("refresh body drops old words", !/Distribute|has not posted|stale|\(s\)/.test(lhOut.body + lhOut.subject));

// Snapshot subject.
const snap = getNotificationEvent("leasing.daily_snapshot")!;
ok("1 viewing today", renderNotification(snap, null, { snapshot_date: "Wednesday, October 14", new_count: "2", showings_today_count: "1" }).subject.endsWith("2 new, 1 viewing today"));
ok("0 viewings today", renderNotification(snap, null, { snapshot_date: "x", new_count: "0", showings_today_count: "0" }).subject.endsWith("0 viewings today"));

// 6. Ready-to-post email.
const desk = getNotificationEvent("leasing.distribution_job_needs_action")!;
const deskOut = renderNotification(desk, null, { channel_label: "Kijiji", property_address: "833 Pillette Rd, Unit 3", next_step: "review and submit", dashboard_url: "u" });
ok("desk plain subject", deskOut.subject === "Your Kijiji ad for 833 Pillette Rd, Unit 3 is waiting on you", deskOut.subject);
ok("S725 desk body never claims we filled it in", !/We filled in/.test(deskOut.body));
ok("desk no caps or old words", !/PREPARED|Distribute|Vacantless has not/.test(deskOut.body));
const td = getNotificationEvent("leasing.distribution_takedown_needed")!;
ok("take-down subject has no em dash", !td.defaultSubject.includes("—"));

// 7. Phone and move-in.
const v = polishTokenVars({ lead_phone: "2263506690", move_in: "2026-10-14" });
ok("phone formatted", v.lead_phone === "226-350-6690", v.lead_phone);
ok("move-in formatted", v.move_in === "Wed, Oct 14, 2026", v.move_in);
ok("odd phone untouched", polishTokenVars({ lead_phone: "(no phone)" }).lead_phone === "(no phone)");
ok("not specified untouched", polishTokenVars({ move_in: "(not specified)" }).move_in === "(not specified)");
ok("new-lead button", readFileSync("lib/notify-new-lead-server.ts", "utf8").includes('label: "Open the inquiry"'));
ok("/r button", readFileSync("app/r/[propertyId]/actions.ts", "utf8").includes('label: "Open the inquiry"'));

// 8. Em dashes scrubbed at send.
ok("scrub subject", scrubEmDashes("Take down X — 1 Main St") === "Take down X - 1 Main St");
ok("scrub entity", scrubEmDashes("Good news &mdash; it is back") === "Good news - it is back");
ok("en dash kept", scrubEmDashes("10–15 minutes") === "10–15 minutes");
const emailSrc = readFileSync("lib/email.ts", "utf8");
ok("every Brevo send goes through the scrub", (emailSrc.match(/fetch\(BREVO_ENDPOINT/g) ?? []).length === 1);

// 9. Daytime.
ok("12:15 AM Toronto is night", !isDaytime(new Date("2026-10-14T04:15:00Z"), "America/Toronto"));
ok("11:46 PM Toronto is night", !isDaytime(new Date("2026-10-10T03:46:00Z"), "America/Toronto"));
ok("9 AM Toronto is day", isDaytime(new Date("2026-10-14T13:00:00Z"), "America/Toronto"));
ok("bad zone falls back", localHour(new Date("2026-10-14T13:00:00Z"), "Not/AZone") === 9);
ok("feedback cron waits for daytime", readFileSync("app/api/cron/feedback/route.ts", "utf8").includes("isDaytime(now"));
ok("refresh cron waits for daytime", readFileSync("app/api/cron/distribution-freshness/route.ts", "utf8").includes("held_until_daytime"));

// 10. Facebook agent button.
ok("posting page button", readFileSync("app/dashboard/properties/[id]/marketplace-actions.ts", "utf8").includes('"Open the posting page"'));

// 11. Founder digest.
const rows = buildWatchRows(
  [{ id: "o1", name: "Test", createdAt: "2026-10-13T12:00:00Z", plan: "growth", subscriptionStatus: "active", closedAt: null, rentals: 1, liveRentals: 1, viewingTimes: 1, enquiries: 1, bookings: 1 }],
  new Date("2026-10-14T12:00:00Z"),
  new Set(),
);
ok("digest line not repeated", rows.length === 1 && rows[0].line.endsWith("First booking. Nothing to do."), rows[0]?.line);

// 12. Dashboard not-found page.
ok("dashboard not-found names the account", readFileSync("app/dashboard/not-found.tsx", "utf8").includes("You are signed in to"));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
