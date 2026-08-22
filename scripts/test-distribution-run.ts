// Unit tests for the pure distribution-run helpers.
// Run: npx tsx scripts/test-distribution-run.ts
import { readFileSync } from "fs";
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
  const fb = buildRunSteps("facebook", { guardrailCount: 5 });
  ok("facebook has an open step first", fb[0].key === "open");
  ok("facebook has a copy-title step", fb.some((s) => s.key === "title"));
  ok(
    "facebook photo step mentions duplicate/QR",
    fb.some((s) => s.key === "photos" && /duplicate|QR/.test(s.detail ?? "")),
  );
  ok(
    "facebook includes a gotchas step when guardrails > 0",
    fb.some((s) => s.key === "gotchas" && s.label.includes("5")),
  );
  ok("facebook ends with paste_url", fb[fb.length - 1].key === "paste_url");
}
{
  const fbNoGuard = buildRunSteps("facebook", { guardrailCount: 0 });
  ok(
    "no gotchas step when guardrailCount 0",
    !fbNoGuard.some((s) => s.key === "gotchas"),
  );
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
  const noEmDash = buildRunSteps("kijiji", { guardrailCount: 2 })
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
  ok("selectable includes all 12 matrix + other = 13", sel.length === 13);
  ok("selectable includes other", sel.some((c) => c.key === "other"));
}
{
  const sel = selectableRunChannels(
    DISTRIBUTION_CHANNELS,
    new Set(["facebook", "other"]),
  );
  ok("excludes already-in-run facebook", !sel.some((c) => c.key === "facebook"));
  ok("excludes already-in-run other", !sel.some((c) => c.key === "other"));
  ok("selectable now 11", sel.length === 11);
}

// --- operator UI source checks ---------------------------------------------
{
  const panelSource = readFileSync(
    "app/dashboard/properties/[id]/launch-run-panel.tsx",
    "utf8",
  );
  ok("operator guide leads with what to do next", panelSource.includes("What to do next"));
  ok(
    "operator guide links to the priority item by site name",
    panelSource.includes("Go to {priorityItem.channelLabel} step"),
  );
  ok(
    "operator guide explains proof before live",
    panelSource.includes("outside sites only count as Live after proof is saved"),
  );
  ok(
    "priority (and concierge target) channel opens by default",
    panelSource.includes("priorityItem?.id === item.id") &&
      panelSource.includes("conciergeAnchorItem?.id === item.id"),
  );
  ok(
    "channel rows have stable run-item anchors",
    panelSource.includes("id={`run-item-${item.id}`}"),
  );
  ok(
    "browser co-pilot summary explains front-screen helper",
    panelSource.includes("The helper opens in front of you"),
  );
  ok(
    "site picker and active run list stay compact when sites grow",
    panelSource.includes("max-h-80 overflow-y-auto") &&
      panelSource.includes("max-h-[42rem]") &&
      panelSource.includes("Other tracking") &&
      panelSource.includes("Connect accounts"),
  );
}
{
  const distributeSource = readFileSync(
    "app/dashboard/properties/[id]/distribute-tab.tsx",
    "utf8",
  );
  ok(
    "next banner explains outside-site approval",
    distributeSource.includes("You still approve") &&
      distributeSource.includes("a site counts as Live") &&
      distributeSource.includes("after the real ad link is saved"),
  );
  ok(
    "done-for-you posting is front of the collapsed status strip",
    distributeSource.indexOf("<PostingModePanel") > -1 &&
      distributeSource.indexOf("<DistributionStatusStrip") > -1 &&
      distributeSource.indexOf("<PostingModePanel") <
        distributeSource.indexOf("<DistributionStatusStrip"),
  );
  ok(
    "front done-for-you CTA submits instead of only jumping",
    distributeSource.includes("form action={requestConciergePublish}") &&
      distributeSource.includes("target={conciergeTarget ?? null}") &&
      distributeSource.includes("Ask Vacantless to post it"),
  );
  ok(
    "already-queued desk work is labeled as in progress",
    distributeSource.includes("Vacantless is already posting") &&
      distributeSource.includes("View desk status") &&
      distributeSource.includes("No second click is needed"),
  );
  ok(
    "distribution dashboard uses plain four-part model",
      distributeSource.includes("Distribution") &&
      distributeSource.includes("Property") &&
      distributeSource.includes("Sites") &&
      distributeSource.includes("Account access") &&
      distributeSource.includes("Top-up help"),
  );
  ok(
    "posting choice treats self-serve as the fallback path",
    distributeSource.includes("Done-for-you / top-up") &&
      distributeSource.includes("Pay Vacantless to post") &&
      distributeSource.includes("Use a site yourself instead") &&
      distributeSource.includes("Open posting checklist"),
  );
  ok(
    "already-queued desk work shows request date when available",
    distributeSource.includes("conciergeRequestedDate") &&
      distributeSource.includes("activeItem?.conciergeRequestedAt"),
  );
  ok(
    "posted links drawer is now a live-ad-link manager",
    distributeSource.includes("Live ad links") &&
      distributeSource.includes("Manage links") &&
      distributeSource.includes("Save live ad URL"),
  );
  ok(
    "heavier channel tools sit behind per-channel disclosure",
    distributeSource.includes("Posting tools") &&
      distributeSource.includes("Full copy &amp; field sheet"),
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
{
  const copilotSource = readFileSync(
    "app/dashboard/properties/[id]/copilot-panel.tsx",
    "utf8",
  );
  ok(
    "posting assist primary CTA starts the flow",
    copilotSource.includes("Open helper window") &&
      copilotSource.includes("If nothing opens, use the copy and steps below."),
  );
  ok(
    "posting assist explains front and back of screen",
    copilotSource.includes("On your screen") &&
      copilotSource.includes("Behind the scenes"),
  );
  ok(
    "posting assist explains how completion is shown",
    copilotSource.includes("How you know it is done") &&
      copilotSource.includes("checklist progress updates"),
  );
  ok(
    "posting assist stays honest about no silent automation",
    copilotSource.includes("Nothing is posted or paid") &&
      copilotSource.includes("does not log in, pay"),
  );
}
{
  const sidecarSource = readFileSync(
    "app/dashboard/properties/[id]/copilot/[itemId]/sidecar-copilot.tsx",
    "utf8",
  );
  ok(
    "sidecar repeats the three-step posting assist model",
    sidecarSource.includes("1. Open the posting page") &&
      sidecarSource.includes("2. You approve the post") &&
      sidecarSource.includes("3. Save the live ad URL"),
  );
  ok(
    "sidecar explains the main checklist update",
    sidecarSource.includes("the main checklist shows Live"),
  );
}
{
  const propertyDetailSource = readFileSync(
    "app/dashboard/properties/[id]/page.tsx",
    "utf8",
  );
  ok(
    "posting proof success return notice is explicit",
    propertyDetailSource.includes("Posting proof saved.") &&
      propertyDetailSource.includes("checklist progress and proof link update here"),
  );
  ok(
    "posting proof missing URL return notice is explicit",
    propertyDetailSource.includes("Live ad URL needed.") &&
      propertyDetailSource.includes("Vacantless did not mark this channel Live"),
  );
  ok(
    "concierge rows do not render a broken posting-assist sidecar",
    propertyDetailSource.includes('mode === "browser_copilot" &&') &&
      propertyDetailSource.includes("isCopilotChannel(publishKey)"),
  );
  ok(
    "first screen leads with honest syndication status",
    propertyDetailSource.includes("SyndicationFirstCard") &&
      propertyDetailSource.includes("One listing needs") &&
      propertyDetailSource.includes("The 1-tap queue opens after the listing facts are ready.") &&
      propertyDetailSource.includes("One listing first. Sign-in, payment, and proof wait inside Get") &&
      propertyDetailSource.includes("online, and outside sites count as Live only after proof is saved") &&
      propertyDetailSource.includes("outside sites count as Live only after proof is saved"),
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
      propertyDetailSource.includes("packetActionLabel"),
  );
  ok(
    "first screen keeps portal complexity compact",
    propertyDetailSource.includes("Renter page live") &&
      propertyDetailSource.includes("sites ready") &&
      propertyDetailSource.includes("Outside ads not live") &&
      !propertyDetailSource.includes("places ready") &&
      !propertyDetailSource.includes("Direct portal links") &&
      !propertyDetailSource.includes("readinessSnapshot={readinessSnapshot}"),
  );
  ok(
    "first screen surfaces the specific human blocker",
    propertyDetailSource.includes("buildSyndicationBlockerSummary") &&
      propertyDetailSource.includes("needs payment before it can go live") &&
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
    propertiesSource.includes("Ready for Set Live") &&
      propertiesSource.includes("Get online") &&
      propertiesSource.includes("Proof saved on"),
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
  const channelRailSource = readFileSync(
    "app/dashboard/properties/[id]/channel-publish-rail.tsx",
    "utf8",
  );
  const launchRunPanelSource = readFileSync(
    "app/dashboard/properties/[id]/launch-run-panel.tsx",
    "utf8",
  );
  const publishEverywhereSource = readFileSync(
    "app/dashboard/properties/[id]/publish-everywhere.tsx",
    "utf8",
  );
  ok(
    "distribute tab leads with get online checklist buckets",
    distributeSource.includes("Get online checklist") &&
      distributeSource.includes("Start posting steps") &&
      distributeSource.includes("Review posting steps") &&
      distributeSource.includes("Live outside") &&
      distributeSource.includes("Ready now") &&
      distributeSource.includes("visibleBuckets") &&
      distributeSource.includes("Renter page") &&
      distributeSource.includes("Outside ads") &&
      distributeSource.includes("Ready to post") &&
      distributeSource.includes("Needs payment") &&
      distributeSource.includes("Needs sign-in") &&
      distributeSource.includes("Needs proof") &&
      distributeSource.includes("Refresh due") &&
      distributeSource.includes("Blocked") &&
      distributeSource.includes("Nothing is posted automatically. You approve outside-site posts"),
  );
  ok(
    "publish control room derives blocker buckets from raw publish status",
    distributeSource.includes("buildPublishControlRoomBuckets") &&
      distributeSource.includes("choice.status") &&
      propertyDetailSource.includes("status: plan.status"),
  );
  ok(
    "publish control room is the first distribute-tab action surface",
    distributeSource.includes('id="publish-control-room"') &&
      distributeSource.indexOf("<PublishControlRoom") <
      distributeSource.indexOf('id="distribute-header"'),
  );
  ok(
    "publish control room replaces the duplicate get-online hero stack",
      distributeSource.includes("showSummaryCard={false}") &&
      distributeSource.includes('selectedChannelCount === 1 ? "site" : "sites"') &&
      channelRailSource.includes("Posting plan") &&
      channelRailSource.includes("Vacantless posts first; you handle exceptions.") &&
      channelRailSource.includes("Use this site yourself") &&
      channelRailSource.includes("Open site") &&
      !distributeSource.includes("Get this listing online") &&
      !distributeSource.includes("Ready to syndicate"),
  );
  ok(
    "launch queue defers to setup blockers before portal steps",
    distributeSource.includes("launchSetupBlocker") &&
      distributeSource.includes("Finish the one listing details first.") &&
      distributeSource.includes("setupBlocker={launchSetupBlocker}") &&
      distributeSource.includes("showAction={false}") &&
      distributeSource.includes("No posting yet") &&
      distributeSource.includes("Posting help included") &&
      distributeSource.includes("{!packetBlocked && (") &&
      launchRunPanelSource.includes("Waiting on one listing") &&
      launchRunPanelSource.indexOf("if (setupBlocker)") <
        launchRunPanelSource.indexOf("if (!run)") &&
      launchRunPanelSource.includes("{setupBlocker.action}"),
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
  ok(
    "mobile entry links land on the publish control room",
    propertiesSource.includes("tab=distribute#publish-control-room") &&
      propertyDetailSource.includes("tab=distribute#publish-control-room"),
  );
}

console.log(`\ndistribution-run: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
