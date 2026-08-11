// Unit/source tests for S642 Relist Radar Slice 1.
// Run: npx tsx scripts/test-relist-radar.ts
import { readFileSync } from "node:fs";
import { channelByKey } from "../lib/distribution-channels";
import {
  RELIST_RADAR_TEST_ORG_ID,
  addDaysISO,
  buildRelistRadarClockUpdate,
  classifyRelistRadarCandidate,
  relistRadarOrgAllowed,
  resolveRelistRadarSettings,
} from "../lib/relist-radar";

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

const NOW = "2026-08-11T14:00:00.000Z";

ok("kijiji ttl is 60 days", channelByKey("kijiji")?.ttlDays === 60);
ok("kijiji is free", channelByKey("kijiji")?.paid === false);
ok("rentfaster is paid", channelByKey("rentfaster")?.paid === true);
ok("viewit is paid", channelByKey("viewit")?.paid === true);
ok("facebook unknown ttl stays null", channelByKey("facebook")?.ttlDays === null);

ok("addDaysISO +60", addDaysISO(NOW, 60) === "2026-10-10T14:00:00.000Z");

{
  const update = buildRelistRadarClockUpdate({
    enabled: false,
    channel: "kijiji",
    nowISO: NOW,
    existingExternalPostedAt: null,
    existingExternalUrl: null,
    nextExternalUrl: "https://www.kijiji.ca/v-test/123",
  });
  ok("flag off makes no clock update", Object.keys(update).length === 0);
}

{
  const update = buildRelistRadarClockUpdate({
    enabled: true,
    channel: "kijiji",
    nowISO: NOW,
    existingExternalPostedAt: null,
    existingExternalUrl: null,
    nextExternalUrl: "https://www.kijiji.ca/v-test/123",
  });
  ok("fresh kijiji stamps posted_at", update.external_posted_at === NOW);
  ok("fresh kijiji stamps +60 expiry", update.external_expires_at === "2026-10-10T14:00:00.000Z");
}

{
  const update = buildRelistRadarClockUpdate({
    enabled: true,
    channel: "kijiji",
    nowISO: NOW,
    existingExternalPostedAt: "2026-08-01T14:00:00.000Z",
    existingExternalUrl: "https://www.kijiji.ca/v-test/123",
    nextExternalUrl: "https://www.kijiji.ca/v-test/123",
  });
  ok("same URL remark preserves old clock", Object.keys(update).length === 0);
}

{
  const update = buildRelistRadarClockUpdate({
    enabled: true,
    channel: "kijiji",
    nowISO: NOW,
    existingExternalPostedAt: "2026-08-01T14:00:00.000Z",
    existingExternalUrl: "https://www.kijiji.ca/v-test/old",
    nextExternalUrl: "https://www.kijiji.ca/v-test/new",
  });
  ok("changed URL is a fresh post", update.external_posted_at === NOW);
}

{
  const update = buildRelistRadarClockUpdate({
    enabled: true,
    channel: "viewit",
    nowISO: NOW,
    existingExternalPostedAt: null,
    existingExternalUrl: null,
    nextExternalUrl: "https://www.viewit.ca/3015SandwichSt-Windsor-1bdrm-VIT%3D22134",
  });
  ok("unknown TTL still records post time", update.external_posted_at === NOW);
  ok("unknown TTL has no computed expiry", update.external_expires_at === null);
}

const classify = (overrides: Partial<Parameters<typeof classifyRelistRadarCandidate>[0]> = {}) =>
  classifyRelistRadarCandidate({
    nowISO: NOW,
    propertyStatus: "available",
    externalExpiresAt: "2026-08-14T13:00:00.000Z",
    channelTtlDays: 60,
    notifyLeadDays: 3,
    ...overrides,
  });

{
  const c = classify();
  ok("in-window available is candidate", c.kind === "radar_candidate");
  ok("candidate days ceil", c.daysToExpiry === 3);
  ok("candidate cycle date", c.cycleDate === "2026-08-14");
}
ok(
  "out-of-window excluded",
  classify({ externalExpiresAt: "2026-08-15T14:00:01.000Z" }).kind === "out_of_window",
);
ok("leased excluded", classify({ propertyStatus: "leased" }).kind === "leased");
ok("unknown TTL excluded", classify({ channelTtlDays: null }).kind === "unknown_ttl");
ok("missing expiry excluded", classify({ externalExpiresAt: null }).kind === "missing_expiry");
ok(
  "already expired is still a candidate",
  classify({ externalExpiresAt: "2026-08-10T14:00:00.000Z" }).kind === "radar_candidate",
);

{
  const settings = resolveRelistRadarSettings({ notify_lead_days: 5 });
  ok("settings reads notify lead days override", settings.notify_lead_days === 5);
  ok(
    "settings supplies later-slice defaults",
    settings.refresh_now_semantics === "confirm_run_on_scheduled_day" &&
      settings.free_skip_behavior === "last_chance_then_lapse" &&
      settings.paid_lapse_followup === "nudge" &&
      settings.execution_time === "expiry_day_morning" &&
      settings.email_grouping === "combined_per_property" &&
      settings.autopilot_receipt === "monthly",
  );
}

ok("test org allowed", relistRadarOrgAllowed(RELIST_RADAR_TEST_ORG_ID));
ok(
  "Agile org blocked",
  !relistRadarOrgAllowed("921f7c08-98af-428f-a238-36f4a781b0de"),
);

const migration = readFileSync("supabase/migrations/0211_relist_radar_clock.sql", "utf8");
ok("migration adds external_posted_at", migration.includes("external_posted_at timestamptz"));
ok("migration adds external_expires_at", migration.includes("external_expires_at timestamptz"));
ok("migration creates settings store", migration.includes("create table if not exists public.relist_radar_settings"));
ok("migration creates event store", migration.includes("create table if not exists public.relist_radar_events"));
ok("event idempotency is per item cycle", migration.includes("unique (run_item_id, event_type, cycle_date)"));

const routeSource = readFileSync("app/api/cron/distribution-freshness/route.ts", "utf8");
ok("cron uses radar flag", routeSource.includes("process.env.RELIST_RADAR_CLOCK_ENABLED"));
ok("cron reads radar settings", routeSource.includes('.from("relist_radar_settings")'));
ok("cron writes radar events", routeSource.includes('.from("relist_radar_events")'));
ok("cron is test-org scoped", routeSource.includes("RELIST_RADAR_TEST_ORG_ID"));
ok("cron does not write radar email", !routeSource.includes("RELIST_RADAR_EMAIL_ENABLED"));

const conciergeSource = readFileSync("app/dashboard/admin/concierge-actions.ts", "utf8");
const distributionActionsSource = readFileSync("app/dashboard/properties/distribution-actions.ts", "utf8");
const propertyActionsSource = readFileSync("app/dashboard/properties/actions.ts", "utf8");
ok(
  "live proof paths use clock helper",
  [conciergeSource, distributionActionsSource, propertyActionsSource].every((src) =>
    src.includes("buildRelistRadarClockUpdate"),
  ),
);
ok(
  "live proof paths are flag gated",
  [conciergeSource, distributionActionsSource, propertyActionsSource].every((src) =>
    src.includes("RELIST_RADAR_CLOCK_ENABLED"),
  ),
);

if (failed > 0) {
  console.error(`relist-radar: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`relist-radar: ${passed} passed, ${failed} failed`);
