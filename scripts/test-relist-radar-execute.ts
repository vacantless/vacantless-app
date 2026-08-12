// Unit/source tests for S642 Relist Radar Slice 3 free execution.
// Run: npx tsx scripts/test-relist-radar-execute.ts
import { readFileSync } from "node:fs";
import { getNotificationEvent } from "../lib/notifications";
import {
  RELIST_RADAR_AUTOPILOT_RECAP_EVENT_KEY,
  buildRelistRadarAutopilotRecap,
  relistRadarFreeExecutionGate,
} from "../lib/relist-radar";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${name}`);
  }
}

const baseGate = {
  channelKey: "kijiji",
  paid: false,
  decision: null as string | null,
  propertyStatus: "available",
  cycleDate: "2026-08-11",
  today: "2026-08-11",
  automationAuthorized: true,
  accountStatus: "connected",
  standingConsent: false,
  alreadyEnqueued: false,
};

ok(
  "free no-response cycle enqueues",
  relistRadarFreeExecutionGate(baseGate).shouldEnqueue,
);
ok(
  "keep-live cycle enqueues",
  relistRadarFreeExecutionGate({ ...baseGate, decision: "kept_live" }).shouldEnqueue,
);
ok(
  "standing consent enqueues",
  relistRadarFreeExecutionGate({ ...baseGate, standingConsent: true }).reason ===
    "standing_autopilot",
);
ok(
  "skipped cycle does not enqueue",
  !relistRadarFreeExecutionGate({ ...baseGate, decision: "skipped" }).shouldEnqueue,
);
ok(
  "let-expire cycle does not enqueue",
  !relistRadarFreeExecutionGate({ ...baseGate, decision: "let_expire" }).shouldEnqueue,
);
ok(
  "paid channel does not enqueue",
  !relistRadarFreeExecutionGate({ ...baseGate, paid: true }).shouldEnqueue,
);
ok(
  "future cycle does not enqueue",
  !relistRadarFreeExecutionGate({ ...baseGate, cycleDate: "2026-08-12" }).shouldEnqueue,
);
ok(
  "leased property does not enqueue",
  !relistRadarFreeExecutionGate({ ...baseGate, propertyStatus: "leased" }).shouldEnqueue,
);
ok(
  "worker authorization is required",
  !relistRadarFreeExecutionGate({ ...baseGate, automationAuthorized: false }).shouldEnqueue,
);
ok(
  "connected account is required",
  !relistRadarFreeExecutionGate({ ...baseGate, accountStatus: "needs_login" }).shouldEnqueue,
);
ok(
  "unsupported free worker channel is refused",
  relistRadarFreeExecutionGate({ ...baseGate, channelKey: "zumper" }).reason ===
    "unsupported_free_worker_channel",
);
ok(
  "already enqueued cycle is idempotent",
  relistRadarFreeExecutionGate({ ...baseGate, alreadyEnqueued: true }).reason ===
    "already_enqueued",
);

const recap = buildRelistRadarAutopilotRecap({
  appUrl: "https://app.vacantless.com",
  monthLabel: "August 2026",
  items: [
    {
      propertyAddress: "350 City Hall Square West",
      propertyId: "property-1",
      channelLabel: "Kijiji",
      cycleDate: "2026-08-11",
      enqueuedAt: "2026-08-11T13:00:00.000Z",
      dashboardUrl:
        "https://app.vacantless.com/dashboard/properties/property-1?tab=distribute#distribute",
    },
  ],
});
ok("recap subject names month", recap.subject.includes("August 2026"));
ok("recap body counts free refresh", recap.body.includes("queued 1 free refresh"));
ok("recap says paid channels were not touched", recap.body.includes("No paid listings"));
ok("recap does not auto-mark live", recap.body.includes("before Vacantless marks a channel Live"));
ok("recap action opens distribute", recap.actions.some((action) => action.label === "Open Distribute"));

const event = getNotificationEvent(RELIST_RADAR_AUTOPILOT_RECAP_EVENT_KEY);
ok("recap notification registered", event?.key === RELIST_RADAR_AUTOPILOT_RECAP_EVENT_KEY);
ok("recap notification listing lane", event?.lane === "listing");

const routeSource = readFileSync("app/api/cron/distribution-freshness/route.ts", "utf8");
const enqueueStart = routeSource.indexOf("async function enqueueRelistRadarFreeRefresh");
const executeStart = routeSource.indexOf("async function executeRelistRadarFreeRefreshes");
const enqueueSource = routeSource.slice(enqueueStart, executeStart);
ok("cron has execute-free flag", routeSource.includes("RELIST_RADAR_EXECUTE_FREE_ENABLED"));
ok("cron builds backup before item update", enqueueSource.indexOf("const backup = await") < enqueueSource.indexOf('.from("distribution_run_items")'));
ok("cron sets worker claimable status", enqueueSource.includes('publish_status: "needs_operator"'));
ok("cron sets approval timestamp", enqueueSource.includes("operator_submit_approved_at: nowISO"));
ok("cron keeps system actor nullable", enqueueSource.includes("operator_submit_approved_by: null"));
ok("cron writes relist audit source", enqueueSource.includes('source: "relist_radar_autorefresh"'));
ok("cron skips concierge credit RPC", enqueueSource.includes("Do not call claim_concierge_leaseup"));
ok("cron does not call concierge credit RPC", !enqueueSource.includes("claim_concierge_leaseup("));
ok("cron does not mark live in enqueue", !enqueueSource.includes('publish_status: "live"'));
ok("cron CAS starts from live item", enqueueSource.includes('.eq("publish_status", "live")'));
ok("cron detects stale cycle mismatch", routeSource.includes("item_not_current_live_cycle"));
ok("cron stamps monthly recap", routeSource.includes("autopilot_recap_sent_at"));

const actionSource = readFileSync("app/dashboard/properties/distribution-actions.ts", "utf8");
ok("toggle writes auto submit flag", actionSource.includes("auto_submit_allowed"));
ok("toggle limited to Kijiji", actionSource.includes('channelMeta.key !== "kijiji"'));
ok("toggle requires connected account", actionSource.includes('acct.account_status !== "connected"'));
ok("toggle requires automation authorization", actionSource.includes("acct.automation_authorized !== true"));

const panelSource = readFileSync(
  "app/dashboard/properties/[id]/launch-run-panel.tsx",
  "utf8",
);
ok("UI renders standing refresh toggle", panelSource.includes("setRelistRadarStandingAutoRefresh"));
ok("UI names free Kijiji only", panelSource.includes("Free Kijiji only."));

const migration = readFileSync("supabase/migrations/0213_relist_radar_free_execution.sql", "utf8");
ok("migration adds item backup", migration.includes("relist_radar_backup jsonb"));
ok("migration documents backup intent", migration.includes("photo references"));

if (failed > 0) {
  console.error(`relist-radar-execute: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`relist-radar-execute: ${passed} passed, ${failed} failed`);
