// Run with: npx tsx scripts/test-new-account-watch.ts
import {
  buildWatchEmail,
  buildWatchRows,
  durationWords,
  firstLiveFooter,
  median,
  minutesToLive,
  isOwnAddress,
  isOwnTestAccount,
  isStalled,
  stageOf,
  type AccountCounts,
} from "../lib/new-account-watch";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}

const now = new Date("2026-10-09T12:00:00Z");
const ago = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
const base: AccountCounts = {
  id: "a",
  name: "Test Rentals",
  createdAt: ago(0),
  plan: "free",
  subscriptionStatus: null,
  closedAt: null,
  rentals: 0,
  liveRentals: 0,
  viewingTimes: 0,
  enquiries: 0,
  bookings: 0,
};

ok("no rental -> signed_up", stageOf(base) === "signed_up");
ok("draft only -> rental_added", stageOf({ ...base, rentals: 1 }) === "rental_added");
ok("live no times -> live", stageOf({ ...base, rentals: 1, liveRentals: 1 }) === "live");
ok("times -> viewing_times", stageOf({ ...base, rentals: 1, liveRentals: 1, viewingTimes: 2 }) === "viewing_times");
ok("enquiry -> first_enquiry", stageOf({ ...base, rentals: 1, liveRentals: 1, viewingTimes: 2, enquiries: 1 }) === "first_enquiry");
ok("booking -> first_booking", stageOf({ ...base, rentals: 1, liveRentals: 1, viewingTimes: 2, enquiries: 1, bookings: 1 }) === "first_booking");
ok("booking without times still counts", stageOf({ ...base, rentals: 1, liveRentals: 1, bookings: 1 }) === "first_booking");

ok("setup stall at 2 days", isStalled("signed_up", 2) && !isStalled("signed_up", 1));
ok("enquiry wait gets 7 days", !isStalled("viewing_times", 6) && isStalled("viewing_times", 7));
ok("booked never stalled", !isStalled("first_booking", 14));

const rows = buildWatchRows(
  [
    { ...base, id: "new", name: "Fresh", createdAt: ago(0) },
    { ...base, id: "stuck", name: "Stuck", createdAt: ago(3), plan: "growth", subscriptionStatus: "active" },
    { ...base, id: "old", name: "Old", createdAt: ago(20) },
    { ...base, id: "quiet", name: "Quiet", createdAt: ago(1) },
    { ...base, id: "gone", name: "Gone", createdAt: ago(5), closedAt: ago(1) },
  ],
  now,
  new Set(["quiet"]),
);
ok("old and quiet excluded", rows.length === 3 && !rows.some((r) => r.id === "old" || r.id === "quiet"));
ok("stalled sorted first", rows[0].id === "stuck" && rows[0].stalled);
ok("paid shown as Growth", rows[0].line.includes("(Growth, signed up 3 days ago)"));
ok("nudge marker", rows[0].line.startsWith("NEEDS A NUDGE."));
ok("closed not stalled", rows.find((r) => r.id === "gone")?.stalled === false);
ok("closed line", rows.find((r) => r.id === "gone")?.line.includes("closed the account") === true);
ok("today wording", rows.find((r) => r.id === "new")?.line.includes("signed up today") === true);

const email = buildWatchEmail(rows);
ok("subject counts", email?.subject === "New accounts: 3, 1 need a nudge");
ok("no em dash", !(email?.body ?? "").includes("—") && !(email?.subject ?? "").includes("—"));
ok("empty -> null", buildWatchEmail([]) === null);
ok("all moving subject", buildWatchEmail(rows.filter((r) => !r.stalled))?.subject === "New accounts: 2, all moving");

// S722: our own test sign-ups are left out; a real landlord is not.
ok("s712 alias is ours", isOwnAddress("nmuscovitch+s712@hotmail.com"));
ok("stranger5 alias is ours", isOwnAddress("noam+stranger5@royallepage.ca"));
ok("vacantless address is ours", isOwnAddress("admin@vacantless.com"));
ok("a landlord is not ours", !isOwnAddress("landlord@gmail.com"));
ok("lookalike is not ours", !isOwnAddress("noam@royallepage.ca.evil.com"));
ok("other noam is not ours", !isOwnAddress("noam.smith@gmail.com"));
ok("all ours -> test account", isOwnTestAccount(["nmuscovitch+s712@hotmail.com"]));
ok("one real login -> customer", !isOwnTestAccount(["noam+stranger5@royallepage.ca", "renter@x.com"]));
ok("no logins -> not assumed ours", !isOwnTestAccount([]));
ok("missing email -> customer", !isOwnTestAccount(["nmuscovitch+a@hotmail.com", ""]));

// S723: the source line.
{
  const base = { name: "Src", createdAt: new Date().toISOString(), plan: "free", subscriptionStatus: null, closedAt: null, rentals: 1, liveRentals: 1, viewingTimes: 1, enquiries: 1, bookings: 1 };
  const r = buildWatchRows([{ ...base, id: "src", source: "Google ads (campaign x)" }, { ...base, id: "nosrc" }], new Date(), new Set());
  ok("source shown", r.find((x) => x.id === "src")?.line.endsWith("Came from: Google ads (campaign x).") === true);
  ok("no source, no line", r.find((x) => x.id === "nosrc")?.line.includes("Came from") === false);
}

// S767: time to first live.
{
  ok("minutes", minutesToLive("2026-11-09T10:00:00Z", "2026-11-09T10:12:00Z") === 12);
  ok("not live -> null", minutesToLive("2026-11-09T10:00:00Z", null) === null);
  ok("never negative", minutesToLive("2026-11-09T10:00:00Z", "2026-11-01T10:00:00Z") === 0);
  ok("words minutes", durationWords(12) === "12 minutes" && durationWords(1) === "1 minute");
  ok("words hours", durationWords(95) === "2 hours" && durationWords(60) === "1 hour");
  ok("words days", durationWords(3000) === "2 days");
  ok("median odd", median([30, 10, 20]) === 20);
  ok("median even", median([10, 20, 30, 40]) === 25);
  ok("median empty", median([]) === null);
  const now = new Date("2026-11-20T00:00:00Z");
  const base = { name: "L", plan: "free", subscriptionStatus: null, closedAt: null, rentals: 1, liveRentals: 1, viewingTimes: 1, enquiries: 0, bookings: 0 };
  const accts: AccountCounts[] = [
    { ...base, id: "a", createdAt: "2026-11-18T10:00:00Z", firstLiveAt: "2026-11-18T10:20:00Z" },
    { ...base, id: "b", createdAt: "2026-11-15T10:00:00Z", firstLiveAt: "2026-11-15T12:00:00Z" },
    { ...base, id: "c", createdAt: "2026-11-10T10:00:00Z", firstLiveAt: null },
    { ...base, id: "old", createdAt: "2026-09-01T10:00:00Z", firstLiveAt: "2026-09-10T10:00:00Z" },
  ];
  ok("footer", firstLiveFooter(accts, now) === "Time to first live rental, last 30 days: median 1 hour, across 2 accounts that went live.");
  ok("footer none", firstLiveFooter([accts[2]], now) === null);
  const rows = buildWatchRows(accts, now, new Set());
  ok("row says live in", rows.find((r) => r.id === "a")?.line.includes("Live in 20 minutes.") === true);
  ok("row not live says nothing", rows.find((r) => r.id === "c")?.line.includes("Live in") === false);
  const email = buildWatchEmail(rows, firstLiveFooter(accts, now));
  ok("footer in body", email?.body.endsWith("across 2 accounts that went live.") === true);
  ok("no footer, body unchanged", buildWatchEmail(rows)?.body.endsWith("\n\n") === false);
}

console.log(`\nnew-account-watch: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
