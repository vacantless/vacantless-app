import { readFileSync } from "fs";
import {
  autoDistributionChannels,
  autoDistributionEnabledForOrg,
  parseAutoDistributionOrgAllowlist,
  type AutoDistributionAccountRow,
} from "../lib/auto-distribution";
import type { PublishChannelKey } from "../lib/distribution-publish";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${name}`);
  }
}

function sameArray(
  name: string,
  actual: readonly PublishChannelKey[],
  expected: readonly PublishChannelKey[],
) {
  ok(
    `${name}: expected ${expected.join(",")} got ${actual.join(",")}`,
    actual.length === expected.length &&
      actual.every((value, index) => value === expected[index]),
  );
}

const originalAutoFlag = process.env.AUTO_DISTRIBUTION_ENABLED;
const originalIgFlag = process.env.IG_CHANNEL_ENABLED;
const growthTestOrg = "8ea1da48-0cd2-45a4-bfba-023b31a67884";
const agileOrg = "921f7c08-98af-428f-a238-36f4a781b0de";
const allowlist = parseAutoDistributionOrgAllowlist(
  ` ${growthTestOrg.toUpperCase()} , , not-a-uuid,${growthTestOrg},`,
);

ok("allowlist keeps normalized UUIDs only", allowlist.size === 1);
ok("allowlist lowercases entries", allowlist.has(growthTestOrg));

delete process.env.AUTO_DISTRIBUTION_ENABLED;
ok(
  "auto distribution is off when flag is unset, even for an allowlisted org",
  !autoDistributionEnabledForOrg(growthTestOrg, allowlist),
);
process.env.AUTO_DISTRIBUTION_ENABLED = "false";
ok(
  "auto distribution is off when flag is not true",
  !autoDistributionEnabledForOrg(growthTestOrg, allowlist),
);
process.env.AUTO_DISTRIBUTION_ENABLED = "true";
ok(
  "flag on plus empty allowlist preserves all-org semantics",
  autoDistributionEnabledForOrg(agileOrg, new Set()),
);
ok(
  "flag on plus non-empty allowlist allows listed org",
  autoDistributionEnabledForOrg(growthTestOrg.toUpperCase(), allowlist),
);
ok(
  "flag on plus non-empty allowlist blocks unlisted org",
  !autoDistributionEnabledForOrg(agileOrg, allowlist),
);
ok(
  "flag on plus non-empty allowlist fails closed for null org",
  !autoDistributionEnabledForOrg(null, allowlist),
);
ok(
  "flag on plus non-empty allowlist fails closed for malformed org",
  !autoDistributionEnabledForOrg("not-a-uuid", allowlist),
);

sameArray(
  "no connected accounts preserves the full default-selected baseline",
  autoDistributionChannels({
    organizationId: growthTestOrg,
    accountRows: [],
    includeNetworkFeed: false,
  }),
  ["vacantless", "org_feed", "facebook", "kijiji"],
);
sameArray(
  "network feed stays absent from the default baseline when choices include it",
  autoDistributionChannels({
    organizationId: growthTestOrg,
    accountRows: [],
    includeNetworkFeed: true,
  }),
  ["vacantless", "org_feed", "facebook", "kijiji"],
);

function account(
  channel: string,
  account_status: string | null = "connected",
  automation_authorized: boolean | null = true,
): AutoDistributionAccountRow {
  return { channel, account_status, automation_authorized };
}

process.env.IG_CHANNEL_ENABLED = "true";
sameArray(
  "instagram connected and authorized joins when IG org gate allows it",
  autoDistributionChannels({
    organizationId: growthTestOrg,
    accountRows: [account("instagram")],
    includeNetworkFeed: false,
    instagramAllowlist: new Set([growthTestOrg]),
  }),
  ["vacantless", "org_feed", "facebook", "kijiji", "instagram"],
);
sameArray(
  "instagram connected but not authorized stays absent",
  autoDistributionChannels({
    organizationId: growthTestOrg,
    accountRows: [account("instagram", "connected", false)],
    includeNetworkFeed: false,
    instagramAllowlist: new Set([growthTestOrg]),
  }),
  ["vacantless", "org_feed", "facebook", "kijiji"],
);
sameArray(
  "instagram connected and authorized stays absent when IG org gate blocks",
  autoDistributionChannels({
    organizationId: agileOrg,
    accountRows: [account("instagram")],
    includeNetworkFeed: false,
    instagramAllowlist: new Set([growthTestOrg]),
  }),
  ["vacantless", "org_feed", "facebook", "kijiji"],
);

sameArray(
  "facebook feed connected and authorized joins",
  autoDistributionChannels({
    organizationId: growthTestOrg,
    accountRows: [account("facebook_feed")],
    includeNetworkFeed: false,
  }),
  ["vacantless", "org_feed", "facebook", "kijiji", "facebook_feed"],
);
sameArray(
  "facebook feed connected but not authorized stays absent",
  autoDistributionChannels({
    organizationId: growthTestOrg,
    accountRows: [account("facebook_feed", "connected", false)],
    includeNetworkFeed: false,
  }),
  ["vacantless", "org_feed", "facebook", "kijiji"],
);
sameArray(
  "facebook feed authorized but not connected stays absent",
  autoDistributionChannels({
    organizationId: growthTestOrg,
    accountRows: [account("facebook_feed", "needs_setup", true)],
    includeNetworkFeed: false,
  }),
  ["vacantless", "org_feed", "facebook", "kijiji"],
);
sameArray(
  "connected authorized concierge or copilot channels stay absent",
  autoDistributionChannels({
    organizationId: growthTestOrg,
    accountRows: [account("zumper"), account("rentfaster")],
    includeNetworkFeed: false,
  }),
  ["vacantless", "org_feed", "facebook", "kijiji"],
);

const actionSource = readFileSync("app/dashboard/properties/actions.ts", "utf8");
ok(
  "maybePrepareAvailableListing uses the org-scoped auto-distribution flag",
  /autoDistributionEnabledForOrg\(org\.id\)/.test(actionSource),
);
ok(
  "maybePrepareAvailableListing reads automation authorization rows for staging",
  /\.select\("channel, account_status, automation_authorized"\)\s*\.eq\("organization_id", org\.id\)/.test(
    actionSource,
  ),
);

if (originalAutoFlag == null) delete process.env.AUTO_DISTRIBUTION_ENABLED;
else process.env.AUTO_DISTRIBUTION_ENABLED = originalAutoFlag;
if (originalIgFlag == null) delete process.env.IG_CHANNEL_ENABLED;
else process.env.IG_CHANNEL_ENABLED = originalIgFlag;

if (failed > 0) {
  console.error(`${passed} passed, ${failed} failed`);
  process.exit(1);
}

console.log(`auto-distribution-org-allowlist: ${passed} passed, ${failed} failed`);
