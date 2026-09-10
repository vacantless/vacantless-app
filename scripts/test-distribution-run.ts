// Unit tests for the pure distribution-run helpers.
// Run: npx tsx scripts/test-distribution-run.ts
import { existsSync, readFileSync } from "fs";
import {
  RUN_ITEM_STATUSES,
  activeRunChannelCount,
  runItemStatusLabel,
  isRunItemStatus,
  normalizeRunItemStatus,
  isResolvedRunStatus,
  buildRunSteps,
  runProgress,
  automationStatusForItem,
  automationStatusSummary,
  selectableRunChannels,
} from "../lib/distribution-run";
import { DISTRIBUTION_CHANNELS } from "../lib/distribution-channels";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

// --- status ----------------------------------------------------------------
ok("4 run-item statuses", RUN_ITEM_STATUSES.length === 4);
ok("label done", runItemStatusLabel("done") === "Done");
ok("label junk -> Not started", runItemStatusLabel("???") === "Not started");
ok("isRunItemStatus true", isRunItemStatus("in_progress"));
ok("isRunItemStatus false", !isRunItemStatus("nope"));
ok("normalize junk -> pending", normalizeRunItemStatus("x") === "pending");
ok("resolved: done", isResolvedRunStatus("done"));
ok("resolved: skipped", isResolvedRunStatus("skipped"));
ok("not resolved: pending", !isResolvedRunStatus("pending"));
ok("not resolved: in_progress", !isResolvedRunStatus("in_progress"));

// --- steps -----------------------------------------------------------------
{
  const fb = buildRunSteps("facebook");
  ok("facebook has an open step first", fb[0].key === "open");
  ok("facebook has a copy-title step", fb.some((s) => s.key === "title"));
  ok(
    "facebook photo step mentions duplicate/QR",
    fb.some((s) => s.key === "photos" && /duplicate|QR/.test(s.detail ?? "")),
  );
  // S695: the gotchas step went with the guardrails (DECISION-S694).
  ok("facebook has no gotchas step", !fb.some((s) => s.key === "gotchas"));
  ok("facebook ends with paste_url", fb[fb.length - 1].key === "paste_url");
}
{
  const realtor = buildRunSteps("realtor_ca");
  ok("broker route: no copy-title step", !realtor.some((s) => s.key === "title"));
  ok("broker route: brief the agent", realtor[0].key === "brief_agent");
  ok(
    "broker route: confirm-live paste step",
    realtor.some((s) => s.key === "confirm_live"),
  );
}
{
  const other = buildRunSteps("other");
  ok("other uses generic portal label", other[0].label.includes("the portal"));
  ok("other ends with paste_url", other[other.length - 1].key === "paste_url");
}
{
  const vacantless = buildRunSteps("vacantless");
  ok("vacantless has public-page step", vacantless[0].key === "publish_page");
  ok(
    "vacantless step does not say portal",
    !vacantless.some((s) => /portal/i.test(`${s.label} ${s.detail ?? ""}`)),
  );
}
{
  const orgFeed = buildRunSteps("org_feed");
  ok("org feed has feed-ready step", orgFeed[0].key === "check_feed_ready");
}
{
  const noEmDash = buildRunSteps("kijiji")
    .flatMap((s) => [s.label, s.detail ?? ""])
    .join(" ");
  ok("no em dashes in step copy", !/[—–]/.test(noEmDash));
}

// --- progress --------------------------------------------------------------
{
  const p = runProgress([
    { status: "done" },
    { status: "skipped" },
    { status: "pending" },
    { status: "in_progress" },
  ]);
  ok("total 4", p.total === 4);
  ok("done 1", p.done === 1);
  ok("skipped 1", p.skipped === 1);
  ok("resolved 2", p.resolved === 2);
  ok("remaining 2", p.remaining === 2);
  ok("pct 50", p.pct === 50);
  ok("not allResolved", !p.allResolved);
}
{
  const p = runProgress([{ status: "done" }, { status: "skipped" }]);
  ok("allResolved when every item done/skipped", p.allResolved);
  ok("pct 100", p.pct === 100);
}
{
  const p = runProgress([
    { status: "pending", publishStatus: "submitted" },
    { status: "in_progress", publishStatus: "needs_login" },
    { status: "pending", publishStatus: "skipped" },
  ]);
  ok("publish progress leaves submitted open", p.done === 0);
  ok("publish progress counts skipped", p.skipped === 1);
  ok("publish progress leaves submitted and needs_login open", p.remaining === 2);
  ok("publish progress only resolves skipped/live channels", p.pct === 33);
}
{
  const p = runProgress([]);
  ok("empty run pct 0", p.pct === 0);
  ok("empty run not allResolved", !p.allResolved);
}
{
  ok("active channel count is zero before a run starts", activeRunChannelCount({ hasRun: false, runItemCount: 6 }) === 0);
  ok("active channel count uses actual run items after start", activeRunChannelCount({ hasRun: true, runItemCount: 4 }) === 4);
}

// --- automation status (S532) ----------------------------------------------
{
  const auto = automationStatusForItem({
    channel: "vacantless",
    channelLabel: "Vacantless public page",
    mode: "automatic",
    publishStatus: "live",
  });
  ok("automatic live item is live_auto", auto.state === "live_auto");
  ok("automatic live label is honest", /Live automatically/.test(auto.label));
}
{
  const feed = automationStatusForItem({
    channel: "org_feed",
    channelLabel: "Listing feed",
    mode: "automatic",
    publishStatus: "submitted",
  });
  ok("submitted feed is processing, not live_auto", feed.state === "processing");
  ok("submitted feed detail says not proven live", /not proven live/.test(feed.detail));
}
{
  const portal = automationStatusForItem({
    channel: "kijiji",
    channelLabel: "Kijiji",
    mode: "browser_copilot",
    publishStatus: "needs_login",
  });
  ok("portal waiting state is one tap", portal.state === "one_tap");
  ok("portal action is review and post", portal.actionLabel === "Review & post");
}
{
  const stale = automationStatusForItem({
    channel: "facebook",
    channelLabel: "Facebook Marketplace",
    publishStatus: "live",
    staleRefresh: true,
  });
  ok("stale live row needs refresh", stale.state === "needs_refresh");
}
{
  const summary = automationStatusSummary([
    { channel: "vacantless", mode: "automatic", publishStatus: "live" },
    { channel: "org_feed", mode: "automatic", publishStatus: "submitted" },
    { channel: "kijiji", mode: "browser_copilot", publishStatus: "needs_login" },
  ]);
  ok("automation summary counts live auto", summary.liveAuto === 1);
  ok("automation summary counts processing", summary.processing === 1);
  ok("automation summary counts one tap", summary.oneTap === 1);
  ok("automation summary line is ASCII", !/[—–·]/.test(summary.line));
}

// --- selectable channels ---------------------------------------------------
{
  const sel = selectableRunChannels(DISTRIBUTION_CHANNELS, new Set());
  ok("selectable includes all 14 matrix + other = 15", sel.length === 15);
  ok("selectable includes other", sel.some((c) => c.key === "other"));
}
{
  const sel = selectableRunChannels(
    DISTRIBUTION_CHANNELS,
    new Set(["facebook", "other"]),
  );
  ok("excludes already-in-run facebook", !sel.some((c) => c.key === "facebook"));
  ok("excludes already-in-run other", !sel.some((c) => c.key === "other"));
  ok("selectable now 13", sel.length === 13);
}

// --- operator UI source checks ---------------------------------------------
// S695 (DECISION-S694): the assisted launch checklist (launch-run-panel.tsx),
// the pre-Publish-Everywhere simple surface, the control-room summary and the
// basics / posting-mode / health / automation / analytics panels are gone.
// Guard the removal; the surviving Get online tab is Publish Everywhere plus
// the channel cards behind "Advanced".
{
  ok(
    "the assisted launch checklist no longer exists",
    !existsSync("app/dashboard/properties/[id]/launch-run-panel.tsx"),
  );
  const distributeSource = readFileSync(
    "app/dashboard/properties/[id]/distribute-tab.tsx",
    "utf8",
  );
  ok(
    "the Get online tab renders no launch panel or control room",
    !distributeSource.includes("<LaunchRunPanel") &&
      !distributeSource.includes("<PublishControlRoom") &&
      !distributeSource.includes("<PostingModePanel") &&
      !distributeSource.includes("<DistributionStatusStrip") &&
      !distributeSource.includes("function SimpleGetOnline"),
  );
  ok(
    "Publish Everywhere is the one simple surface",
    distributeSource.includes("simple={publishEverywhereSurface}") &&
      distributeSource.includes("<PublishEverywhere"),
  );
}
{
  const distributeSource = readFileSync(
    "app/dashboard/properties/[id]/distribute-tab.tsx",
    "utf8",
  );
  ok(
    "posted links drawer is now a live-ad-link manager",
    distributeSource.includes("Live ad links") &&
      distributeSource.includes("Manage links") &&
      distributeSource.includes("Save the link to your ad"),
  );
  ok(
    "heavier channel tools sit behind per-channel disclosure",
    distributeSource.includes("Posting tools") &&
      distributeSource.includes("Full wording and answers"),
  );
}
{
  const actionsSource = readFileSync(
    "app/dashboard/properties/actions.ts",
    "utf8",
  );
  ok(
    "concierge request fails visibly when queue update fails",
    actionsSource.includes("requestConciergePublish: update failed") &&
      actionsSource.includes("runerr=claimfailed"),
  );
}
{
  const adminConciergeSource = readFileSync(
    "app/dashboard/admin/concierge/page.tsx",
    "utf8",
  );
  ok(
    "admin concierge desk highlights stale unclaimed work",
    adminConciergeSource.includes("STALE_CONCIERGE_QUEUE_MS") &&
      adminConciergeSource.includes("unclaimed for more than 24 hours") &&
      adminConciergeSource.includes("Unclaimed, requested"),
  );
}
// S695: the co-pilot panel and sidecar source assertions were removed with
// the files (DECISION-S694).
{
  const propertyDetailSource = readFileSync(
    "app/dashboard/properties/[id]/page.tsx",
    "utf8",
  );
  // S695: every dist=copilot_* / runerr=needs_valid_url / prooffail notice is
  // gone with its producers (completeCopilotPost, the launch checklist form).
  ok(
    "no orphan posting-proof notice is left on the property page",
    !propertyDetailSource.includes('searchParams.dist === "copilot_') &&
      !propertyDetailSource.includes("proofNotice"),
  );
  // S695 (DECISION-S694): the co-pilot script is gone from the run-item view
  // model; no row can render a sidecar link because there is no sidecar.
  ok(
    "run items no longer build a co-pilot script",
    !propertyDetailSource.includes("buildCopilotScript(") &&
      !propertyDetailSource.includes("copilotScript") &&
      !propertyDetailSource.includes("/copilot/"),
  );
  ok(
    "first screen leads with honest syndication status",
    propertyDetailSource.includes("SyndicationFirstCard") &&
      propertyDetailSource.includes("Your listing needs") &&
      propertyDetailSource.includes("Posting opens once your listing is ready.") &&
      propertyDetailSource.includes("Your listing first. Sign-in and site fees wait inside Post,") &&
      propertyDetailSource.includes("and a site counts as Live only after the link to your ad is saved") &&
      propertyDetailSource.includes("a site counts as Live only after the link to your ad is saved"),
  );
  ok(
    "first screen sends the first listing blocker to its source field",
    propertyDetailSource.includes("SYNDICATION_PACKET_FIELD_TARGETS") &&
      propertyDetailSource.includes('photos: { tab: "market", hash: "#property-photos" }') &&
      propertyDetailSource.includes(
        'description: { tab: "setup", hash: "#listing-description" }',
      ) &&
      propertyDetailSource.includes(
        'property_type: { tab: "setup", hash: "#property-unit-type" }',
      ) &&
      propertyDetailSource.includes("firstListingPacketTarget") &&
      propertyDetailSource.includes("syndicationPacketTargetHref") &&
      propertyDetailSource.includes("packetActionLabel") &&
      propertyDetailSource.includes(
        'firstListingPacketMissingField === "property_type"',
      ) &&
      propertyDetailSource.includes('"Choose property type"'),
  );
  ok(
    "first screen keeps portal complexity compact",
    propertyDetailSource.includes("Your Vacantless page is live") &&
      propertyDetailSource.includes("sites ready") &&
      propertyDetailSource.includes("Not on any rental site") &&
      !propertyDetailSource.includes("places ready") &&
      !propertyDetailSource.includes("Direct portal links") &&
      !propertyDetailSource.includes("readinessSnapshot={readinessSnapshot}"),
  );
  ok(
    "first screen surfaces the specific human blocker",
    propertyDetailSource.includes("buildSyndicationBlockerSummary") &&
      propertyDetailSource.includes("needs payment before you can post it") &&
      propertyDetailSource.includes("blockerSummary={syndicationBlockerSummary}"),
  );
  ok(
    "lifecycle rail is demoted below the main tabs",
    propertyDetailSource.includes("More rental context") &&
      propertyDetailSource.indexOf("</TabbedSections>") <
        propertyDetailSource.indexOf("<LifecycleRail lifecycle"),
  );
}
{
  const propertiesSource = readFileSync("app/dashboard/properties/page.tsx", "utf8");
  const propertyDetailSource = readFileSync(
    "app/dashboard/properties/[id]/page.tsx",
    "utf8",
  );
  ok(
    "properties list opens mobile launch queue entry points",
    // S694 WP2: the labels moved to the word contract ("Ready to post", "Post").
    // The thing guarded is unchanged: the list still surfaces the queue entry
    // points, so the assertion is re-pointed rather than dropped.
    propertiesSource.includes('label: "Ready to post"') &&
      propertiesSource.includes('action: "Post"') &&
      propertiesSource.includes("Live on ${pluralize(livePostCount"),
  );
  const readinessChipsSource = readFileSync(
    "app/dashboard/properties/readiness-chips.tsx",
    "utf8",
  );
  ok(
    "properties list groups readiness pills instead of exposing four raw states",
    readinessChipsSource.includes("Ready online") &&
      readinessChipsSource.includes("Needs") &&
      readinessChipsSource.includes("Get online to launch") &&
      readinessChipsSource.includes("describeSignals(signals)"),
  );
  const distributeSource = readFileSync(
    "app/dashboard/properties/[id]/distribute-tab.tsx",
    "utf8",
  );
  const publishEverywhereSource = readFileSync(
    "app/dashboard/properties/[id]/publish-everywhere.tsx",
    "utf8",
  );
  // S695: the site-picker lifecycle summary went with the launch checklist;
  // the property page no longer builds start channels at all.
  ok(
    "property page no longer builds a launch site picker",
    !propertyDetailSource.includes("publishStartChannels") &&
      !propertyDetailSource.includes("lifecycleSummary: lifecycle.detail"),
  );
  ok(
    "property page scopes packet blockers to active or default launch portals",
    propertyDetailSource.includes("const defaultLaunchPortalChannels") &&
      propertyDetailSource.includes(".filter((meta) => meta.defaultSelected)") &&
      propertyDetailSource.includes("const activeLaunchPortalChannels") &&
      propertyDetailSource.includes("const listingPacketChannels") &&
      propertyDetailSource.includes("channels: listingPacketChannels") &&
      !propertyDetailSource.includes(
        "channels: DISTRIBUTION_CHANNELS.map((channel) => channel.key)",
      ),
  );
  ok(
    "property page derives expiry and takedown attention from run item state",
    propertyDetailSource.includes("distributionLifecycleAttention") &&
      propertyDetailSource.includes("external_expires_at") &&
      propertyDetailSource.includes("const lifecycleAttention = distributionLifecycleAttention") &&
      propertyDetailSource.includes("lifecycleAttention,") &&
      propertyDetailSource.includes("resolveDistributionKeepLiveAction"),
  );
  ok(
    "property type blocker is one tap from Get online to Unit details",
    distributeSource.includes("function packetFieldAction") &&
      distributeSource.includes('field === "property_type" && propertyId') &&
      distributeSource.includes("?tab=setup#property-unit-type") &&
      distributeSource.includes("Choose property type") &&
      distributeSource.includes(
        "Choose the property type to unlock posting to rental sites.",
      ) &&
      distributeSource.includes('primaryMissing?.field === "property_type"') &&
      distributeSource.includes("packetFieldAction(firstListingPacketMissing, propertyId)") &&
      distributeSource.includes("<ListingPacketCard readiness={listingPacket} propertyId={propertyId} />") &&
      distributeSource.includes("action: firstListingPacketAction.action"),
  );
  ok(
    "packet blockers win before relist and outside-site actions",
    propertyDetailSource.includes(": packetBlocked || needsListingWork") &&
      propertyDetailSource.includes(
        "listingPacketReadiness.missingRequired.length === 0",
      ),
  );
  ok(
    "publish everywhere defers site actions behind one-listing blockers",
    distributeSource.includes("publishEverywherePostingBlocker") &&
      distributeSource.includes("postingBlocker={publishEverywherePostingBlocker}") &&
      publishEverywhereSource.includes(
        "postingBlocker?: PublishEverywherePostingBlocker | null",
      ) &&
      publishEverywhereSource.includes("postingBlocked && !isLive") &&
      publishEverywhereSource.indexOf("postingBlocked && !isLive") <
        publishEverywhereSource.indexOf("item == null ? (") &&
      publishEverywhereSource.includes("conciergeDeskEnabled && !postingBlocker"),
  );
  // S695: the control room is gone; entry links land on the tab header.
  ok(
    "mobile entry links land on the Get online header",
    propertiesSource.includes("tab=distribute#distribute-header") &&
      propertyDetailSource.includes("tab=distribute#distribute-header") &&
      !propertiesSource.includes("#publish-control-room") &&
      !propertyDetailSource.includes("#publish-control-room"),
  );
}

console.log(`\ndistribution-run: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
