// Run with: npx tsx scripts/test-reports.ts
import {
  leadRank,
  reachedCount,
  pct,
  parseWindow,
  windowStartMs,
  filterByWindow,
  buildFunnel,
  buildChannelReport,
  buildPropertyReport,
  buildShowingReport,
  buildLeaseTiming,
  UNKNOWN_SOURCE,
  type LeadLite,
  type ShowingLite,
  type PropertyLite,
} from "../lib/reports";

let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL: ${name}\n  got  ${g}\n  want ${w}`);
  }
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 5, 15, 12, 0, 0); // 2026-06-15T12:00:00Z
const daysAgo = (n: number) => new Date(NOW - n * DAY).toISOString();
const inDays = (n: number) => new Date(NOW + n * DAY).toISOString();

// --- rank + helpers ---
eq("rank new", leadRank("new"), 1);
eq("rank leased", leadRank("leased"), 7);
eq("rank lost is 0", leadRank("lost"), 0);
eq("rank unknown is 0", leadRank("zzz"), 0);
eq("pct basic", pct(1, 4), 25);
eq("pct zero denom", pct(3, 0), 0);
eq("pct rounds", pct(2, 3), 67);

// --- window parsing ---
eq("parseWindow default", parseWindow(undefined), 90);
eq("parseWindow 30", parseWindow("30"), 30);
eq("parseWindow all", parseWindow("all"), "all");
eq("parseWindow junk", parseWindow("oops"), 90);
eq("windowStart all = 0", windowStartMs("all", NOW), 0);
eq("windowStart 30", windowStartMs(30, NOW), NOW - 30 * DAY);

function lead(p: Partial<LeadLite>): LeadLite {
  return {
    id: p.id ?? Math.random().toString(36).slice(2),
    source: p.source ?? null,
    status: p.status ?? "new",
    created_at: p.created_at ?? daysAgo(1),
    leased_date: p.leased_date ?? null,
    property_id: p.property_id ?? null,
  };
}

// --- reachedCount ---
const mix: LeadLite[] = [
  lead({ status: "new" }),
  lead({ status: "contacted" }),
  lead({ status: "booked" }),
  lead({ status: "showed" }),
  lead({ status: "leased" }),
  lead({ status: "lost" }),
];
eq("reached >=1 (all but none excluded)", reachedCount(mix, 1), 5); // lost ranks 0
eq("reached booked+ (rank>=4)", reachedCount(mix, 4), 3); // booked, showed, leased
eq("reached leased (rank>=7)", reachedCount(mix, 7), 1);

// --- window filtering ---
const winLeads = [
  lead({ created_at: daysAgo(5) }),
  lead({ created_at: daysAgo(45) }),
  lead({ created_at: daysAgo(120) }),
];
eq("filter 30d", filterByWindow(winLeads, windowStartMs(30, NOW)).length, 1);
eq("filter 90d", filterByWindow(winLeads, windowStartMs(90, NOW)).length, 2);
eq("filter all", filterByWindow(winLeads, windowStartMs("all", NOW)).length, 3);

// --- funnel ---
const funnelLeads: LeadLite[] = [
  lead({ status: "new" }),
  lead({ status: "new" }),
  lead({ status: "contacted" }),
  lead({ status: "booked" }),
  lead({ status: "showed" }),
  lead({ status: "leased" }),
  lead({ status: "lost" }),
];
const funnel = buildFunnel(funnelLeads);
eq("funnel total leads", funnel[0].count, 7);
eq("funnel contacted count (rank>=3)", funnel[1].count, 4); // contacted,booked,showed,leased
eq("funnel booked count (rank>=4)", funnel[2].count, 3);
eq("funnel showed count (rank>=5)", funnel[3].count, 2);
eq("funnel leased count (rank>=7)", funnel[4].count, 1);
eq("funnel leased ofTotal", funnel[4].ofTotal, pct(1, 7));
eq("funnel showed ofPrev (of booked)", funnel[3].ofPrev, pct(2, 3));
eq("empty funnel no NaN", buildFunnel([])[0].ofTotal, 0);

// --- channel report ---
const chLeads: LeadLite[] = [
  lead({ source: "kijiji", status: "leased" }),
  lead({ source: "kijiji", status: "booked" }),
  lead({ source: "kijiji", status: "new" }),
  lead({ source: "facebook", status: "showed" }),
  lead({ source: null, status: "new" }),
  lead({ source: "  ", status: "new" }), // whitespace → unknown
];
const channels = buildChannelReport(chLeads);
eq("channel count", channels.length, 3);
eq("channel sorted: kijiji first", channels[0].source, "kijiji");
eq("kijiji leads", channels[0].leads, 3);
eq("kijiji booked (rank>=4)", channels[0].booked, 2);
eq("kijiji leased", channels[0].leased, 1);
eq("kijiji lease rate", channels[0].leaseRate, pct(1, 3));
const unknown = channels.find((c) => c.source === UNKNOWN_SOURCE);
eq("unknown groups null+whitespace", unknown?.leads, 2);

// --- property report ---
const props: PropertyLite[] = [
  {
    id: "p1",
    address: "120 Dunlop",
    status: "available",
    rent_cents: 195000,
    created_at: daysAgo(60),
  },
  {
    id: "p2",
    address: "22 Pillette",
    status: "leased",
    rent_cents: 125000,
    created_at: daysAgo(10),
  },
];
const propLeads: LeadLite[] = [
  lead({ property_id: "p1", status: "leased" }),
  lead({ property_id: "p1", status: "booked" }),
  lead({ property_id: "p2", status: "new" }),
  lead({ property_id: null, status: "new" }), // unlinked, ignored in per-prop
];
const propShowings: ShowingLite[] = [
  { id: "s1", outcome: "attended", scheduled_at: daysAgo(2), created_at: daysAgo(3), property_id: "p1" },
  { id: "s2", outcome: "scheduled", scheduled_at: inDays(1), created_at: daysAgo(1), property_id: "p1" },
  { id: "s3", outcome: "no_show", scheduled_at: daysAgo(1), created_at: daysAgo(2), property_id: "p2" },
];
const propRows = buildPropertyReport(props, propLeads, propShowings);
eq("property rows", propRows.length, 2);
eq("p1 first (more leads)", propRows[0].id, "p1");
eq("p1 leads", propRows[0].leads, 2);
eq("p1 booked (rank>=4)", propRows[0].booked, 2);
eq("p1 leased", propRows[0].leased, 1);
eq("p1 showings", propRows[0].showings, 2);
eq("p2 showings", propRows[1].showings, 1);
eq("p2 leads", propRows[1].leads, 1);

// --- showing report ---
const showRep = buildShowingReport(propShowings, NOW);
eq("show total", showRep.total, 3);
eq("show attended", showRep.attended, 1);
eq("show no_show", showRep.noShow, 1);
eq("show scheduled", showRep.scheduled, 1);
eq("show upcoming (future scheduled)", showRep.upcoming, 1);
eq("attendance rate 1/(1+1)", showRep.attendanceRate, 50);
eq("empty show report no NaN", buildShowingReport([], NOW).attendanceRate, 0);

// --- lease timing ---
const timingLeads: LeadLite[] = [
  lead({ status: "leased", created_at: daysAgo(40), leased_date: daysAgo(20) }), // 20d
  lead({ status: "leased", created_at: daysAgo(30), leased_date: daysAgo(20) }), // 10d
  lead({ status: "leased", created_at: daysAgo(5), leased_date: null }), // no date
  lead({ status: "booked" }),
];
const timing = buildLeaseTiming(timingLeads);
eq("leased count", timing.leasedCount, 3);
eq("with date", timing.withDate, 2);
eq("avg days (20+10)/2", timing.avgDays, 15);
eq("no dated leases → null", buildLeaseTiming([lead({ status: "new" })]).avgDays, null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
