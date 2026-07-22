// Unit tests for the pure one-click publish-run adapter.
// Run: npx tsx scripts/test-distribution-publish.ts
import {
  PUBLISH_CHANNEL_KEYS,
  PUBLISH_STATUSES,
  publishChannelChoices,
  preparePublishChannel,
  normalizePublishChannel,
  publishStatusLabel,
  publishStatusTone,
  publishModeLabel,
  isResolvedPublishStatus,
  legacyRunStatusForPublishStatus,
  conciergeRequestAuditForChannel,
  conciergeClaimedAuditForChannel,
  conciergeLiveAuditForChannel,
  conciergeRejectedAuditForChannel,
  CONCIERGE_REQUEST_AUDIT,
  CONCIERGE_CLAIMED_AUDIT,
  CONCIERGE_LIVE_AUDIT,
  CONCIERGE_REJECTED_AUDIT,
  REALTOR_REFERRAL_REQUEST_AUDIT,
  REALTOR_REFERRAL_CLAIMED_AUDIT,
  REALTOR_REFERRAL_LIVE_AUDIT,
  REALTOR_REFERRAL_REJECTED_AUDIT,
  type PublishChannelContext,
} from "../lib/distribution-publish";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

const base: PublishChannelContext = {
  linkIsLive: true,
  canPublishPublicPage: false,
  publicPageBlockers: [],
  shareBlockers: [],
  feedInFeed: true,
  feedHint: "in feed",
  publicUrl: "https://app.test/r/prop1",
  orgFeedUrl: "https://app.test/api/feed/acme",
  networkFeedEnabled: false,
  partner: null,
  existingLiveUrl: null,
  existingListingPostId: null,
};

// --- channel keys + choices ------------------------------------------------
ok("publish keys include internal public page", PUBLISH_CHANNEL_KEYS.includes("vacantless"));
ok("publish keys include per-org feed", PUBLISH_CHANNEL_KEYS.includes("org_feed"));
ok("publish keys include rentfaster", PUBLISH_CHANNEL_KEYS.includes("rentfaster"));
ok(
  "publish keys include social vehicles",
  ["linkedin", "instagram", "facebook_feed", "whatsapp", "snapchat"].every((key) =>
    (PUBLISH_CHANNEL_KEYS as readonly string[]).includes(key),
  ),
);
ok("normalize accepts facebook", normalizePublishChannel(" facebook ") === "facebook");
ok("normalize rejects junk", normalizePublishChannel("craigslist") === null);
ok("network feed hidden by default", !publishChannelChoices().some((c) => c.key === "network_feed"));
ok(
  "network feed included when configured",
  publishChannelChoices({ includeNetworkFeed: true }).some((c) => c.key === "network_feed"),
);

// --- labels ----------------------------------------------------------------
ok("10 publish statuses", PUBLISH_STATUSES.length === 10);
ok("label needs_login", publishStatusLabel("needs_login") === "Needs login");
ok("bad status label -> Queued", publishStatusLabel("???") === "Queued");
ok("mode label broker", publishModeLabel("broker") === "Broker / MLS");
ok("mode label feed partner is candidate", publishModeLabel("feed_partner") === "Feed candidate");

// --- internal channels -----------------------------------------------------
{
  const plan = preparePublishChannel("vacantless", {
    ...base,
    linkIsLive: false,
    canPublishPublicPage: true,
  });
  ok("vacantless can be queued before publish", plan.status === "queued");
  ok("vacantless mode automatic", plan.mode === "automatic");
}
{
  const plan = preparePublishChannel("vacantless", {
    ...base,
    linkIsLive: false,
    canPublishPublicPage: false,
    publicPageBlockers: ["Set the monthly rent."],
  });
  ok("vacantless blocked by required basics", plan.status === "blocked");
  ok("vacantless carries blocker", plan.blockers.includes("Set the monthly rent."));
}
{
  const plan = preparePublishChannel("org_feed", {
    ...base,
    feedInFeed: true,
  });
  ok("org feed submitted when feed-ready", plan.status === "submitted");
  ok("org feed exposes feed URL", plan.operatorActionUrl === base.orgFeedUrl);
}
{
  const plan = preparePublishChannel("org_feed", {
    ...base,
    feedInFeed: false,
    feedHint: "Add a photo",
  });
  ok("org feed blocked when feed readiness fails", plan.status === "blocked");
  ok("org feed blocker uses feed hint", plan.blockers.includes("Add a photo"));
}
{
  const plan = preparePublishChannel("network_feed", base);
  ok("network feed blocked unless token configured", plan.status === "blocked");
}

// --- external channels -----------------------------------------------------
{
  const plan = preparePublishChannel("facebook", base);
  ok("facebook needs login", plan.status === "needs_login");
  ok("facebook mode browser co-pilot", plan.mode === "browser_copilot");
}
{
  const plan = preparePublishChannel("instagram", base);
  ok("instagram needs login", plan.status === "needs_login");
  ok("instagram mode browser co-pilot", plan.mode === "browser_copilot");
}
{
  const plan = preparePublishChannel("kijiji", {
    ...base,
    linkIsLive: false,
  });
  ok("kijiji blocked until Vacantless link works", plan.status === "blocked");
}
{
  const plan = preparePublishChannel("viewit", base);
  ok("viewit needs payment", plan.status === "needs_payment");
}
{
  const plan = preparePublishChannel("realtor_ca", base);
  ok("realtor route needs operator", plan.status === "needs_operator");
  ok("realtor mode broker", plan.mode === "broker");
}
{
  const plan = preparePublishChannel("rentals_ca", {
    ...base,
    partner: { status: "accepted", feedUrl: "https://feed.test/acme.xml" },
  });
  ok("accepted Rentals.ca partner submits but does not claim live", plan.status === "submitted");
  ok("accepted Rentals.ca keeps feed/partner mode", plan.mode === "feed_partner");
}
{
  const plan = preparePublishChannel("rentfaster", base);
  ok("RentFaster without partner is guided paid flow", plan.status === "needs_payment");
  ok("RentFaster without partner does not claim feed submission", plan.auditMessage.includes("No accepted RentFaster feed route"));
}
{
  const plan = preparePublishChannel("rentfaster", {
    ...base,
    partner: { status: "accepted", feedUrl: "https://feed.test/rentfaster.xml" },
  });
  ok("accepted RentFaster partner submits but does not claim live", plan.status === "submitted");
}
{
  const plan = preparePublishChannel("zumper", base);
  ok("Zumper without partner needs operator", plan.status === "needs_operator");
}
{
  const plan = preparePublishChannel("facebook", {
    ...base,
    existingLiveUrl: "https://facebook.test/listing/1",
    existingListingPostId: "post1",
  });
  ok("existing live URL verifies as live", plan.status === "live");
  ok("existing live URL keeps listing_post id", plan.listingPostId === "post1");
}

// --- legacy status bridge --------------------------------------------------
ok("live maps to legacy done", legacyRunStatusForPublishStatus("live") === "done");
ok("submitted stays non-terminal in legacy run status", legacyRunStatusForPublishStatus("submitted") === "in_progress");
ok("needs_login maps to in_progress", legacyRunStatusForPublishStatus("needs_login") === "in_progress");
ok("blocked maps to pending", legacyRunStatusForPublishStatus("blocked") === "pending");
ok("skipped maps to skipped", legacyRunStatusForPublishStatus("skipped") === "skipped");
ok("submitted is an attention state, not positive", publishStatusTone("submitted") === "warning");
ok("submitted is not resolved until proof goes live", !isResolvedPublishStatus("submitted"));

// --- Lane B: realtor referral audit copy -----------------------------------
const realtorAudits = [
  REALTOR_REFERRAL_REQUEST_AUDIT,
  REALTOR_REFERRAL_CLAIMED_AUDIT,
  REALTOR_REFERRAL_LIVE_AUDIT,
  REALTOR_REFERRAL_REJECTED_AUDIT,
];

ok(
  "realtor_ca concierge request uses the RECO referral audit",
  conciergeRequestAuditForChannel("realtor_ca") === REALTOR_REFERRAL_REQUEST_AUDIT,
);
ok(
  "realtor_ca concierge lifecycle uses RECO referral audits",
  conciergeClaimedAuditForChannel("realtor_ca") === REALTOR_REFERRAL_CLAIMED_AUDIT &&
    conciergeLiveAuditForChannel("realtor_ca") === REALTOR_REFERRAL_LIVE_AUDIT &&
    conciergeRejectedAuditForChannel("realtor_ca") === REALTOR_REFERRAL_REJECTED_AUDIT,
);
ok(
  "non-realtor channels keep the generic concierge audit",
  ["facebook", "kijiji", "other"].every(
    (channel) =>
      conciergeRequestAuditForChannel(channel) === CONCIERGE_REQUEST_AUDIT &&
      conciergeClaimedAuditForChannel(channel) === CONCIERGE_CLAIMED_AUDIT &&
      conciergeLiveAuditForChannel(channel) === CONCIERGE_LIVE_AUDIT &&
      conciergeRejectedAuditForChannel(channel) === CONCIERGE_REJECTED_AUDIT,
  ),
);
ok(
  "realtor referral audits are RECO-honest: agent is principal, no fee, real URL",
  realtorAudits.every((audit) => /licensed/i.test(audit)) &&
    realtorAudits.every((audit) => /(principal|would be the principal)/i.test(audit)) &&
    realtorAudits.every((audit) =>
      /(not a party to any referral fee|collect a referral fee)/i.test(audit),
    ) &&
    realtorAudits.every((audit) => /realtor\.ca/i.test(audit)),
);
ok(
  "realtor referral audits never claim Vacantless posts to Realtor.ca",
  realtorAudits.every(
    (audit) =>
      !/Vacantless (posts|posted|will post) (it |this )?(on|to) realtor/i.test(audit),
  ),
);
ok(
  "realtor live and rejected audits mention no fee and the Realtor.ca URL",
  /licensed/i.test(REALTOR_REFERRAL_LIVE_AUDIT) &&
    /(not a party to any referral fee|collect a referral fee)/i.test(REALTOR_REFERRAL_LIVE_AUDIT) &&
    /realtor\.ca listing URL/i.test(REALTOR_REFERRAL_LIVE_AUDIT) &&
    /licensed/i.test(REALTOR_REFERRAL_REJECTED_AUDIT) &&
    /(not a party to any referral fee|collect a referral fee)/i.test(REALTOR_REFERRAL_REJECTED_AUDIT) &&
    /realtor\.ca listing URL/i.test(REALTOR_REFERRAL_REJECTED_AUDIT),
);

const copy = [
  ...publishChannelChoices({ includeNetworkFeed: true }).flatMap((c) => [
    c.label,
    c.description,
  ]),
  ...PUBLISH_STATUSES.map(publishStatusLabel),
  ...realtorAudits,
  CONCIERGE_REQUEST_AUDIT,
  CONCIERGE_CLAIMED_AUDIT,
  CONCIERGE_LIVE_AUDIT,
  CONCIERGE_REJECTED_AUDIT,
].join(" ");
ok("publish copy has no em dashes", !/[—–]/.test(copy));

console.log(`\ndistribution-publish: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
