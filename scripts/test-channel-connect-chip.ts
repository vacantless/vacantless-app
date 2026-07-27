// Unit tests for the Settings-only channel connect chip.
// Run: npm run test:channel-connect-chip
import { channelCapability } from "../lib/distribution-capabilities";
import {
  channelByKey,
  channelConnectChip,
  type ConnectChipState,
  type ConnectChipTone,
} from "../lib/distribution-channels";
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

function chipFor(
  channel: PublishChannelKey,
  overrides: Partial<{
    accountStatus: string | null;
    hasFeedRoute: boolean;
  }> = {},
) {
  const cap = channelCapability(channel);
  const registry = channelByKey(channel);
  return channelConnectChip({
    integrationStatus: registry?.integrationStatus ?? null,
    transport: cap.transport,
    needsOrgAccount: cap.needsOrgAccount,
    accountStatus: overrides.accountStatus ?? null,
    hasFeedRoute: overrides.hasFeedRoute ?? false,
  });
}

function assertChip(
  channel: PublishChannelKey,
  state: ConnectChipState,
  tone: ConnectChipTone,
) {
  const chip = chipFor(channel);
  eq(`${channel} state`, chip.state, state);
  eq(`${channel} tone`, chip.tone, tone);
}

for (const channel of [
  "facebook",
  "linkedin",
  "whatsapp",
  "snapchat",
  "viewit",
  "rentfaster",
] as const) {
  assertChip(channel, "coming_soon", "neutral");
  ok(`${channel} fresh org is not positive`, chipFor(channel).tone !== "positive");
}

assertChip("realtor_ca", "mls_route", "neutral");
ok("realtor_ca fresh org is not positive", chipFor("realtor_ca").tone !== "positive");

for (const channel of [
  "kijiji",
  "rentals_ca",
  "zumper",
  "instagram",
  "facebook_feed",
] as const) {
  assertChip(channel, "connect", "accent");
  ok(`${channel} fresh org is not positive`, chipFor(channel).tone !== "positive");
}

assertChip("vacantless", "always_on", "positive");
assertChip("org_feed", "always_on", "positive");

{
  const chip = chipFor("kijiji", { accountStatus: "connected" });
  eq("connected kijiji state", chip.state, "connected");
  eq("connected kijiji tone", chip.tone, "positive");
}

{
  const chip = chipFor("facebook", { accountStatus: "connected" });
  eq("planned facebook with connected account stays coming soon", chip.state, "coming_soon");
  eq("planned facebook with connected account stays neutral", chip.tone, "neutral");
}

{
  const chip = chipFor("facebook", { hasFeedRoute: true });
  eq("planned facebook with feed route stays coming soon", chip.state, "coming_soon");
  eq("planned facebook with feed route stays neutral", chip.tone, "neutral");
}

{
  const chip = chipFor("realtor_ca", { accountStatus: "connected" });
  eq("mls realtor with connected account stays mls route", chip.state, "mls_route");
  eq("mls realtor with connected account stays neutral", chip.tone, "neutral");
}

{
  const chip = chipFor("realtor_ca", { hasFeedRoute: true });
  eq("mls realtor with feed route stays mls route", chip.state, "mls_route");
  eq("mls realtor with feed route stays neutral", chip.tone, "neutral");
}

{
  const chip = chipFor("kijiji", { accountStatus: "needs_login" });
  eq("needs-login kijiji state", chip.state, "needs_login");
  eq("needs-login kijiji tone", chip.tone, "warning");
}

{
  const chip = chipFor("rentals_ca", { hasFeedRoute: true });
  eq("feed-route rentals_ca state", chip.state, "connected");
  eq("feed-route rentals_ca tone", chip.tone, "positive");
}

console.log(`\nchannel-connect-chip: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
