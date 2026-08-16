// Pure tests for publish-path instant destination confirmation.
// Run: npx tsx scripts/test-publish-destinations.ts
import {
  authorizedInstantPublishDestinations,
  autoDistributionChannels,
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
  actual: readonly string[],
  expected: readonly string[],
) {
  ok(
    `${name}: expected ${expected.join(",")} got ${actual.join(",")}`,
    actual.length === expected.length &&
      actual.every((value, index) => value === expected[index]),
  );
}

const originalIgFlag = process.env.IG_CHANNEL_ENABLED;
const growthTestOrg = "8ea1da48-0cd2-45a4-bfba-023b31a67884";
const agileOrg = "921f7c08-98af-428f-a238-36f4a781b0de";
const instagramAllowlist = new Set([growthTestOrg]);

function account(
  channel: string,
  account_status: string | null = "connected",
  automation_authorized: boolean | null = true,
): AutoDistributionAccountRow {
  return { channel, account_status, automation_authorized };
}

function destinations({
  organizationId = growthTestOrg,
  accountRows = [],
}: {
  organizationId?: string;
  accountRows?: AutoDistributionAccountRow[];
} = {}) {
  return authorizedInstantPublishDestinations({
    organizationId,
    accountRows,
    instagramAllowlist,
  });
}

function destinationKeys(rows: ReturnType<typeof destinations>) {
  return rows.map((row) => row.key);
}

process.env.IG_CHANNEL_ENABLED = "true";

sameArray(
  "no connected accounts returns no instant destinations",
  destinationKeys(destinations()),
  [],
);

sameArray(
  "instagram connected and authorized joins when the IG org gate allows it",
  destinationKeys(destinations({ accountRows: [account("instagram")] })),
  ["instagram"],
);

sameArray(
  "instagram connected but not authorized stays absent",
  destinationKeys(
    destinations({ accountRows: [account("instagram", "connected", false)] }),
  ),
  [],
);

sameArray(
  "instagram connected and authorized stays absent when the IG org gate blocks",
  destinationKeys(
    destinations({
      organizationId: agileOrg,
      accountRows: [account("instagram")],
    }),
  ),
  [],
);

sameArray(
  "facebook feed connected and authorized joins",
  destinationKeys(destinations({ accountRows: [account("facebook_feed")] })),
  ["facebook_feed"],
);

sameArray(
  "facebook feed connected but not authorized stays absent",
  destinationKeys(
    destinations({
      accountRows: [account("facebook_feed", "connected", false)],
    }),
  ),
  [],
);

sameArray(
  "authorized channel with needs_setup status stays absent",
  destinationKeys(
    destinations({ accountRows: [account("facebook_feed", "needs_setup", true)] }),
  ),
  [],
);

sameArray(
  "non-api automatic channels stay absent even when connected and authorized",
  destinationKeys(
    destinations({
      accountRows: [account("zumper"), account("rentfaster"), account("viewit")],
    }),
  ),
  [],
);

{
  const rows = destinations({
    accountRows: [account("instagram"), account("facebook_feed")],
  });
  sameArray(
    "destinations use distribution-channel display labels",
    rows.map((row) => row.label),
    ["Instagram", "Facebook Page feed"],
  );
}

{
  const accountRows = [
    account("instagram"),
    account("facebook_feed"),
    account("rentals_ca", "needs_setup", true),
    account("zumper"),
    account("rentfaster"),
  ];
  const actual = destinationKeys(destinations({ accountRows }));
  const baseline = autoDistributionChannels({
    organizationId: growthTestOrg,
    accountRows: [],
    includeNetworkFeed: false,
    instagramAllowlist,
  });
  const stagedAdditions = autoDistributionChannels({
    organizationId: growthTestOrg,
    accountRows,
    includeNetworkFeed: false,
    instagramAllowlist,
  }).filter(
    (key): key is PublishChannelKey => !baseline.includes(key),
  );

  sameArray(
    "destination predicate returns the same API additions the staging path uses",
    actual,
    stagedAdditions,
  );
}

if (originalIgFlag == null) delete process.env.IG_CHANNEL_ENABLED;
else process.env.IG_CHANNEL_ENABLED = originalIgFlag;

if (failed > 0) {
  console.error(`${passed} passed, ${failed} failed`);
  process.exit(1);
}

console.log(`publish-destinations: ${passed} passed, ${failed} failed`);
