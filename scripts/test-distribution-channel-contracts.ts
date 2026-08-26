// Unit tests for the pure distribution channel contract v2 model.
// Run: npx tsx scripts/test-distribution-channel-contracts.ts
import {
  DISTRIBUTION_ACCOUNT_KINDS,
  DISTRIBUTION_AUTHORIZATION_KINDS,
  DISTRIBUTION_CHANNEL_CONTRACTS,
  DISTRIBUTION_EXECUTION_KINDS,
  DISTRIBUTION_PROOF_KINDS,
  DISTRIBUTION_REFRESH_KINDS,
  DISTRIBUTION_ROLLOUT_STATES,
  DISTRIBUTION_SPEND_KINDS,
  DISTRIBUTION_TAKEDOWN_KINDS,
  distributionChannelContract,
  distributionExecutionLabel,
  distributionLifecycleSummary,
  distributionLaunchStateLabel,
  distributionLaunchStateTone,
  distributionRefreshLabel,
  distributionTakedownLabel,
  hasAutomatedTakedown,
  participatesInKeepLive,
  resolveDistributionLaunchReadiness,
} from "../lib/distribution-channel-contracts";
import { PUBLISH_CHANNEL_KEYS } from "../lib/distribution-publish";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${name}`);
  }
}

function enumSet(values: readonly string[]) {
  return new Set(values);
}

const executionKinds = enumSet(DISTRIBUTION_EXECUTION_KINDS);
const accountKinds = enumSet(DISTRIBUTION_ACCOUNT_KINDS);
const authorizationKinds = enumSet(DISTRIBUTION_AUTHORIZATION_KINDS);
const spendKinds = enumSet(DISTRIBUTION_SPEND_KINDS);
const proofKinds = enumSet(DISTRIBUTION_PROOF_KINDS);
const refreshKinds = enumSet(DISTRIBUTION_REFRESH_KINDS);
const takedownKinds = enumSet(DISTRIBUTION_TAKEDOWN_KINDS);
const rolloutStates = enumSet(DISTRIBUTION_ROLLOUT_STATES);

// --- coverage and enum integrity ------------------------------------------
{
  const channels = DISTRIBUTION_CHANNEL_CONTRACTS.map(
    (contract) => contract.channel,
  );
  const uniqueChannels = new Set(channels);

  ok(
    "one contract per publish channel",
    DISTRIBUTION_CHANNEL_CONTRACTS.length === PUBLISH_CHANNEL_KEYS.length,
  );
  ok(
    "no duplicate channel contracts",
    uniqueChannels.size === DISTRIBUTION_CHANNEL_CONTRACTS.length,
  );
  ok(
    "every publish channel has a contract",
    PUBLISH_CHANNEL_KEYS.every((channel) => uniqueChannels.has(channel)),
  );
  ok(
    "every contract has a publish channel",
    channels.every((channel) => PUBLISH_CHANNEL_KEYS.includes(channel)),
  );
}

for (const contract of DISTRIBUTION_CHANNEL_CONTRACTS) {
  ok(
    `${contract.channel} execution kind is valid`,
    executionKinds.has(contract.executionKind),
  );
  ok(
    `${contract.channel} account kind is valid`,
    accountKinds.has(contract.accountKind),
  );
  ok(
    `${contract.channel} authorization kind is valid`,
    authorizationKinds.has(contract.authorizationKind),
  );
  ok(
    `${contract.channel} spend kind is valid`,
    spendKinds.has(contract.spendKind),
  );
  ok(
    `${contract.channel} proof kind is valid`,
    proofKinds.has(contract.proofKind),
  );
  ok(
    `${contract.channel} refresh kind is valid`,
    refreshKinds.has(contract.refreshKind),
  );
  ok(
    `${contract.channel} takedown kind is valid`,
    takedownKinds.has(contract.takedownKind),
  );
  ok(
    `${contract.channel} rollout state is valid`,
    rolloutStates.has(contract.rolloutState),
  );
  ok(
    `${contract.channel} label/note are ASCII friendly`,
    !/[—–]/.test(`${contract.label} ${contract.note}`),
  );
}

// --- instant/internal destinations ----------------------------------------
{
  const vacantless = distributionChannelContract("vacantless");
  ok("public page is public_page", vacantless.executionKind === "public_page");
  ok("public page needs no account", vacantless.accountKind === "none");
  ok(
    "public page is ready without an account",
    resolveDistributionLaunchReadiness(vacantless).state === "ready",
  );
  ok("public page has automated takedown", hasAutomatedTakedown(vacantless));
}
{
  const orgFeed = distributionChannelContract("org_feed");
  ok("org feed is feed execution", orgFeed.executionKind === "feed");
  ok(
    "org feed is ready without an account",
    resolveDistributionLaunchReadiness(orgFeed).state === "ready",
  );
  ok("org feed has automated takedown", hasAutomatedTakedown(orgFeed));
}

// --- Facebook split --------------------------------------------------------
{
  const pageFeed = distributionChannelContract("facebook_feed");
  const marketplace = distributionChannelContract("facebook");
  ok("Facebook Page feed uses API", pageFeed.executionKind === "api");
  ok("Facebook Page feed account is OAuth", pageFeed.accountKind === "oauth");
  ok(
    "Facebook Page feed proof is a graph permalink",
    pageFeed.proofKind === "graph_permalink",
  );
  ok(
    "Facebook Page feed takedown is API delete",
    pageFeed.takedownKind === "api_delete",
  );
  ok("Facebook Page feed is not Marketplace", pageFeed.channel !== marketplace.channel);
  ok("Marketplace stays fallback", marketplace.executionKind === "fallback");
  ok(
    "Marketplace needs a product decision",
    marketplace.rolloutState === "needs_decision",
  );
  ok(
    "Marketplace readiness is fallback task",
    resolveDistributionLaunchReadiness(marketplace).state === "fallback_task",
  );
}

// --- Kijiji headless and spend gate ----------------------------------------
{
  const kijiji = distributionChannelContract("kijiji");
  ok("Kijiji uses headless worker", kijiji.executionKind === "headless_worker");
  ok("Kijiji account is stored session", kijiji.accountKind === "stored_session");
  ok(
    "Kijiji auth covers post and refresh",
    kijiji.authorizationKind === "posting_and_refresh",
  );
  ok(
    "Kijiji requires landlord pass-through spend",
    kijiji.spendKind === "paid_pass_through_required",
  );
  ok("Kijiji proof is external URL", kijiji.proofKind === "external_url");
  ok("Kijiji refresh is auto TTL", kijiji.refreshKind === "ttl_auto");
  ok("Kijiji TTL is 60 days", kijiji.ttlDays === 60);
  ok("Kijiji takedown remains operator task", kijiji.takedownKind === "operator_task");
  ok(
    "Kijiji without account needs account",
    resolveDistributionLaunchReadiness(kijiji).state === "needs_account",
  );
  ok(
    "Kijiji connected without auth needs authorization",
    resolveDistributionLaunchReadiness(kijiji, {
      accountStatus: "connected",
    }).state === "needs_authorization",
  );
  ok(
    "Kijiji connected and authorized without spend needs limit",
    resolveDistributionLaunchReadiness(kijiji, {
      accountStatus: "connected",
      automationAuthorized: true,
    }).state === "needs_spend_limit",
  );
  ok(
    "Kijiji connected authorized and funded is ready",
    resolveDistributionLaunchReadiness(kijiji, {
      accountStatus: "connected",
      automationAuthorized: true,
      spendAuthorized: true,
      spendMaxCents: 5000,
    }).state === "ready",
  );
  ok(
    "Kijiji revoked spend needs limit",
    resolveDistributionLaunchReadiness(kijiji, {
      accountStatus: "connected",
      automationAuthorized: true,
      spendAuthorized: true,
      spendMaxCents: 5000,
      spendRevokedAt: "2026-08-26T00:00:00Z",
    }).state === "needs_spend_limit",
  );
}

// --- Paid and unpaid portal workers ----------------------------------------
for (const channel of ["rentals_ca", "zumper"] as const) {
  const contract = distributionChannelContract(channel);
  ok(`${channel} uses headless worker`, contract.executionKind === "headless_worker");
  ok(`${channel} account is stored session`, contract.accountKind === "stored_session");
  ok(
    `${channel} connected and authorized is ready`,
    resolveDistributionLaunchReadiness(contract, {
      accountStatus: "connected",
      automationAuthorized: true,
    }).state === "ready",
  );
  ok(
    `${channel} without account needs account`,
    resolveDistributionLaunchReadiness(contract).state === "needs_account",
  );
}

for (const channel of ["viewit", "rentfaster"] as const) {
  const contract = distributionChannelContract(channel);
  ok(`${channel} requires paid spend`, contract.spendKind === "paid_pass_through_required");
  ok(
    `${channel} authorized without spend needs limit`,
    resolveDistributionLaunchReadiness(contract, {
      accountStatus: "connected",
      automationAuthorized: true,
    }).state === "needs_spend_limit",
  );
}

// --- Social/broker/planned states ------------------------------------------
{
  const instagram = distributionChannelContract("instagram");
  ok("Instagram account is OAuth", instagram.accountKind === "oauth");
  ok(
    "Instagram connected and authorized is ready",
    resolveDistributionLaunchReadiness(instagram, {
      accountStatus: "connected",
      automationAuthorized: true,
    }).state === "ready",
  );
  ok("Instagram has no automated takedown yet", !hasAutomatedTakedown(instagram));
}
{
  const realtor = distributionChannelContract("realtor_ca");
  ok(
    "Realtor.ca needs broker route",
    resolveDistributionLaunchReadiness(realtor).state === "needs_broker",
  );
}
for (const channel of ["whatsapp", "linkedin", "snapchat"] as const) {
  ok(
    `${channel} stays planned`,
    resolveDistributionLaunchReadiness(distributionChannelContract(channel))
      .state === "planned",
  );
}

// --- keep-live/reminders ---------------------------------------------------
ok(
  "Kijiji participates in keep-live",
  participatesInKeepLive(distributionChannelContract("kijiji")),
);
ok(
  "Facebook Page feed does not participate in TTL keep-live",
  !participatesInKeepLive(distributionChannelContract("facebook_feed")),
);
ok(
  "Kijiji refresh label includes 60-day reminder",
  distributionRefreshLabel(distributionChannelContract("kijiji")) ===
    "Auto-refresh before 60 days",
);
ok(
  "Facebook Page feed takedown label is API specific",
  distributionTakedownLabel(distributionChannelContract("facebook_feed")) ===
    "API takedown",
);
ok(
  "Kijiji lifecycle mentions refresh and removal",
  distributionLifecycleSummary(distributionChannelContract("kijiji")).detail ===
    "Auto-refresh before 60 days; removal task when the rental is leased or taken offline.",
);
ok(
  "Vacantless lifecycle mentions internal unpublish",
  distributionLifecycleSummary(distributionChannelContract("vacantless")).detail ===
    "Internal unpublish when the rental is leased or taken offline.",
);
ok(
  "planned share lifecycle stays honest",
  distributionLifecycleSummary(distributionChannelContract("linkedin")).detail ===
    "Expiry watch after proof; no takedown step is tracked here.",
);

// --- display-safe labels ---------------------------------------------------
ok("ready label", distributionLaunchStateLabel("ready") === "Ready");
ok(
  "spend limit label",
  distributionLaunchStateLabel("needs_spend_limit") === "Needs spend limit",
);
ok("ready tone", distributionLaunchStateTone("ready") === "positive");
ok("account tone", distributionLaunchStateTone("needs_account") === "accent");
ok(
  "headless execution label hides worker internals",
  distributionExecutionLabel("headless_worker") === "Automated",
);

if (failed > 0) {
  console.error(`distribution-channel-contracts tests failed: ${failed}`);
  process.exit(1);
}
console.log(`distribution-channel-contracts tests passed: ${passed}`);
