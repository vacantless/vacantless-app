// S836b: the monthly account summary. Run: npx tsx scripts/test-s836b-account-report.ts
import { readFileSync, writeFileSync } from "node:fs";
import { buildAccountReport, adsNotInBooks, signedDollars, expenseLines, marginPct, type AccountReportInput } from "../lib/account-report";
import { SWEEP_PATHS } from "../lib/cron-sweeps";
import { buildCostAdvice, buildSiteCosts, firstPaidBySite } from "../lib/channel-costs";
import { CATALOG_MESSAGES } from "../lib/message-catalog";
import type { LeadLite } from "../lib/reports";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}${extra !== undefined ? ` ${JSON.stringify(extra)}` : ""}`);
  }
}

const lead = (id: string, pid: string | null, at: string, source = "Kijiji", status: LeadLite["status"] = "new"): LeadLite => ({
  id,
  source,
  status,
  created_at: at,
  leased_date: null,
  property_id: pid,
});

const base: AccountReportInput = {
  orgName: "Test Rentals",
  monthStart: "2026-11-01",
  monthEnd: "2026-12-01",
  today: "2026-12-01",
  properties: [
    { id: "a", address: "10 Main St, Unit 1, Toronto, ON", status: "available", availableSince: "2026-11-11" },
    { id: "b", address: "10 Main St, Unit 2, Toronto, ON", status: "available", availableSince: "2026-10-02" },
    { id: "c", address: "12 Elm St, Toronto, ON", status: "leased", availableSince: null },
    { id: "d", address: "14 Oak St, Toronto, ON", status: "leased", availableSince: null },
    { id: "e", address: "16 Pine St, Toronto, ON", status: "off_market", availableSince: null },
    { id: "f", address: "18 Ash St, Toronto, ON", status: "draft", availableSince: null },
  ],
  outcomes: [
    { propertyId: "c", address: "12 Elm St, Toronto, ON", availableSince: "2026-10-20T12:00:00Z", leasedAt: "2026-11-05T15:00:00Z", daysOnMarket: 16 },
    { propertyId: "c", address: "12 Elm St, Toronto, ON", availableSince: "2026-10-20T12:00:00Z", leasedAt: "2026-11-06T15:00:00Z", daysOnMarket: 17 },
    { propertyId: "d", address: "14 Oak St, Toronto, ON", availableSince: "2026-10-01T12:00:00Z", leasedAt: "2026-10-30T15:00:00Z", daysOnMarket: 29 },
  ],
  leads: [
    lead("1", "a", "2026-11-12T10:00:00Z"),
    lead("2", "a", "2026-11-20T10:00:00Z", "Facebook Marketplace", "booked"),
    lead("3", "b", "2026-10-15T10:00:00Z"),
    lead("4", "b", "2026-11-03T10:00:00Z"),
    lead("5", "b", "2026-09-01T10:00:00Z"),
    lead("6", "c", "2026-10-25T10:00:00Z", "Kijiji", "booked"),
    lead("7", "c", "2026-11-02T10:00:00Z"),
    lead("8", "c", "2026-11-25T10:00:00Z"),
  ],
  showings: [
    { propertyId: "a", scheduledAt: "2026-11-22T18:00:00Z", outcome: "attended" },
    { propertyId: "a", scheduledAt: "2026-11-23T18:00:00Z", outcome: "no_show" },
    { propertyId: "a", scheduledAt: "2026-11-24T18:00:00Z", outcome: "cancelled" },
    { propertyId: "c", scheduledAt: "2026-11-03T18:00:00Z", outcome: "attended" },
  ],
  costs: [
    { portal: "kijiji", amount_cents: 3384, spent_on: "2026-11-11" },
    { portal: "kijiji", amount_cents: 3384, spent_on: "2026-10-02" },
  ],
  books: {
    month: { rentCents: 450000, expenseCents: 60000, rentCount: 2, expenseCount: 3, categories: [{ label: "Repairs", cents: 40000 }, { label: "Utilities", cents: 20000 }] },
    ytd: {
      rentCents: 4500000,
      expenseCents: 900000,
      rentCount: 20,
      expenseCount: 30,
      categories: [
        { label: "Property tax", cents: 400000 },
        { label: "Repairs", cents: 250000 },
        { label: "Insurance", cents: 120000 },
        { label: "Utilities", cents: 80000 },
        { label: "Cleaning", cents: 30000 },
        { label: "Supplies", cents: 20000 },
      ],
    },
  },
  reportsUrl: "https://app.vacantless.com/dashboard/reports",
};

const r = buildAccountReport(base);
const f = r.facts;
ok("tracked counts rented and for rent", f.trackedUnits === 4, f.trackedUnits);
ok("vacant", f.vacantUnits === 2);
ok("off market named, draft not", f.offMarketUnits === 1, f.offMarketUnits);
ok("vacancy rate 50%", f.vacancyRatePct === 50);
ok("rented once per rental, in the month only", f.rentedMonth === 1, f.rentedMonth);
ok("latest rented row wins", f.rentedAvgDays === 17, f.rentedAvgDays);
ok("on the market 2", f.onMarket === 2);
ok("longest on market from Oct 2 to Dec 1", f.longestOnMarketDays === 60, f.longestOnMarketDays);
ok("three unit rows", f.units.length === 3, f.units.map((u) => u.address));
ok("rented first", f.units[0].propertyId === "c" && f.units[0].state === "rented");
ok("then longest on market", f.units[1].propertyId === "b" && f.units[2].propertyId === "a");
const c = f.units[0];
ok("rented: month inquiries", c.inquiriesMonth === 2, c);
ok("rented: to date stops at the rent day", c.inquiriesToDate === 2, c);
ok("rented: showings", c.showingsBooked === 1 && c.showingsHeld === 1);
const b = f.units[1];
ok("on market: since it came on", b.inquiriesToDate === 2 && b.inquiriesMonth === 1, b);
const a = f.units[2];
ok("cancelled showing not counted", a.showingsBooked === 2 && a.showingsHeld === 1, a);
ok("days on market so far", a.days === 20, a.days);
ok("ads this month", f.adsMonthCents === 3384);
ok("ads this year", f.adsYtdCents === 6768);
ok("net = rent - expenses - ads not in books", f.money?.month.netCents === 450000 - 60000 - 3384, f.money);
ok("ytd net", f.money?.ytd.netCents === 4500000 - 900000 - 6768);
ok("kijiji per renter", f.sites.find((s) => s.site === "Kijiji")?.perRenterCents === Math.round(6768 / 7), f.sites);
ok("subject", r.subject === "Your rentals in November 2026: 2 on the market, 1 rented", r.subject);
ok("html has the four tiles", ["Vacancy rate", "Rented in November", "On the market", "Net in November"].every((w) => r.html.includes(w)));
ok("html has the sections", ["Each unit", "Income and expenses", "What each site cost you this year", "Where to spend"].every((w) => r.html.includes(w)));
ok("ad line shows when ads are not in the books", r.html.includes("Site ad costs not in your books"));
ok("no em dash", !r.html.includes("—") && !r.text.includes("—") && !r.subject.includes("—"));
ok("not empty", !r.empty);

// Ads already entered as an expense are not counted twice.
const r2 = buildAccountReport({ ...base, adExpenses: [{ amountCents: 3384, day: "2026-11-11" }, { amountCents: 3384, day: "2026-10-02" }] });
ok("matched ads drop out", r2.facts.money?.ytd.adsNotInBooksCents === 0 && !r2.html.includes("Site ad costs not in your books"));
ok("one expense matches one cost", adsNotInBooks([{ amount_cents: 100, spent_on: "2026-11-01" }, { amount_cents: 100, spent_on: "2026-11-01" }], [{ amountCents: 100, day: "2026-11-01" }]).length === 1);

// No books on the plan, and books with no records: say so, never $0.
const r3 = buildAccountReport({ ...base, books: null });
ok("no books: no money", r3.facts.money === null && r3.html.includes("Books are part of Starter and up"));
const zero = { rentCents: 0, expenseCents: 0, rentCount: 0, expenseCount: 0 };
const r4 = buildAccountReport({ ...base, books: { month: zero, ytd: zero } });
ok("books kept elsewhere", r4.facts.money?.hasRecords === false && r4.html.includes("No books kept here") && r4.html.includes("No rent or expenses are recorded here this year"));
ok("no $0 net tile", !r4.html.includes(">$0<"));

// No costs this year: the advice says what to do.
const r5 = buildAccountReport({ ...base, costs: [] });
ok("no costs advice", r5.facts.advice.some((t) => t.startsWith("No site costs are entered")));

// Nothing at all: not sent.
const r6 = buildAccountReport({ ...base, properties: [], outcomes: [], leads: [], showings: [], costs: [] });
ok("empty account not sent", r6.empty);

// Expense lines: biggest four this year, the rest as Other costs, adding up.
const lines = expenseLines(base.books!.month.categories!, base.books!.ytd.categories!);
ok("five lines", lines.length === 5 && lines[4].label === "Other costs", lines);
ok("lines add up for the year", lines.reduce((s, l) => s + l.ytdCents, 0) === 900000);
ok("lines add up for the month", lines.reduce((s, l) => s + l.monthCents, 0) === 60000, lines);
ok("five categories need no Other line", expenseLines([], base.books!.ytd.categories!.slice(0, 5)).every((l) => l.label !== "Other costs"));
ok("html lists categories", r.html.includes("Property tax") && r.html.includes("Other costs"));
ok("margin", marginPct(50, 100) === "50.0%" && marginPct(-10, 0) === null);
ok("html shows margin", r.html.includes(">Margin<"));
const loss = buildAccountReport({ ...base, books: { month: { ...base.books!.month, expenseCents: 900000 }, ytd: base.books!.ytd } });
ok("a loss shows red", loss.html.includes("#b42318") && !r.html.includes("color:#b42318"));

// Advice: books its own viewings -> judged by renters; paid in the last 2 weeks -> too early.
const kRows = buildSiteCosts(
  [
    { source: "Kijiji", leads: 2, booked: 0, showed: 0, leased: 0, leaseRate: 0 },
    { source: "Facebook Marketplace", leads: 3, booked: 0, showed: 0, leased: 0, leaseRate: 0 },
  ],
  [{ portal: "kijiji", amount_cents: 6768, spent_on: "2026-11-22" }],
);
const early = buildCostAdvice(kRows, { viewingsByRequest: true, firstPaid: firstPaidBySite([{ portal: "kijiji", amount_cents: 6768, spent_on: "2026-11-22" }]), today: "2026-11-23" });
ok("too early to judge", early.some((a) => a.text === "You paid $67.68 to Kijiji 1 day ago. Too early to judge; 2 renters so far."), early);
ok("no booked-viewings line when booking yourself", early.every((a) => !a.text.includes("booked viewing")), early);
ok("free by renters", early.some((a) => a.text === "Facebook Marketplace cost you nothing and brought 3 renters."));
const later = buildCostAdvice(kRows, { viewingsByRequest: true, firstPaid: { Kijiji: "2026-11-01" }, today: "2026-12-01" });
ok("judged by renters after two weeks", later.some((a) => a.text === "Your cheapest paid renter: Kijiji, $33.84 per renter.") && !later.some((a) => a.tone === "fix"), later);
const none = buildCostAdvice(buildSiteCosts([], [{ portal: "kijiji", amount_cents: 3384, spent_on: "2026-10-01" }]), { viewingsByRequest: true, firstPaid: { Kijiji: "2026-10-01" }, today: "2026-12-01" });
ok("paid with no renters is a fix", none.some((a) => a.tone === "fix" && a.text.includes("got no renters")));
ok("old behaviour without options", buildCostAdvice(kRows).some((a) => a.text.includes("no booked viewings")));
ok("summary passes the options", readFileSync("lib/account-report.ts", "utf8").includes("viewingsByRequest: input.viewingsByRequest, firstPaid: firstPaidBySite(input.costs), today"));
ok("Reports passes the options", /buildCostAdvice\(siteCosts, \{[\s\S]*?viewingsByRequest[\s\S]*?firstPaid: firstPaidBySite\(allCosts\)/.test(readFileSync("app/dashboard/reports/page.tsx", "utf8")));
ok("sweep reads the flag", readFileSync("app/api/cron/account-report/route.ts", "utf8").includes("viewings_by_request: org.viewings_by_request"));

ok("signed dollars", signedDollars(-125000) === "-$1,250" && signedDollars(125000) === "$1,250");

// Wiring.
const route = readFileSync("app/api/cron/account-report/route.ts", "utf8");
ok("route in the sweep", (SWEEP_PATHS as readonly string[]).includes("/api/cron/account-report"));
ok("route obeys the switch", route.includes("org.rental_report_enabled === false"));
ok("route skips closed accounts", route.includes("org.closed_at"));
ok("route claims the month", route.includes("account_report_sent_month.neq."));
ok("route hands back on failure", /outcome === "failed"\)\s*\{[\s\S]*?account_report_sent_month: org\.account_report_sent_month/.test(route));
ok("route says when not sent", /if \(failed\.length\)[\s\S]*?ok: false/.test(route));
ok("route uses also-send-to", route.includes('"you-rental-report"') && route.includes("withExtras("));
ok("dry never claims", route.indexOf("if (dry) continue;") < route.indexOf("account_report_sent_month: range.key"));
const mig = readFileSync("supabase/migrations/0329_account_report.sql", "utf8");
ok("migration adds the claim column", mig.includes("add column if not exists account_report_sent_month"));
ok("migration is additive", !/\bdrop\b/i.test(mig.replace(/--.*$/gm, "")));
const server = readFileSync("lib/account-report-server.ts", "utf8");
ok("books from the income statement model", server.includes("buildIncomeStatement(") && server.includes("expenseToCostRow("));
ok("books only on plans that have them", server.includes("canUseBooks("));
ok("archived rentals left out", server.includes("!p.archived_at"));
ok("every read scoped to the account", (server.match(/\.eq\("organization_id", orgId\)/g) ?? []).length === 8);
const row = CATALOG_MESSAGES.find((m) => m.id === "you-rental-report");
ok("catalog names the summary", !!row && (row.includes ?? "").includes("vacancy rate") && row.when.includes("One summary for the account"));
const page = readFileSync("app/dashboard/reports/summary/page.tsx", "utf8");
ok("summary page uses the same builder", page.includes("loadAccountReport(") && page.includes("report.html"));
ok("Reports links to the summary", readFileSync("app/dashboard/reports/page.tsx", "utf8").includes('href="/dashboard/reports/summary"'));

if (process.env.WRITE_PREVIEW) writeFileSync(process.env.WRITE_PREVIEW, `<!doctype html><html><body style="margin:0;padding:24px;background:#fff">${r.html}</body></html>`);

console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
