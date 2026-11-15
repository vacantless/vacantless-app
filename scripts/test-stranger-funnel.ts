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
import type { AccountCounts } from "../lib/new-account-watch";

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
ok("visits table is closed to the public", /enable row level security/.test(mig) && /revoke all/.test(mig));

console.log(`\ntest-stranger-funnel: ${passed} passed, ${failed} failed (${passed + failed} total)`);
process.exit(failed ? 1 : 0);
