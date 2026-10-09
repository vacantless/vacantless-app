// Run with: npx tsx scripts/test-new-account-watch.ts
import {
  buildWatchEmail,
  buildWatchRows,
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

console.log(`\nnew-account-watch: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
