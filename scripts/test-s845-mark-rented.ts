// Run with: npx tsx scripts/test-s845-mark-rented.ts
// S845: the warning before Mark as rented, the Rented chip, the green last step.
import { rentedPlan } from "../lib/mark-rented";
import { stageChip } from "../lib/unit-progress";
import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}
const posts = [
  { id: "z", portal: "zumper", status: "live", url: "https://z/1" },
  { id: "k", portal: "kijiji", status: "live", url: "https://k/1" },
  { id: "f", portal: "facebook", status: "live", url: "https://f/1" },
  { id: "p", portal: "facebook_feed", status: "live", url: "https://f/2" },
  { id: "x", portal: "rentals_ca", status: "removed", url: "https://r/1" },
];
const plan = rentedPlan({ posts, aliveChannels: ["zumper"], postingAllowed: true });
const by = (id: string) => plan.find((l) => l.postId === id);
ok("removed ads are not listed", plan.length === 4 && !by("x"));
ok("signed-in robot site is ours", by("z")?.byUs === true && by("z")!.line === "We take this ad down for you.");
ok("signed-out robot site is theirs", by("k")?.byUs === false && by("k")!.line.includes("not signed in"));
ok("Marketplace is theirs", by("f")?.byUs === false && by("f")!.line.includes("personal profile"));
ok("Page post is ours", by("p")?.byUs === true);
ok("no posting access: robot sites are theirs", rentedPlan({ posts, aliveChannels: ["zumper"], postingAllowed: false }).find((l) => l.postId === "z")?.byUs === false);
ok("no dashes", plan.every((l) => !/[–—]/.test(l.line)));

const now = new Date("2026-11-26T20:00:00Z");
const tap = { stage: "waiting_deposit", at: "2026-11-18T20:00:00Z", date: null, by: "Aaliyah" };
ok("leased beats Waiting for deposit", stageChip(tap, now, { leased: true })?.label === "Rented");
ok("not leased keeps the tap", stageChip(tap, now)?.label === "Waiting for deposit");
ok("leased keeps Lease signed", stageChip({ ...tap, stage: "lease_signed" }, now, { leased: true })?.label === "Lease signed");
ok("leased keeps a new turnover", stageChip({ ...tap, stage: "notice_given" }, now, { leased: true })?.label === "Tenant gave notice");

const action = readFileSync("app/dashboard/properties/actions.ts", "utf8");
const fn = action.slice(action.indexOf("export async function markPropertyRented"), action.indexOf("export async function unarchiveProperty"));
ok("action only moves an available rental", fn.includes('.eq("status", "available")') && fn.includes('.is("archived_at", null)'));
ok("winner is marked before renters are told", fn.indexOf("markLeaseWinner") < fn.indexOf("notifyWaitingRentersRented"));
ok("robot takedown is queued", fn.includes("queueRobotTakedowns") && fn.includes("takeDownFacebookPagePosts"));
const line = readFileSync("components/unit-journey-line.tsx", "utf8");
ok("all-done line ends green", line.includes("journey.current == null && i === journey.steps.length - 1"));

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
