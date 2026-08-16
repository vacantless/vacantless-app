// S660 source and pure regression guards for stale channel mutation renders.
// Run: npx tsx scripts/test-channel-mutation-stale-render.ts
import { readFileSync } from "node:fs";
import {
  authorizedInstantPublishDestinations,
  type AutoDistributionAccountRow,
} from "../lib/auto-distribution";
import {
  propertyChannelAutomationRedirectPath,
  settingsChannelAutomationRedirectPath,
} from "../lib/channel-automation-navigation";

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

function sameArray(
  name: string,
  actual: readonly string[],
  expected: readonly string[],
) {
  ok(
    `${name}: expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`,
    actual.length === expected.length &&
      actual.every((value, index) => value === expected[index]),
  );
}

function section(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) return "";
  return source.slice(startIndex, endIndex);
}

function account(
  channel: string,
  automationAuthorized = true,
): AutoDistributionAccountRow {
  return {
    channel,
    account_status: "connected",
    automation_authorized: automationAuthorized,
  };
}

const originalIgFlag = process.env.IG_CHANNEL_ENABLED;
process.env.IG_CHANNEL_ENABLED = "true";

const growthTestOrg = "8ea1da48-0cd2-45a4-bfba-023b31a67884";
const agileOrg = "921f7c08-98af-428f-a238-36f4a781b0de";
const instagramAllowlist = new Set([growthTestOrg]);
const propertyId = "5a1e0c7d";

function queryValue(path: string, key: string): string | null {
  return new URL(path, "https://app.vacantless.test").searchParams.get(key);
}

function normalizeMutationToken(path: string): string {
  return path.replace(/&m=[^&#]+/, "&m=<mutation>");
}

ok(
  "property redirect without channel carries a mutation token",
  normalizeMutationToken(
    propertyChannelAutomationRedirectPath(propertyId, "channel_auto_on"),
  ) ===
    "/dashboard/properties/5a1e0c7d?dist=channel_auto_on&m=<mutation>#distribute",
);
ok(
  "property redirect carries authorized channel",
  normalizeMutationToken(
    propertyChannelAutomationRedirectPath(
      propertyId,
      "channel_auto_on",
      "facebook_feed",
    ),
  ) ===
    "/dashboard/properties/5a1e0c7d?dist=channel_auto_on&m=<mutation>&ch=facebook_feed#distribute",
);
ok(
  "property redirect encodes channel",
  normalizeMutationToken(
    propertyChannelAutomationRedirectPath(
      propertyId,
      "channel_auto_on",
      "facebook feed/+",
    ),
  ) ===
    "/dashboard/properties/5a1e0c7d?dist=channel_auto_on&m=<mutation>&ch=facebook%20feed%2F%2B#distribute",
);
ok(
  "settings fallback carries channel",
  normalizeMutationToken(
    settingsChannelAutomationRedirectPath("channel_auto_off", "instagram"),
  ) ===
    "/dashboard/settings?tab=distribution&dist=channel_auto_off&m=<mutation>&ch=instagram",
);

const repeatedChannelAutoOnA = propertyChannelAutomationRedirectPath(
  propertyId,
  "channel_auto_on",
);
const repeatedChannelAutoOnB = propertyChannelAutomationRedirectPath(
  propertyId,
  "channel_auto_on",
);
ok(
  "two backTo calls with the same message produce different URLs",
  repeatedChannelAutoOnA !== repeatedChannelAutoOnB &&
    queryValue(repeatedChannelAutoOnA, "dist") === "channel_auto_on" &&
    queryValue(repeatedChannelAutoOnB, "dist") === "channel_auto_on",
);
const repeatedErrorA = propertyChannelAutomationRedirectPath(
  propertyId,
  "fb_reconnect",
);
const repeatedErrorB = propertyChannelAutomationRedirectPath(
  propertyId,
  "fb_reconnect",
);
ok(
  "repeated error outcomes also produce fresh navigation targets",
  repeatedErrorA !== repeatedErrorB &&
    queryValue(repeatedErrorA, "dist") === "fb_reconnect" &&
    queryValue(repeatedErrorB, "dist") === "fb_reconnect",
);
const repeatedSettingsA = settingsChannelAutomationRedirectPath("channel_auto_on");
const repeatedSettingsB = settingsChannelAutomationRedirectPath("channel_auto_on");
ok(
  "settings redirects with the same message produce different URLs",
  repeatedSettingsA !== repeatedSettingsB &&
    queryValue(repeatedSettingsA, "dist") === "channel_auto_on" &&
    queryValue(repeatedSettingsB, "dist") === "channel_auto_on",
);

const authorizeFacebookUrl = propertyChannelAutomationRedirectPath(
  propertyId,
  "channel_auto_on",
  "facebook_feed",
);
const authorizeInstagramUrl = propertyChannelAutomationRedirectPath(
  propertyId,
  "channel_auto_on",
  "instagram",
);
ok(
  "authorize A then authorize B produces distinct navigation targets",
  authorizeFacebookUrl !== authorizeInstagramUrl,
);
ok(
  "authorize same channel twice also produces a fresh navigation target",
  authorizeFacebookUrl !==
    propertyChannelAutomationRedirectPath(
      propertyId,
      "channel_auto_on",
      "facebook_feed",
    ),
);
ok(
  "revoke A then revoke B produces distinct navigation targets",
  propertyChannelAutomationRedirectPath(
    propertyId,
    "channel_auto_off",
    "facebook_feed",
  ) !==
    propertyChannelAutomationRedirectPath(
      propertyId,
      "channel_auto_off",
      "instagram",
    ),
);
ok(
  "authorize revoke authorize same channel keeps outcome in the URL",
  [
    ["channel_auto_on", "instagram"],
    ["channel_auto_off", "instagram"],
    ["channel_auto_on", "instagram"],
  ].every(([dist, channel]) => {
    const path = propertyChannelAutomationRedirectPath(
      propertyId,
      dist,
      channel,
    );
    return queryValue(path, "dist") === dist && queryValue(path, "ch") === channel;
  }),
);

sameArray(
  "authorize channel A then B leaves both instant destinations included",
  authorizedInstantPublishDestinations({
    organizationId: growthTestOrg,
    accountRows: [account("facebook_feed"), account("instagram")],
    instagramAllowlist,
  }).map((row) => row.key),
  ["instagram", "facebook_feed"],
);
sameArray(
  "revoke one channel removes only that destination",
  authorizedInstantPublishDestinations({
    organizationId: growthTestOrg,
    accountRows: [account("facebook_feed"), account("instagram", false)],
    instagramAllowlist,
  }).map((row) => row.key),
  ["facebook_feed"],
);
sameArray(
  "org with no Meta account has no instant destination",
  authorizedInstantPublishDestinations({
    organizationId: growthTestOrg,
    accountRows: [],
    instagramAllowlist,
  }).map((row) => row.key),
  [],
);
sameArray(
  "Instagram remains excluded outside the IG org allowlist",
  authorizedInstantPublishDestinations({
    organizationId: agileOrg,
    accountRows: [account("instagram")],
    instagramAllowlist,
  }).map((row) => row.key),
  [],
);

const distributionActions = readFileSync(
  "app/dashboard/properties/distribution-actions.ts",
  "utf8",
);
const confirmButton = readFileSync(
  "app/dashboard/properties/[id]/confirm-publish-button.tsx",
  "utf8",
);
const publishEverywhere = readFileSync(
  "app/dashboard/properties/[id]/publish-everywhere.tsx",
  "utf8",
);

const authorize = section(
  distributionActions,
  "export async function authorizeChannelAutomation",
  "export async function revokeChannelAutomation",
);
const revoke = section(
  distributionActions,
  "export async function revokeChannelAutomation",
  "// S570: the operator authorizes autopilot",
);
const freshRead = section(
  distributionActions,
  "export async function readInstantPublishDestinations",
  "async function recordChannelAutomationConsentAttempt",
);

ok(
  "authorize success redirects with channel",
  authorize.includes('backTo(propertyId, "channel_auto_on", channel)') &&
    authorize.includes(
      'settingsChannelAutomationRedirectPath("channel_auto_on", channel)',
    ),
);
ok(
  "authorize failures that know the channel redirect with channel",
  authorize.includes(
    'channelAutomationBackTo(propertyId, "channel_auto_connectfirst", channel)',
  ) &&
    authorize.includes(
      'channelAutomationBackTo(propertyId, "channel_auto_error", channel)',
    ),
);
ok(
  "revoke success and error redirects with channel",
  revoke.includes('backTo(propertyId, "channel_auto_off", channel)') &&
    revoke.includes(
      'settingsChannelAutomationRedirectPath("channel_auto_off", channel)',
    ) &&
    revoke.includes(
      'channelAutomationBackTo(propertyId, "channel_auto_error", channel)',
    ),
);
ok(
  "fresh confirm read uses property org account rows and the shared predicate",
  freshRead.includes('.from("properties")') &&
    freshRead.includes('.select("id, organization_id")') &&
    freshRead.includes('.from("distribution_channel_accounts")') &&
    freshRead.includes(
      '.select("channel, account_status, automation_authorized")',
    ) &&
    freshRead.includes("authorizedInstantPublishDestinations"),
);
ok(
  "plain no-destination button form remains for empty initial destination list",
  confirmButton.includes("if (destinations.length === 0)") &&
    confirmButton.includes("<form action={publishProperty}"),
);
ok(
  "top publish confirm refreshes destinations on open and fails closed",
  confirmButton.includes("await readInstantPublishDestinations(propertyId)") &&
    confirmButton.includes(
      "disabled={loadingDestinations || Boolean(destinationError)}",
    ) &&
    confirmButton.includes("freshDestinations.map"),
);
ok(
  "Publish Everywhere confirm refreshes destinations on open and fails closed",
  publishEverywhere.includes(
    "await readInstantPublishDestinations(propertyId)",
  ) &&
    publishEverywhere.includes("instantDestinations.map") &&
    publishEverywhere.includes(
      "instantDestinationsLoading || Boolean(instantDestinationsError)",
    ),
);
ok(
  "Publish Everywhere modal no longer receives stale instant rows as its destination list",
  publishEverywhere.includes("instantDestinations={confirmDestinations}") &&
    !publishEverywhere.includes("instantRows={instantRows}"),
);

if (originalIgFlag == null) delete process.env.IG_CHANNEL_ENABLED;
else process.env.IG_CHANNEL_ENABLED = originalIgFlag;

console.log(`channel-mutation-stale-render: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
