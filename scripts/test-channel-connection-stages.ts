// Pure tests for the operator-facing account connection stage reducer.
// Run: npx tsx scripts/test-channel-connection-stages.ts
import {
  channelByKey,
  channelConnectionStage,
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

console.log(`\nchannel-connection-stages: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
