// S831: the per-rental monthly report. Run: npx tsx scripts/test-s831-rental-report.ts
import { readFileSync } from "node:fs";
import { buildRentalReport, reportMonthFor, currentMonthFor, shortAddr, dollars } from "../lib/rental-report";
import { CATALOG_MESSAGES, EXTRA_RECIPIENT_MESSAGE_IDS, MESSAGE_ORG_SWITCHES } from "../lib/message-catalog";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}${extra !== undefined ? ` ${JSON.stringify(extra)}` : ""}`);
  }
}

const base = {
  address: "50 Glenrose Ave, Unit B, Toronto, ON",
  rentCents: 159500,
  monthStart: "2026-11-01",
  monthEnd: "2026-12-01",
  today: "2026-12-01",
  availableSince: "2026-11-21",
  posts: [
    { portal: "kijiji", status: "live", url: "https://www.kijiji.ca/v/1746538949", createdAt: "2026-11-21T20:00:00Z" },
    { portal: "zumper", status: "live", url: "https://www.zumper.com/x", createdAt: "2026-11-23T13:00:00Z" },
    { portal: "zumper", status: "removed", url: "https://www.zumper.com/old", createdAt: "2026-11-21T21:00:00Z" },
    { portal: "facebook", status: "live", url: "https://facebook.com/m/1", createdAt: "2026-11-22T10:00:00Z" },
  ],
  costs: [{ portal: "kijiji", label: null, amountCents: 3384, spentOn: "2026-11-21" }],
  accountWideMonthCents: 0,
  leads: [
    { source: "Kijiji", createdAt: "2026-11-22T12:00:00Z" },
    { source: "Facebook Marketplace", createdAt: "2026-11-22T13:00:00Z" },
    { source: "Facebook Marketplace", createdAt: "2026-11-25T13:00:00Z" },
  ],
  showings: [
    { scheduledAt: "2026-11-27T22:00:00Z", outcome: "attended" },
    { scheduledAt: "2026-11-28T22:00:00Z", outcome: "no_show" },
    { scheduledAt: "2026-11-29T22:00:00Z", outcome: "cancelled" },
  ],
  nextSteps: "Postcards to the street next week.",
  rentalUrl: "https://app.vacantless.com/dashboard/properties/x",
  orgName: "Davis Muscovitch Rentals",
};

const r = buildRentalReport(base);
ok("subject names the rental and month", r.subject === "50 Glenrose Ave, Unit B - November 2026 marketing update and next steps", r.subject);
ok("three sections in order", r.text.indexOf("LATEST WORK AND NEXT STEPS") < r.text.indexOf("RESPONSE SO FAR") && r.text.indexOf("RESPONSE SO FAR") < r.text.indexOf("MARKETING TO DATE"));
ok("renters counted", r.facts.rentersMonth === 3 && r.facts.rentersToDate === 3);
ok("renters by site", r.text.includes("2 from Facebook Marketplace") && r.text.includes("1 from Kijiji"));
ok("renter caveat", r.text.includes("not a count of qualified applicants"));
ok("cancelled viewing not counted", r.facts.bookedMonth === 2 && r.facts.heldMonth === 1 && r.facts.noShowMonth === 1);
ok("days on market from available date", r.facts.daysOnMarket === 10, r.facts.daysOnMarket);
ok("money in dollars", r.text.includes("Spent in November 2026: $33.84") && r.text.includes("Spent to date: $33.84"));
ok("kijiji shows its cost", r.text.includes("Kijiji: live since November 21, $33.84 spent"));
ok("unpaid site says no cost entered, never free", r.text.includes("no cost entered") && !/\bfree\b/i.test(r.text));
ok("removed ad not listed", !r.text.includes("zumper.com/old"));
ok("one line per site", (r.text.match(/PadMapper: live since/g) ?? []).length === 1);
ok("next steps carried", r.text.includes("Next steps: Postcards to the street next week."));
ok("paid line in latest work", r.text.includes("Paid $33.84 for Kijiji on November 21."));
ok("no em dashes", !r.html.includes("—") && !r.text.includes("—"));
ok("not empty", !r.empty);
ok("html escapes", !buildRentalReport({ ...base, nextSteps: "<b>x</b>" }).html.includes("<b>x</b>"));

const quiet = buildRentalReport({ ...base, leads: [], showings: [], nextSteps: null });
ok("by-request account with no viewings skips the line", !buildRentalReport({ ...base, showings: [], viewingsByRequest: true }).text.includes("viewings were booked") && !buildRentalReport({ ...base, showings: [], viewingsByRequest: true }).text.includes("No viewings"));
ok("by-request account with viewings still shows them", buildRentalReport({ ...base, viewingsByRequest: true }).text.includes("2 viewings were booked"));
ok("no renters line", quiet.text.includes("No renters wrote in during November 2026."));
ok("no next steps line without a note", !quiet.text.includes("Next steps:"));
const empty = buildRentalReport({ ...base, posts: [], leads: [] });
ok("no ads and no renters is empty", empty.empty);
const wide = buildRentalReport({ ...base, accountWideMonthCents: 3384 });
ok("account-wide spend named apart", wide.text.includes("Plus $33.84 in November 2026 for the whole account"));

ok("report month is the month before", JSON.stringify(reportMonthFor("2026-12-01")) === JSON.stringify({ monthStart: "2026-11-01", monthEnd: "2026-12-01", key: "2026-11" }));
ok("january reports december", reportMonthFor("2027-01-01").key === "2026-12");
ok("send now is this month", currentMonthFor("2026-11-23").key === "2026-11" && currentMonthFor("2026-12-05").monthEnd === "2027-01-01");
ok("short address keeps the unit", shortAddr("251 Manitoba St, Suite 124, Toronto, ON M8Y 0C7") === "251 Manitoba St, Suite 124");
ok("dollars", dollars(123456) === "$1,234.56");
const withPage = buildRentalReport({ ...base, pageUrl: "https://app.vacantless.com/r/x" });
ok("page link listed first", withPage.text.indexOf("Rental page with all photos") < withPage.text.indexOf("Kijiji: live since"));
ok("no page line with no ads", !buildRentalReport({ ...base, posts: [], pageUrl: "https://a/r/x" }).text.includes("Rental page"));

// Wiring
const row = CATALOG_MESSAGES.find((m) => m.id === "you-rental-report");
ok("catalog row", !!row && row.control.type === "switch" && (row.code.send ?? []).includes("sendRentalReportEmail"));
ok("switch listed", (MESSAGE_ORG_SWITCHES as readonly string[]).includes("rental_report_enabled"));
ok("also send to", (EXTRA_RECIPIENT_MESSAGE_IDS as readonly string[]).includes("you-rental-report"));
const mig = readFileSync("supabase/migrations/0321_rental_report.sql", "utf8");
ok("migration adds the columns", ["marketing_costs", "property_id", "rental_report_enabled", "report_next_steps", "rental_report_sent_month", "you-rental-report"].every((w) => mig.includes(w)));
const cron = readFileSync("app/api/cron/rental-report/route.ts", "utf8");
ok("cron obeys the switch", cron.includes("org.rental_report_enabled === false"));
ok("cron claims the month", cron.includes("rental_report_sent_month.neq."));
ok("cron sends to also-send-to", cron.includes('"you-rental-report"'));
ok("cron is in the sweep", readFileSync("lib/cron-sweeps.ts", "utf8").includes('"/api/cron/rental-report"'));
const act = readFileSync("app/dashboard/properties/[id]/report-actions.ts", "utf8");
ok("send now goes to the signed-in person only", act.includes("to_email: to as string") && !act.includes("loadExtraRecipients"));

console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
