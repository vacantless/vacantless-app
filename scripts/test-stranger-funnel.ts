// Stranger funnel (S800, REVIEW-S799 item 8).
// Run: npx tsx scripts/test-stranger-funnel.ts
import { readFileSync } from "node:fs";
import {
  biggestDrop,
  buildFunnel,
  cleanPage,
  cleanVisitor,
  distinctVisitors,
  isBot,
} from "../lib/stranger-funnel";
import { isOwnAddress, type AccountCounts } from "../lib/new-account-watch";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

const acct = (o: Partial<AccountCounts>): AccountCounts => ({
  id: Math.random().toString(),
  name: "A",
  createdAt: "2026-11-10T00:00:00Z",
  plan: "free",
  subscriptionStatus: null,
  closedAt: null,
  rentals: 0,
  liveRentals: 0,
  viewingTimes: 0,
  enquiries: 0,
  bookings: 0,
  ...o,
});

const V1 = "11111111-1111-1111-1111-111111111111";
const V2 = "22222222-2222-2222-2222-222222222222";

// visitors
ok("a browser counts once across days", distinctVisitors([
  { visitor: V1, page: "home" },
  { visitor: V1, page: "home" },
  { visitor: V2, page: "home" },
  { visitor: V1, page: "signup" },
], "home") === 2);
ok("pages are counted apart", distinctVisitors([{ visitor: V1, page: "home" }], "signup") === 0);

// funnel
const steps = buildFunnel({
  homeVisitors: 200,
  signupVisitors: 40,
  accounts: [
    acct({}),
    acct({ rentals: 1 }),
    acct({ rentals: 2, liveRentals: 1 }),
    acct({ rentals: 1, liveRentals: 1, enquiries: 3 }),
    acct({ rentals: 1, liveRentals: 0, firstLiveAt: "2026-11-11T00:00:00Z", bookings: 1 }),
    acct({ rentals: 0, enquiries: 2 }), // an inquiry with no live rental is not a stranger reaching a renter
  ],
});
ok("six steps", steps.length === 6);
ok("labels in order", steps.map((s) => s.label).join("|") ===
  "Visited the homepage|Opened the sign-up page|Made an account|Added a rental|Set a rental live|Got a first renter");
ok("counts", steps.map((s) => s.count).join(",") === "200,40,6,4,3,2");
ok("first step has no kept share", steps[0].keptPct === null);
ok("kept share rounds", steps[1].keptPct === 20 && steps[2].keptPct === 15);
ok("never goes up as you read down", steps.every((s, i) => i < 2 || s.count <= steps[i - 1].count));
ok("a step under a zero step has no share", buildFunnel({ homeVisitors: 0, signupVisitors: 0, accounts: [] })[1].keptPct === null);
ok("a closed account is made but not counted further",
  buildFunnel({ homeVisitors: 1, signupVisitors: 1, accounts: [acct({ closedAt: "x", rentals: 1, liveRentals: 1, enquiries: 1 })] })
    .map((s) => s.count).join(",") === "1,1,1,0,0,0");

ok("biggest drop named", biggestDrop(steps) === 'Most people are lost between "Visited the homepage" and "Opened the sign-up page" (160).');
ok("nothing lost -> no line", biggestDrop(buildFunnel({ homeVisitors: 0, signupVisitors: 0, accounts: [] })) === null);

// input cleaning
ok("our own browser id is accepted", cleanVisitor(V1) === V1);
ok("upper case is folded", cleanVisitor(V1.toUpperCase()) === V1);
ok("junk id refused", cleanVisitor("abc") === null && cleanVisitor("") === null && cleanVisitor(null) === null);
ok("sql-ish id refused", cleanVisitor("11111111-1111-1111-1111-111111111111'; drop") === null);
ok("pages home and signup only", cleanPage("home") === "home" && cleanPage("signup") === "signup" && cleanPage("dashboard") === null && cleanPage(undefined) === null);
ok("bots are not people", isBot("Googlebot/2.1") && isBot("facebookexternalhit/1.1") && isBot("") && isBot(null) && isBot("curl/8.0"));
ok("a phone browser is a person", !isBot("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1"));

// S800e: the stranger-walk login is ours
ok("stranger-walk gmail is ours", isOwnAddress("noammuscovitch+s799@gmail.com") && isOwnAddress("NoamMuscovitch@gmail.com"));
ok("someone else's gmail is not ours", !isOwnAddress("landlord@gmail.com") && !isOwnAddress("noammuscovitch@gmail.com.evil.ca"));

// wiring
const route = readFileSync("app/api/funnel/visit/route.ts", "utf8");
ok("route skips signed-in visitors", /if \(user\) return res/.test(route));
ok("route skips bots first", route.indexOf("isBot(") < route.indexOf("createClient()"));
ok("route never fails a page (always 204)", /status: 204/.test(route));
const home = readFileSync("app/page.tsx", "utf8");
ok("homepage counts a visit", /<VisitBeacon page="home"/.test(home));
const signup = readFileSync("app/signup/page.tsx", "utf8");
ok("sign-up page counts a visit", /<VisitBeacon page="signup"/.test(signup));
const cron = readFileSync("app/api/cron/new-account-watch/route.ts", "utf8");
ok("daily email uses the shared loader", /loadOutsideAccounts\(/.test(cron));
const mig = readFileSync("supabase/migrations/0297_funnel_visits.sql", "utf8");
ok("visits table holds no names or emails", !/email|name/i.test(mig.split("\n").filter((l) => !l.startsWith("--")).join("\n")));
ok("server key may write and read visits", /grant select, insert on public\.funnel_visits to service_role/.test(mig));
ok("visits table is closed to the public", /enable row level security/.test(mig) && /revoke all/.test(mig));


// S835i: how far down the homepage people get.
{
  const { HOME_SECTIONS, cleanSections, sectionReach, halfwayLine, SECTION_COUNT_STARTED } = require("../lib/stranger-funnel");
  const ids: string[] = HOME_SECTIONS.map((x: { id: string }) => x.id);
  ok("sections start at the top", ids[0] === "top" && ids.length === 13);
  const pageNoComments = home.replace(/\/\*[\s\S]*?\*\//g, "");
  const band = readFileSync("components/savings-band.tsx", "utf8");
  ok("every section id is on the homepage", ids.slice(1).every((id) => (pageNoComments + band).includes(`id="${id}"`)));
  // The page renders its sections in the order of <main>; each id belongs to one component.
  const comp: Record<string, string> = { "stop-doing": "<StopDoing />", "what-it-replaces": "<SavingsBand />", video: "<SeeItWork />", leasing: "<LeasingProof />", automations: "<Automations />", "less-typing": "<LessTyping />", how: "<HowItWorks />", "little-things": "<LittleThings />", pricing: "<Pricing />", about: "<FounderBand />", questions: "<Questions />", closing: "<ClosingCta />" };
  const mainHtml = home.slice(home.indexOf("<main>"), home.indexOf("</main>"));
  const pos = ids.slice(1).map((id) => mainHtml.indexOf(comp[id]));
  ok("section order matches the page", pos.every((p, i) => p > 0 && (i === 0 || pos[i - 1] < p)));
  ok("homepage hands the beacon its sections", /<VisitBeacon page="home" sections=\{HOME_SECTIONS/.test(home));
  ok("cleanSections keeps known ids once", JSON.stringify(cleanSections("top,video,video,evil,<x>, pricing")) === JSON.stringify(["top", "video", "pricing"]));
  ok("cleanSections on nothing", cleanSections(null).length === 0 && cleanSections("").length === 0);
  const rows = [
    { visitor: "a", section: "top" },
    { visitor: "b", section: "top" },
    { visitor: "b", section: "video" },
    { visitor: "c", section: "pricing" }, // jumped by a link: still got past the sections above
    { visitor: "d", section: "top" },
    { visitor: "d", section: "closing" },
    { visitor: "d", section: "nope" },
  ];
  const reach = sectionReach(rows);
  const at = (id: string) => reach.find((r: { id: string }) => r.id === id);
  ok("everyone counts at the top", at("top").count === 4 && at("top").pct === 100);
  ok("furthest section counts the ones above it", at("video").count === 3 && at("pricing").count === 2 && at("closing").count === 1);
  ok("reach never rises down the page", reach.every((r: { count: number }, i: number) => i === 0 || r.count <= reach[i - 1].count));
  ok("percent of those who loaded", at("pricing").pct === 50 && at("closing").pct === 25);
  ok("no visitors, no percent", sectionReach([]).every((r: { count: number; pct: number | null }) => r.count === 0 && r.pct === null));
  ok("too few visitors, no headline", halfwayLine(reach) === null);
  const many = Array.from({ length: 30 }, (_, i) => ({ visitor: `v${i}`, section: i < 10 ? "pricing" : "video" }));
  ok("names where half are gone", halfwayLine(sectionReach(many)) === 'Half of visitors are gone before "It already runs on our own rentals".');
  const deep = Array.from({ length: 30 }, (_, i) => ({ visitor: `v${i}`, section: "closing" }));
  ok("says when most reach the bottom", halfwayLine(sectionReach(deep)) === "More than half of visitors reach the bottom of the page.");
  ok("start date is a date", /^\d{4}-\d{2}-\d{2}$/.test(SECTION_COUNT_STARTED));
  const seenRoute = readFileSync("app/api/funnel/seen/route.ts", "utf8");
  ok("seen route skips bots first", seenRoute.indexOf("isBot(") < seenRoute.indexOf("createClient()"));
  ok("seen route needs the browser id the visit route set", /cleanVisitor\(req\.cookies\.get\("vl_vid"\)/.test(seenRoute) && !/cookies\.set/.test(seenRoute));
  ok("seen route skips signed-in visitors", /if \(user\) return res/.test(seenRoute));
  ok("seen route always answers 204", /status: 204/.test(seenRoute) && !/status: [45]\d\d/.test(seenRoute));
  const beacon = readFileSync("components/visit-beacon.tsx", "utf8");
  ok("sections wait for the visit call", beacon.indexOf("/api/funnel/visit") < beacon.indexOf("watchSections(sections)") && /\.then\(\(\) => \{/.test(beacon));
  ok("beacon sends what is left when the page is left", /pagehide/.test(beacon) && /visibilitychange/.test(beacon));
  const mig2 = readFileSync("supabase/migrations/0328_funnel_sections.sql", "utf8");
  const sql = mig2.split("\n").filter((l) => !l.startsWith("--")).join("\n");
  ok("sections table holds no names or emails", !/email|name/i.test(sql));
  ok("sections table is closed to the public", /enable row level security/.test(sql) && /revoke all/.test(sql) && /grant select, insert on public\.funnel_sections to service_role/.test(sql));
  ok("sections migration drops nothing", !/\bdrop\b/i.test(sql));
  const adminSec = readFileSync("app/dashboard/admin/stranger-funnel-section.tsx", "utf8");
  ok("admin console shows the reach table", /sectionReach\(/.test(adminSec) && /How far down the homepage/.test(adminSec));
}

console.log(`\ntest-stranger-funnel: ${passed} passed, ${failed} failed (${passed + failed} total)`);
process.exit(failed ? 1 : 0);
