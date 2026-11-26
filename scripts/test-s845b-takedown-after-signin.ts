// Run with: npx tsx scripts/test-s845b-takedown-after-signin.ts
// S845b: a sign-in queues the takedowns that waited on it.
import { takedownsOwedAfterSignin } from "../lib/robot-takedown";
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
  { propertyId: "rented", status: "live", url: "https://z/1" },
  { propertyId: "open", status: "live", url: "https://z/2" },
  { propertyId: "tried", status: "live", url: "https://z/3" },
  { propertyId: "gone", status: "removed", url: "https://z/4" },
  { propertyId: "nolink", status: "live", url: " " },
];
const owed = takedownsOwedAfterSignin({ posts, offMarketIds: ["rented", "tried", "gone", "nolink"], recentlyTriedIds: ["tried"] });
ok("only the rented rental with a live ad", owed.length === 1 && owed[0] === "rented");
ok("an open rental's ad is never touched", !owed.includes("open"));
ok("nothing owed, nothing queued", takedownsOwedAfterSignin({ posts, offMarketIds: [], recentlyTriedIds: [] }).length === 0);
const action = readFileSync("app/dashboard/site-signin/[channel]/actions.ts", "utf8");
ok("queued before the robot is woken", action.indexOf("queueTakedownsAfterSignin({") < action.indexOf("void (signinOpensAtHome(ch)") && action.includes("queueTakedownsAfterSignin({"));
console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
