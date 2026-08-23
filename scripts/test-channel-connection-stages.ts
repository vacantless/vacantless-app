// Pure tests for the operator-facing account connection stage reducer.
// Run: npx tsx scripts/test-channel-connection-stages.ts
import { readFileSync } from "node:fs";
import {
  channelByKey,
  channelConnectionStage,
  groupChannelConnectionChecklist,
} from "../lib/distribution-channels";
import { channelCapability } from "../lib/distribution-capabilities";
import type { PublishChannelKey } from "../lib/distribution-publish";

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

function eq<T>(name: string, actual: T, expected: T) {
  ok(`${name}: expected ${String(expected)}, got ${String(actual)}`, actual === expected);
}

function stageFor(
  channel: PublishChannelKey,
  overrides: Partial<{
    accountStatus: string | null;
    automationAuthorized: boolean;
    hasFeedRoute: boolean;
  }> = {},
) {
  const cap = channelCapability(channel);
  const registry = channelByKey(channel);
  return channelConnectionStage({
    integrationStatus: registry?.integrationStatus ?? null,
    transport: cap.transport,
    requiresLogin: cap.requiresLogin,
    requiresPayment: cap.requiresPayment,
    accountStatus: overrides.accountStatus ?? null,
    hasFeedRoute: overrides.hasFeedRoute ?? false,
    automationAuthorized: overrides.automationAuthorized ?? false,
    requiresAutomationAuthorization:
      registry?.mode === "api_automatic" || cap.postingPolicy === "automatic_allowed",
  });
}

{
  const stage = stageFor("facebook_feed", {
    accountStatus: "connected",
    automationAuthorized: false,
  });
  eq("connected Facebook Page feed waits for authorization", stage.state, "connected_needs_authorization");
  eq("authorization stage is warning", stage.tone, "warning");
  eq("authorization next action is explicit", stage.nextActionLabel, "Authorize auto-post");
  ok("authorization stage does not count as ready", stage.countsAsReady === false);
  ok("authorization helper names authorization", stage.helper.includes("Authorize Vacantless"));
}

{
  const stage = stageFor("facebook_feed", {
    accountStatus: "connected",
    automationAuthorized: true,
  });
  eq("authorized Facebook Page feed is ready", stage.state, "connected_ready");
  eq("authorized label is explicit", stage.label, "Connected + authorized");
  eq("authorized next action points to Get online", stage.nextActionLabel, "Use from Get online");
  ok("authorized stage counts as ready", stage.countsAsReady === true);
}

{
  const stage = stageFor("kijiji", {
    accountStatus: "connected",
    automationAuthorized: false,
  });
  eq("connected Kijiji does not require auto-post authorization", stage.state, "connected_ready");
  eq("connected Kijiji label stays simple", stage.label, "Connected");
}

eq("Kijiji needs login is sign-in bucket", stageFor("kijiji", { accountStatus: "needs_login" }).state, "needs_sign_in");
eq("Zumper needs payment is setup/payment bucket", stageFor("zumper", { accountStatus: "needs_payment" }).state, "needs_payment_or_setup");
eq("Realtor stays broker route", stageFor("realtor_ca", { accountStatus: "connected", automationAuthorized: true }).state, "broker_route");
eq("planned Marketplace remains planned", stageFor("facebook", { accountStatus: "connected", automationAuthorized: true }).state, "planned_or_unavailable");
eq("planned Viewit does not surface stale payment rows", stageFor("viewit", { accountStatus: "needs_payment" }).state, "planned_or_unavailable");
eq("Vacantless route is always on", stageFor("vacantless").state, "always_on");
eq("feed URL can make Rentals.ca ready", stageFor("rentals_ca", { hasFeedRoute: true }).state, "connected_ready");

{
  const groups = groupChannelConnectionChecklist([
    {
      channel: "facebook_feed",
      label: "Facebook Page feed",
      stage: stageFor("facebook_feed", {
        accountStatus: "connected",
        automationAuthorized: false,
      }),
    },
    {
      channel: "kijiji",
      label: "Kijiji",
      stage: stageFor("kijiji", { accountStatus: "needs_login" }),
    },
    {
      channel: "zumper",
      label: "Zumper + PadMapper",
      stage: stageFor("zumper", { accountStatus: "needs_payment" }),
    },
    {
      channel: "rentals_ca",
      label: "Rentals.ca",
      stage: stageFor("rentals_ca", { hasFeedRoute: true }),
    },
    {
      channel: "realtor_ca",
      label: "Realtor.ca",
      stage: stageFor("realtor_ca", {
        accountStatus: "connected",
        automationAuthorized: true,
      }),
    },
  ]);
  eq(
    "checklist groups action buckets in operator order",
    groups.map((group) => group.id).join("|"),
    "authorization|sign_in|setup|ready|planned",
  );
  eq("authorization bucket preserves channel label", groups[0]?.items[0]?.label, "Facebook Page feed");
  eq("sign-in bucket next action is explicit", groups[1]?.items[0]?.stage.nextActionLabel, "Refresh sign-in");
  eq("setup bucket next action is explicit", groups[2]?.items[0]?.stage.nextActionLabel, "Finish setup/payment");
  eq("ready bucket points back to Get online", groups[3]?.items[0]?.stage.nextActionLabel, "Use from Get online");
  eq("planned bucket includes broker routes", groups[4]?.items[0]?.stage.state, "broker_route");
}

{
  const stage = stageFor("rentfaster");
  ok("planned RentFaster names paid assist", stage.helper.includes("paid posting assist"));
  ok("planned RentFaster keeps payment approval gate", stage.helper.includes("approve before paying"));
  ok("planned RentFaster keeps proof gate", stage.helper.includes("live ad URL as proof"));
  ok("planned RentFaster cannot connect from Settings", stage.canConnect === false);
}

{
  const stage = stageFor("facebook");
  ok("planned Marketplace names posting assist", stage.helper.includes("Posting assist can prepare"));
  ok("planned Marketplace keeps operator sign-in gate", stage.helper.includes("signed-in operator"));
  ok("planned Marketplace keeps proof gate", stage.helper.includes("live ad URL as proof"));
  ok("planned Marketplace helper does not mention payment", !stage.helper.includes("paid posting assist"));
}

const settingsSource = readFileSync("app/dashboard/settings/page.tsx", "utf8");
ok(
  "Settings Distribution consumes portal requirement action plans",
  settingsSource.includes("portalRequirementActionPlanFor(cap.channel)") &&
    settingsSource.includes("actionPlan.primaryActionLabel"),
);
ok(
  "Settings Distribution renders source-owned requirement flags",
  settingsSource.includes("requirementFlagChips") &&
    [
      "requiresAccount",
      "requiresPayment",
      "requiresProof",
      "requiresBroker",
      "requiresFeedRoute",
      "requiresAudience",
    ].every((flag) => settingsSource.includes(flag)),
);
ok(
  "Settings checklist surfaces Get online next actions",
  settingsSource.includes("Next from Get online:") &&
    settingsSource.includes("Next: {item.actionLabel}"),
);

console.log(`\nchannel-connection-stages: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
