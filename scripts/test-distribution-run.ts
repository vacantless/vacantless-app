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
  ok("selectable includes all 7 matrix + other = 8", sel.length === 8);
  ok("selectable includes other", sel.some((c) => c.key === "other"));
}
{
  const sel = selectableRunChannels(
    DISTRIBUTION_CHANNELS,
    new Set(["facebook", "other"]),
  );
  ok("excludes already-in-run facebook", !sel.some((c) => c.key === "facebook"));
  ok("excludes already-in-run other", !sel.some((c) => c.key === "other"));
  ok("selectable now 6", sel.length === 6);
}

// --- operator UI source checks ---------------------------------------------
{
  const panelSource = readFileSync(
    "app/dashboard/properties/[id]/launch-run-panel.tsx",
    "utf8",
  );
  ok("operator guide leads with what to do next", panelSource.includes("What to do next"));
  ok("operator guide links to the priority item", panelSource.includes("Open this step"));
  ok(
    "operator guide explains proof before live",
    panelSource.includes("only counts as Live after proof is saved"),
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
}
{
  const distributeSource = readFileSync(
    "app/dashboard/properties/[id]/distribute-tab.tsx",
    "utf8",
  );
  ok(
    "next banner explains outside-site approval",
    distributeSource.includes("You still approve") &&
      distributeSource.includes("only after real proof is saved"),
  );
}
{
  const copilotSource = readFileSync(
    "app/dashboard/properties/[id]/copilot-panel.tsx",
    "utf8",
  );
  ok(
    "guided posting primary CTA starts the flow",
    copilotSource.includes("Start guided posting"),
  );
  ok(
    "guided posting explains front and back of screen",
    copilotSource.includes("On your screen") &&
      copilotSource.includes("Behind the scenes"),
  );
  ok(
    "guided posting explains how completion is shown",
    copilotSource.includes("How you know it is done") &&
      copilotSource.includes("checklist progress updates"),
  );
  ok(
    "guided posting stays honest about no silent automation",
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
    "sidecar repeats the three-step guided posting model",
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
    "guided posting success return notice is explicit",
    propertyDetailSource.includes("Guided posting saved.") &&
      propertyDetailSource.includes("checklist progress and proof link update here"),
  );
  ok(
    "guided posting missing URL return notice is explicit",
    propertyDetailSource.includes("Live ad URL needed.") &&
      propertyDetailSource.includes("Vacantless did not mark this channel Live"),
  );
}
{
  const propertiesSource = readFileSync("app/dashboard/properties/page.tsx", "utf8");
  ok(
    "properties list opens marketing checklist",
    propertiesSource.includes("Marketing checklist"),
  );
}

console.log(`\ndistribution-run: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
