import { buildAfterLiveSummary } from "../lib/after-live-summary";
import { stage4BadgeKey, afterLiveHasActivity } from "../lib/stage4-after-live";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  x ${name}`);
  }
}

ok("not taken down -> LIVE badge", stage4BadgeKey(false) === "badgeLive");
ok("taken down -> REMOVED badge", stage4BadgeKey(true) === "badgeRemoved");

ok("null summary -> no activity", afterLiveHasActivity(null) === false);
ok(
  "empty summary -> no activity",
  afterLiveHasActivity(buildAfterLiveSummary([], [])) === false,
);

const summary = buildAfterLiveSummary(
  [
    {
      id: "1",
      organization_id: "o",
      property_id: "p",
      source: "kijiji",
      name: "Sam",
      email: null,
      phone: null,
      created_at: "2026-07-26T10:00:00Z",
    },
  ],
  [{ portal: "kijiji", status: "removed", created_at: "2026-07-25T00:00:00Z" }],
);

ok("built summary reports activity", afterLiveHasActivity(summary) === true);
ok("lead mapped from source", summary.leads[0]?.channel === "kijiji");
ok("removed post -> takenDown", summary.channels[0]?.takenDown === true);
ok("all channels removed -> leasedUp", summary.leasedUp === true);

const stillLive = buildAfterLiveSummary(
  [],
  [{ portal: "kijiji", status: "live", created_at: "2026-07-25T00:00:00Z" }],
);
ok("live post -> not takenDown", stillLive.channels[0]?.takenDown === false);
ok("live channel -> not leasedUp", stillLive.leasedUp === false);

console.log(`\nstage4-after-live: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
