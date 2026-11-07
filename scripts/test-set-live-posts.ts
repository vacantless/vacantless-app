// Run with: npx tsx scripts/test-set-live-posts.ts
// S761: Set Live queues every connected robot site on its own (REVIEW-S761 item 1).
import { readFileSync } from "node:fs";
import { robotSitesToPostAtSetLive, setLiveAudit, SET_LIVE_LEAVE_ALONE_STATUSES } from "../lib/set-live-posts";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}
const allOn = { kijiji: "linked", rentals_ca: "linked", zumper: "linked" };
const base = { postingAllowed: true, autopilot: true as boolean | null, tileStateByChannel: allOn };

// 1. Everything connected, setting on, nothing posted yet: all three queue, in order.
ok("all three", robotSitesToPostAtSetLive(base).join(",") === "kijiji,rentals_ca,zumper");

// 2. No Posting add-on: nothing (the robot is the paid part).
ok("no add-on", robotSitesToPostAtSetLive({ ...base, postingAllowed: false }).length === 0);

// 3. Standing setting off: nothing (the landlord asked to approve each ad).
ok("setting off", robotSitesToPostAtSetLive({ ...base, autopilot: false }).length === 0);
ok("setting unknown", robotSitesToPostAtSetLive({ ...base, autopilot: null }).length === 0);

// 4. A signed-out or never-signed-in site is skipped, the others go.
ok("dead session skipped", robotSitesToPostAtSetLive({ ...base, tileStateByChannel: { ...allOn, zumper: "dead_session" } }).join(",") === "kijiji,rentals_ca");
ok("never signed in skipped", robotSitesToPostAtSetLive({ ...base, tileStateByChannel: { kijiji: "linked" } }).join(",") === "kijiji");
ok("needs authorization skipped", robotSitesToPostAtSetLive({ ...base, tileStateByChannel: { ...allOn, kijiji: "connected_needs_authorization" } }).join(",") === "rentals_ca,zumper");
// "checking" is not a sign-in state: the worker parks it at needs_login if the session is dead.
ok("checking still queues", robotSitesToPostAtSetLive({ ...base, tileStateByChannel: { ...allOn, rentals_ca: "checking" } }).length === 3);

// 5. A hidden site for this org never queues.
ok("hidden skipped", robotSitesToPostAtSetLive({ ...base, hiddenFor: (c) => c === "rentals_ca" }).join(",") === "kijiji,zumper");

// 6. Items already up, in flight or waiting for the landlord are left alone.
for (const s of SET_LIVE_LEAVE_ALONE_STATUSES) {
  ok(`leave alone: ${s}`, robotSitesToPostAtSetLive({ ...base, existingItemStatusByChannel: { kijiji: s } }).join(",") === "rentals_ca,zumper");
}
ok("a skipped or failed item posts again", robotSitesToPostAtSetLive({ ...base, existingItemStatusByChannel: { kijiji: "skipped", zumper: "failed", rentals_ca: "rejected" } }).length === 3);

// 7. The audit line: plain words, no robot or extension, no dash.
const audit = setLiveAudit("Kijiji");
ok("audit names the site and Set Live", /Kijiji/.test(audit) && /Set Live/.test(audit));
ok("audit has no em dash", !/—/.test(audit));
ok("audit has no mechanism word", !/robot|extension|helper|worker/i.test(audit));

// 8. The wiring: publishProperty calls the helper after the Page autofire.
const actions = readFileSync("app/dashboard/properties/actions.ts", "utf8");
ok("publishProperty posts robot sites", /postRobotSitesAfterPageLive\(/.test(actions));
ok("helper is imported", /from "@\/lib\/set-live-posts"/.test(actions));
const idx = actions.indexOf("export async function publishProperty");
const body = actions.slice(idx, idx + 6000);
ok("called inside publishProperty after the Page autofire", body.indexOf("publishAuthorizedInstantChannelsAfterPageLive") < body.indexOf("postRobotSitesAfterPageLive"));

console.log(`set-live-posts: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
