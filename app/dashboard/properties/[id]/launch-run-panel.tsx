// Assisted launch-run panel (S412 Slice 2). Server component. A saved, resumable
// posting session: pick channels -> work each as a checklist -> mark done +
// paste the live URL (which produces the tracked listing_posts row). Renders at
// the top of the Distribute tab, above the channel cards.

import Link from "next/link";
import { CopyLink } from "./copy-link";
import { CopilotPanel } from "./copilot-panel";
import {
  startDistributionRun,
  updateRunItem,
  addRunChannel,
  cancelDistributionRun,
  requestConciergePublish,
} from "../actions";
import {
  verifyPublicPage,
  verifyOrgFeedInclusion,
  recordItemProof,
  authorizeAutopilotSubmit,
  confirmLeaseupTakedownRemovedAction,
  setRelistRadarStandingAutoRefresh,
} from "../distribution-actions";
import {
  verificationResultLabel,
  verificationResultTone,
} from "@/lib/distribution-verification";
import type { CopilotScript } from "@/lib/distribution-copilot";
import {
  automationStatusForItem,
  type AutomationStatusState,
  type RunItemStatus,
  type RunStep,
  type RunProgress,
} from "@/lib/distribution-run";
import {
  PUBLISH_STATUSES,
  publishStatusLabel,
  publishModeLabel,
  type PublishMode,
  type PublishStatus,
  type PublishTone,
} from "@/lib/distribution-publish";
import {
  groupByDistributionChannelDisplayGroup,
  type ChannelCategory,
} from "@/lib/distribution-channels";

export type RunItemView = {
  id: string;
  channel: string;
  channelLabel: string;
  status: RunItemStatus;
  publishStatus: PublishStatus;
  statusLabel: string;
  statusTone: PublishTone;
  mode: PublishMode;
  modeLabel: string;
  blockers: string[];
  operatorActionUrl: string | null;
  auditMessage: string | null;
  errorMessage: string | null;
  externalUrl: string | null;
  trackedUrl: string | null;
  notes: string | null;
  steps: RunStep[];
  // S474b: this human-action item can be handed to the Vacantless publishing
  // desk ("Publish for me"). Computed with the operator's plan entitlement.
  canConcierge: boolean;
  // S570: org-owner approval for a prepared autopilot item; independent from
  // canConcierge because concierge-mode items cannot request concierge again.
  canAutopilot?: boolean;
  autopilotApproved?: boolean;
  canRelistRadarAutoRefresh?: boolean;
  relistRadarAutoRefreshOn?: boolean;
  // S480: honest transport + durable verification state + latest proof link.
  transport: string | null;
  verificationStatus: string | null;
  proofUrl: string | null;
  conciergeRequestedAt: string | null;
  // S482: the honest browser co-pilot posting-assist script (copilot channels).
  copilotScript: CopilotScript | null;
  // S488 Slice 1: merged from the retired where-posted grid so the command
  // center carries one status vocabulary. Both are derived in page.tsx from the
  // channel's listing_posts (no schema change):
  //  - staleRefresh: a live ad exists but is stale/expired/removed (needs_refresh).
  //  - liveWithoutUrl: a row is marked live but has no ad URL (the grid's
  //    "problem" state). Codex P3: must render red "Needs ad URL", never as Live.
  staleRefresh?: boolean;
  liveWithoutUrl?: boolean;
};

export type PublishChannelChoiceView = {
  key: string;
  label: string;
  category: ChannelCategory | null;
  displayOrder: number | null;
  modeLabel: string;
  status: PublishStatus;
  statusLabel: string;
  statusTone: PublishTone;
  description: string;
  blockers: string[];
  defaultSelected: boolean;
  // S480: pre-Publish channel setup readiness.
  readinessLabel: string;
  readinessTone: PublishTone;
  setupBlockers: string[];
};

const FIELD_CLASS =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";
const PRIMARY_BTN = "rounded-lg px-4 py-2 text-sm font-medium text-white";

const STATUS_CHIP: Record<PublishTone, string> = {
  positive: "bg-green-50 text-green-700",
  warning: "bg-amber-50 text-amber-700",
  danger: "bg-red-50 text-red-700",
  neutral: "bg-gray-100 text-gray-600",
};

const AUTOMATION_DOT_CLASS: Record<AutomationStatusState, string> = {
  live_auto: "bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.16)]",
  processing: "bg-emerald-500",
  one_tap: "bg-amber-500",
  needs_refresh: "bg-blue-500",
  blocked: "bg-red-500",
  idle: "bg-gray-400",
};

function hasDisplayCategory(
  choice: PublishChannelChoiceView,
): choice is PublishChannelChoiceView & { category: ChannelCategory } {
  return choice.category != null;
}

function sortedDisplayChoices(channels: PublishChannelChoiceView[]) {
  return channels
    .filter(hasDisplayCategory)
    .sort(
      (a, b) =>
        (a.displayOrder ?? Number.MAX_SAFE_INTEGER) -
        (b.displayOrder ?? Number.MAX_SAFE_INTEGER),
    );
}

function groupedDisplayChoices(channels: PublishChannelChoiceView[]) {
  return groupByDistributionChannelDisplayGroup(
    sortedDisplayChoices(channels),
    (channel) => channel.category,
  );
}

function AutomationDot({ state }: { state: AutomationStatusState }) {
  return (
    <span
      aria-hidden="true"
      className="relative inline-flex h-2.5 w-2.5 shrink-0 items-center justify-center"
    >
      {state === "processing" && (
        <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 motion-safe:animate-ping" />
      )}
      <span
        className={`relative inline-flex h-2.5 w-2.5 rounded-full ${AUTOMATION_DOT_CLASS[state]}`}
      />
    </span>
  );
}

function DisplayStatusChip({ item }: { item: RunItemView }) {
  const shown = displayStatus(item);
  const automation = automationStatusForItem(item);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_CHIP[shown.tone]}`}
      title={automation.detail}
    >
      <AutomationDot state={automation.state} />
      {shown.label}
    </span>
  );
}

// Slice 1: the single derived status chip for a run row. Folds the two former
// vocabularies (PublishStatus + the grid's ChannelStatusValue) into one, and
// applies the two Codex P3s:
//  - liveWithoutUrl (the grid's "problem") -> red "Needs ad URL", never Live.
//  - submitted must NOT read as Live: its default tone is `positive`, so we
//    override to warning + "Submitted to feed - not live yet".
//  - staleRefresh (needs_refresh) -> amber "Needs refresh".
function displayStatus(item: RunItemView): { label: string; tone: PublishTone } {
  if (isRemovedTakedownItem(item)) return { label: "Removed", tone: "positive" };
  if (item.liveWithoutUrl) return { label: "Needs ad URL", tone: "danger" };
  if (item.staleRefresh) return { label: "Needs refresh", tone: "warning" };
  if (item.publishStatus === "submitted")
    return { label: "Submitted to feed - not live yet", tone: "warning" };
  return { label: item.statusLabel, tone: item.statusTone };
}

function isTakedownItem(item: RunItemView): boolean {
  return item.transport === "takedown";
}

function isOperatorTakedownItem(item: RunItemView): boolean {
  return isTakedownItem(item) && item.publishStatus === "needs_operator";
}

function isRemovedTakedownItem(item: RunItemView): boolean {
  return isTakedownItem(item) && item.publishStatus === "skipped" && item.status === "done";
}

function nextActionLabel(item: RunItemView): string {
  if (isTakedownItem(item)) return "Open the ad";
  if (item.channel === "vacantless") return "Open renter page";
  if (item.channel === "org_feed") return "Open listing feed";
  if (item.mode === "broker") return "Open broker page";
  if (item.mode === "feed_partner") return "Open feed or partner page";
  return `Open ${item.channelLabel}`;
}

function urlFieldLabel(item: RunItemView): string {
  if (item.channel === "vacantless") return "Renter page URL";
  if (item.channel === "org_feed") return "Feed URL";
  if (item.mode === "feed_partner") return "Feed or partner URL";
  if (item.mode === "broker") return "Broker or MLS URL";
  return "Live ad URL";
}

const OPERATOR_ACTION_WEIGHT: Partial<Record<PublishStatus, number>> = {
  needs_payment: 1,
  needs_login: 1,
  needs_operator: 2,
  queued: 3,
};

function operatorActionWeight(item: RunItemView): number | null {
  if (item.liveWithoutUrl) return 0;
  if (item.staleRefresh) return 1;
  return OPERATOR_ACTION_WEIGHT[item.publishStatus] ?? null;
}

function primaryOperatorItem(items: RunItemView[]): RunItemView | null {
  let best: { weight: number; index: number; item: RunItemView } | null = null;
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const weight = operatorActionWeight(item);
    if (weight == null) continue;
    if (
      !best ||
      weight < best.weight ||
      (weight === best.weight && index < best.index)
    ) {
      best = { weight, index, item };
    }
  }
  return best?.item ?? null;
}

function operatorActionSummary(item: RunItemView): string {
  if (isTakedownItem(item)) {
    if (isRemovedTakedownItem(item)) return `${item.channelLabel} ad removal is recorded.`;
    if (item.publishStatus === "queued") return `${item.channelLabel} ad removal is queued.`;
    return `Remove the ${item.channelLabel} ad, then mark it removed.`;
  }
  if (item.liveWithoutUrl) {
    return "Paste the real live ad URL before this site can count as Live.";
  }
  if (item.staleRefresh) {
    return "Refresh this ad, then save fresh proof so renters do not hit an old listing.";
  }
  if (item.mode === "browser_copilot") {
    switch (item.publishStatus) {
      case "needs_payment":
        return `Open the ${item.channelLabel} posting step; you approve any payment, then save the live ad URL.`;
      case "needs_login":
        return `Open the ${item.channelLabel} posting step; you sign in and post, then save the live ad URL.`;
      case "needs_operator":
      case "queued":
        return `Open the ${item.channelLabel} posting step; Vacantless prepares the post and waits for your live ad URL.`;
    }
  }
  switch (item.publishStatus) {
    case "needs_payment":
      return `Sign in or pay on ${item.channelLabel}, then paste the live ad URL here.`;
    case "needs_login":
      return `Sign in on ${item.channelLabel}, finish the post, then paste the live ad URL here.`;
    case "needs_operator":
      return `Follow the ${item.channelLabel} steps, then save proof when the post is really live.`;
    case "queued":
      return `Start ${item.channelLabel} when you are ready to work this channel.`;
    case "submitting":
      return `${item.channelLabel} is being submitted. Check back for proof before calling it Live.`;
    case "submitted":
      return `${item.channelLabel} was submitted, but that does not mean it is live on the partner site yet.`;
    case "live":
      return `${item.channelLabel} already has live proof. No action needed unless the ad changes.`;
    case "blocked":
      return `${item.channelLabel} is blocked. Fix the setup issue before posting.`;
    case "rejected":
      return `${item.channelLabel} was rejected. Review the note before trying again.`;
    case "skipped":
      return `${item.channelLabel} is skipped for this run.`;
  }
}

function operatorOwnerLine(item: RunItemView): string {
  if (isTakedownItem(item)) {
    return "Vacantless keeps the tracker row for attribution and records your removal confirmation here.";
  }
  if (item.channel === "facebook_feed") {
    return "Vacantless can post to the connected Facebook Page only after you authorize this item. It still needs Graph API proof before it counts as Live.";
  }
  if (item.mode === "automatic") {
    return "Vacantless can check this inside the app, then it saves proof here.";
  }
  if (item.mode === "feed_partner") {
    return "Vacantless prepares the feed; a partner site may still need to accept it before it is truly live.";
  }
  if (item.mode === "browser_copilot") {
    return "The helper opens in front of you with copy and proof fields. Behind the scenes, Vacantless tracks this site as waiting until you save the real ad URL.";
  }
  if (item.mode === "concierge") {
    return "The Vacantless publishing desk can work this, but it still needs real live-ad proof before it counts.";
  }
  if (item.mode === "broker") {
    return "A licensed broker or agent must complete the outside listing; Vacantless only tracks the proof.";
  }
  return "Use this to track another place you posted, so leads can be counted correctly.";
}

export function LaunchRunPanel({
  propertyId,
  run,
  items,
  progress,
  selectable,
  startChannels,
  realtorReferralEnabled,
  leaseupTakedownEnabled,
  setupBlocker,
}: {
  propertyId: string;
  run: { id: string } | null;
  items: RunItemView[];
  progress: RunProgress;
  // Channels not yet in the run (for "add another channel").
  selectable: PublishChannelChoiceView[];
  // All channels offered when STARTING a run.
  startChannels: PublishChannelChoiceView[];
  // Distribution Lane B: the RECO referral firewall (REALTOR_REFERRAL_ENABLED).
  // When off, Realtor.ca shows only the "your own agent" broker handoff — never
  // the "dispatch a network agent" referral.
  realtorReferralEnabled: boolean;
  leaseupTakedownEnabled: boolean;
  setupBlocker?: {
    title: string;
    detail: string;
    href: string;
    action: string;
  } | null;
}) {
  // S588: gated entry into the distribution wizard for this listing.
  // Dark like the nav entry — only shows when DISTRIBUTION_WIZARD_ENABLED is set.
  const wizardEnabled = process.env.DISTRIBUTION_WIZARD_ENABLED === "1";
  const guidedHref = `/dashboard/link-portals?property=${encodeURIComponent(
    propertyId,
  )}`;
  const coreStartChannels = startChannels.filter(
    (channel) => channel.category == null && channel.defaultSelected,
  );
  const extraCoreStartChannels = startChannels.filter(
    (channel) => channel.category == null && !channel.defaultSelected,
  );
  const startChannelGroups = groupedDisplayChoices(startChannels);
  const selectableCoreChannels = selectable.filter(
    (channel) => channel.category == null,
  );
  const selectableChannelGroups = groupedDisplayChoices(selectable);
  const firstSelectableChoice =
    selectableCoreChannels[0] ?? selectableChannelGroups[0]?.items[0] ?? selectable[0];
  const renderStartChannelRows = (channels: PublishChannelChoiceView[]) =>
    channels.map((c) => {
      const brokerRail = c.key === "realtor_ca" || c.modeLabel === "Broker / MLS";
      return (
        <label
          key={c.key}
          className={`flex cursor-pointer items-center gap-3 border-b border-slate-100 px-3 py-2.5 text-sm last:border-b-0 ${
            brokerRail
              ? "border-l-4 border-l-slate-400 bg-slate-50 text-slate-800 hover:bg-slate-100"
              : "text-gray-700 hover:bg-slate-50"
          }`}
          title={c.description}
        >
          <input
            type="checkbox"
            name="channels"
            value={c.key}
            defaultChecked={c.defaultSelected}
            className="shrink-0"
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-gray-900">
              {c.label}
            </span>
            {(c.blockers.length > 0 || c.setupBlockers.length > 0) && (
              <span className="block truncate text-[11px] text-amber-700">
                {c.blockers[0] ?? c.setupBlockers[0]}
              </span>
            )}
          </span>
          <span
            className={`hidden shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium sm:inline-flex ${
              brokerRail ? "bg-slate-900 text-white" : "bg-gray-100 text-gray-600"
            }`}
          >
            {c.modeLabel}
          </span>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_CHIP[c.readinessTone]}`}
          >
            {c.readinessLabel}
          </span>
          {c.defaultSelected && (
            <span className="hidden shrink-0 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand sm:inline-flex">
              Suggested
            </span>
          )}
        </label>
      );
    });
  const renderStartChannelGroups = (
    groups: ReturnType<typeof groupedDisplayChoices>,
  ) =>
    groups.map(({ group, items }) => (
      <section key={group.id} className="border-t border-slate-100">
        <h4 className="bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          {group.title}
        </h4>
        <div>{renderStartChannelRows(items)}</div>
      </section>
    ));
  const renderSelectableOptions = () => (
    <>
      {selectableCoreChannels.map((c) => (
        <option key={c.key} value={c.key}>
          {c.label} - {c.modeLabel}
        </option>
      ))}
      {selectableChannelGroups.map(({ group, items }) => (
        <optgroup key={group.id} label={group.title}>
          {items.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label} - {c.modeLabel}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );

  // No active run: offer to start one.
  if (!run) {
    return (
      <div
        id="publish-checklist"
        className="mb-4 scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-gray-950">
            Rental sites
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            {wizardEnabled && (
              <Link
                href={guidedHref}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Portal setup
              </Link>
            )}
            <Link
              href="/dashboard/settings?tab=distribution"
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Connect accounts
            </Link>
          </div>
        </div>
        <p className="mb-3 text-xs text-gray-500">Pick the sites where renters find this listing.</p>
        <form action={startDistributionRun}>
          <input type="hidden" name="property_id" value={propertyId} />
          <div className="mb-3 max-h-80 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-inner">
            {renderStartChannelRows(coreStartChannels)}
            {renderStartChannelGroups(startChannelGroups)}
            {extraCoreStartChannels.length > 0 && (
              <details className="border-t border-slate-100">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
                  <span>Other tracking</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                    {extraCoreStartChannels.length}
                  </span>
                </summary>
                <div className="border-t border-slate-100">
                  {renderStartChannelRows(extraCoreStartChannels)}
                </div>
              </details>
            )}
          </div>
          <button
            type="submit"
            className={PRIMARY_BTN}
            style={{ backgroundColor: "var(--brand-color)" }}
          >
            Add these sites
          </button>
        </form>
      </div>
    );
  }

  // Active run: progress + per-channel checklists.
  const priorityItem = primaryOperatorItem(items);
  const conciergeAnchorItem =
    items.find(
      (item) =>
        item.canConcierge &&
        (item.channel !== "realtor_ca" || realtorReferralEnabled),
    ) ?? null;
  const renterPageDone = items.some(
    (item) =>
      item.channel === "vacantless" &&
      item.publishStatus === "live" &&
      !item.staleRefresh &&
      !item.liveWithoutUrl,
  );
  const outsideItems = items.filter((item) => item.channel !== "vacantless");
  const outsideLiveProofCount = outsideItems.filter(
    (item) =>
      item.publishStatus === "live" &&
      !item.staleRefresh &&
      !item.liveWithoutUrl,
  ).length;
  const queueProgressLabel = renterPageDone
    ? `Renter page done · ${outsideLiveProofCount} of ${outsideItems.length} outside sites live`
    : `${outsideLiveProofCount} of ${outsideItems.length} outside sites live`;

  if (setupBlocker) {
    return (
      <div
        id="publish-checklist"
        className="mb-4 scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-gray-950">
            1-tap queue
          </h3>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
            {items.length} {items.length === 1 ? "site" : "sites"} waiting
          </span>
        </div>
        <div className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
          <div
            className="h-full rounded-full bg-brand"
            style={{ width: `${progress.pct}%` }}
          />
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">
            Waiting on one listing
          </p>
          <p className="mt-1 text-base font-semibold text-amber-950">
            {setupBlocker.title}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-amber-900">
            {setupBlocker.detail}
          </p>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
          {renterPageDone && (
            <span className="rounded-full bg-green-50 px-2.5 py-1 font-semibold text-green-700">
              Renter page done
            </span>
          )}
          <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold">
            {outsideLiveProofCount} of {outsideItems.length} outside sites live
          </span>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold">
            Sign-in, payment, and proof later
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      id="publish-checklist"
      className="mb-4 scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-950">
          Rental sites
        </h3>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/dashboard/settings?tab=distribution"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Connect accounts
          </Link>
          <span className="text-xs font-medium text-gray-600">
            {queueProgressLabel}
          </span>
        </div>
      </div>
      <div className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
        <div
          className="h-full rounded-full bg-brand"
          style={{ width: `${progress.pct}%` }}
        />
      </div>
      <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-brand">
              What to do next
            </p>
            <p className="mt-1 text-base font-semibold text-gray-900">
              {priorityItem
                ? operatorActionSummary(priorityItem)
                : "No urgent publishing step. Keep an eye on refresh due dates or add another site."}
            </p>
            <p className="mt-2 text-xs text-gray-600">
              {priorityItem
                ? operatorOwnerLine(priorityItem)
                : "Your public page and finished sites stay tracked here. Submitted feed rows are not treated as Live until the real ad link exists."}
            </p>
            <p className="mt-2 text-xs text-gray-500">
              {outsideLiveProofCount} of {outsideItems.length} outside sites
              have a live ad link. The renter page is tracked separately, and
              outside sites only count as Live after proof is saved.
            </p>
          </div>
          {priorityItem && (
            <a
              href={`#run-item-${priorityItem.id}`}
              className="shrink-0 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white hover:opacity-90"
            >
              Go to {priorityItem.channelLabel} step
            </a>
          )}
        </div>
      </div>

      <ul className="max-h-[42rem] space-y-2 overflow-y-auto pr-1">
        {items.map((item) => (
          <li
            key={item.id}
            id={`run-item-${item.id}`}
            className="rounded-xl border border-gray-200 bg-white px-4 py-3"
          >
            {item.canConcierge &&
              (item.channel !== "realtor_ca" || realtorReferralEnabled) && (
                <span id={`concierge-${item.id}`} className="block scroll-mt-6" />
              )}
            <details
              open={
                priorityItem?.id === item.id ||
                conciergeAnchorItem?.id === item.id
              }
              className="group"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">
                      {item.channelLabel}
                    </span>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                      {publishModeLabel(item.mode)}
                    </span>
                    <DisplayStatusChip item={item} />
                    {item.verificationStatus && !isRemovedTakedownItem(item) && (
                      <span
                        title="Verification"
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_CHIP[verificationResultTone(item.verificationStatus)]}`}
                      >
                        {verificationResultLabel(item.verificationStatus)}
                      </span>
                    )}
                  </div>
                </div>
                <span className="mt-0.5 text-xs font-medium text-brand group-open:hidden">
                  Details
                </span>
                <span className="mt-0.5 hidden text-xs font-medium text-gray-400 group-open:inline">
                  Hide
                </span>
              </summary>

              <div className="mt-3 border-t border-gray-100 pt-3">
                <div className="mb-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                  <p className="text-xs font-medium text-gray-800">
                    {operatorActionSummary(item)}
                  </p>
                  <p className="mt-1 text-xs text-gray-600">
                    {operatorOwnerLine(item)}
                  </p>
                </div>

            {(item.auditMessage || item.errorMessage || item.blockers.length > 0) && (
              <div className="mb-3 space-y-2">
                {item.auditMessage && (
                  <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                    {item.auditMessage}
                  </p>
                )}
                {item.errorMessage && (
                  <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    {item.errorMessage}
                  </p>
                )}
                {item.blockers.length > 0 && (
                  <ul className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    {item.blockers.map((blocker) => (
                      <li key={blocker}>{blocker}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Co-pilot channels get the posting-assist panel instead of the flat
                step list; everything else keeps the plain checklist. */}
            {!item.copilotScript && !isTakedownItem(item) && (
              <ol className="mb-3 space-y-1.5">
                {item.steps.map((s, i) => (
                  <li key={s.key} className="flex gap-2 text-xs text-gray-600">
                    <span className="font-semibold text-gray-400">{i + 1}.</span>
                    <span>
                      <span className="font-medium text-gray-800">{s.label}</span>
                      {s.detail && (
                        <span className="mt-0.5 block text-gray-500">{s.detail}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {item.copilotScript && (
              <CopilotPanel
                propertyId={propertyId}
                itemId={item.id}
                script={item.copilotScript}
              />
            )}

            {item.trackedUrl && (
              <div className="mb-3">
                <p className="mb-1 text-xs font-medium text-gray-500">
                  Tracked inquiry link for this post
                </p>
                <CopyLink url={item.trackedUrl} />
              </div>
            )}
            {item.operatorActionUrl && (
              <a
                href={item.operatorActionUrl}
                target="_blank"
                rel="noreferrer"
                className="mb-3 inline-flex rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                {nextActionLabel(item)}
              </a>
            )}
            {leaseupTakedownEnabled && isOperatorTakedownItem(item) && (
              <form action={confirmLeaseupTakedownRemovedAction} className="mb-3">
                <input type="hidden" name="property_id" value={propertyId} />
                <input type="hidden" name="item_id" value={item.id} />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1 rounded-lg border border-brand/40 bg-brand/5 px-3 py-2 text-xs font-medium text-brand hover:bg-brand/10"
                >
                  Mark ad removed
                </button>
              </form>
            )}
            {/* Concierge / referral handoff. Realtor.ca is a special case
                (Distribution Lane B): a rental can only reach Realtor.ca through
                a RECO-licensed agent, so its handoff is a "dispatch a network
                agent" referral (the licensed agent is the principal; Vacantless
                posts nothing and earns no fee), gated behind the
                REALTOR_REFERRAL_ENABLED firewall. Every other channel keeps the
                generic "Ask Vacantless to post it" publishing-desk handoff. */}
            {item.canConcierge &&
              item.channel === "realtor_ca" &&
              realtorReferralEnabled && (
                <form action={requestConciergePublish} className="mb-3">
                  <input type="hidden" name="property_id" value={propertyId} />
                  <input type="hidden" name="item_id" value={item.id} />
                  <input type="hidden" name="referral" value="realtor_network_agent" />
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1 rounded-lg border border-brand/40 bg-brand/5 px-3 py-2 text-xs font-medium text-brand hover:bg-brand/10"
                  >
                    Dispatch a network agent
                  </button>
                  <span className="ml-2 text-[11px] text-gray-500">
                    A licensed real-estate agent is the principal and lists your
                    rental through their own brokerage. Vacantless collects no
                    referral fee and only marks it live with the real Realtor.ca
                    link.
                  </span>
                </form>
              )}
            {item.canConcierge && item.channel !== "realtor_ca" && (
              <form action={requestConciergePublish} className="mb-3">
                <input type="hidden" name="property_id" value={propertyId} />
                <input type="hidden" name="item_id" value={item.id} />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1 rounded-lg border border-brand/40 bg-brand/5 px-3 py-2 text-xs font-medium text-brand hover:bg-brand/10"
                >
                  Ask Vacantless to post it
                </button>
                <span className="ml-2 text-[11px] text-gray-500">
                  Our publishing desk takes over this channel and still records
                  real live-ad proof before it is marked Live.
                </span>
              </form>
            )}
            {item.canAutopilot && !item.autopilotApproved && (
              <form action={authorizeAutopilotSubmit} className="mb-3">
                <input type="hidden" name="property_id" value={propertyId} />
                <input type="hidden" name="item_id" value={item.id} />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1 rounded-lg border border-brand/40 bg-brand/5 px-3 py-2 text-xs font-medium text-brand hover:bg-brand/10"
                >
                  Authorize autopilot to post
                </button>
                <span className="ml-2 text-[11px] text-gray-500">
                  {item.channel === "facebook_feed"
                    ? "Vacantless posts one organic Page-feed link through Graph API and reports back with the post proof. Marketplace and paid ads stay separate."
                    : `Vacantless posts this prepared ad to ${item.channelLabel} automatically and reports back. Paid channels require standing spend authorization before the worker can claim them.`}
                </span>
              </form>
            )}
            {item.canAutopilot && item.autopilotApproved && (
              <p className="mb-3 text-xs font-medium text-brand">
                Autopilot authorized — the worker will post {item.channelLabel}{" "}
                and report back.
              </p>
            )}
            {item.canRelistRadarAutoRefresh && (
              <form
                action={setRelistRadarStandingAutoRefresh}
                className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2"
              >
                <input type="hidden" name="property_id" value={propertyId} />
                <input type="hidden" name="channel" value={item.channel} />
                <input
                  type="hidden"
                  name="enabled"
                  value={item.relistRadarAutoRefreshOn ? "0" : "1"}
                />
                <button
                  type="submit"
                  aria-pressed={item.relistRadarAutoRefreshOn === true}
                  className="inline-flex items-center gap-2 text-xs font-semibold text-emerald-900"
                >
                  <span
                    className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition ${
                      item.relistRadarAutoRefreshOn
                        ? "bg-emerald-600"
                        : "bg-gray-300"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${
                        item.relistRadarAutoRefreshOn
                          ? "left-4"
                          : "left-0.5"
                      }`}
                    />
                  </span>
                  {item.relistRadarAutoRefreshOn
                    ? "Hands-off refreshes on"
                    : "Turn on hands-off refreshes"}
                </button>
                <span className="text-[11px] text-emerald-900/70">
                  {item.relistRadarAutoRefreshOn
                    ? "Monthly recap, no pre-expiry email."
                    : "Free Kijiji only."}
                </span>
              </form>
            )}

            {(item.channel === "vacantless" || item.channel === "org_feed") && (
              <form
                action={
                  item.channel === "vacantless"
                    ? verifyPublicPage
                    : verifyOrgFeedInclusion
                }
                className="mb-3"
              >
                <input type="hidden" name="property_id" value={propertyId} />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  {item.channel === "vacantless"
                    ? "Check renter page"
                    : "Check listing feed"}
                </button>
                <span className="ml-2 text-[11px] text-gray-500">
                  Saves proof for this channel.
                </span>
              </form>
            )}
            {item.proofUrl && (
              <p className="mb-3 truncate text-xs text-gray-500">
                Proof:{" "}
                <a
                  href={item.proofUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-brand underline"
                >
                  {item.proofUrl}
                </a>
              </p>
            )}
            {/* More actions (Slice 1): operator/admin controls folded out of the
                first read (Codex #5) — proof capture + the generic status editor.
                The generic status form stays gated on !item.copilotScript so a
                co-pilot item can only go live via completeCopilotPost with a real
                URL (S482 P1 guard preserved — structural, not just visually
                hidden: the form is not rendered at all for co-pilot items). */}
            <details className="border-t border-gray-100 pt-3">
              <summary className="cursor-pointer text-xs font-medium text-gray-600">
                More actions
              </summary>
              <div className="mt-3 space-y-4">
                {/* Add proof / check again. */}
                <form
                  action={recordItemProof}
                  className="flex flex-wrap items-end gap-2"
                >
                  <input type="hidden" name="item_id" value={item.id} />
                  <div className="w-56">
                    <label className="mb-1 block text-[11px] font-medium text-gray-500">
                      Live URL (if any)
                    </label>
                    <input
                      name="external_url"
                      placeholder="https://..."
                      className={FIELD_CLASS}
                    />
                  </div>
                  <div className="w-40">
                    <label className="mb-1 block text-[11px] font-medium text-gray-500">
                      Result
                    </label>
                    <select
                      name="result"
                      defaultValue="verified_live"
                      className={FIELD_CLASS}
                    >
                      {(
                        [
                          "verified_live",
                          "needs_login",
                          "needs_payment",
                          "proof_unavailable",
                          "stale",
                        ] as const
                      ).map((r) => (
                        <option key={r} value={r}>
                          {verificationResultLabel(r)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="min-w-[10rem] flex-1">
                    <label className="mb-1 block text-[11px] font-medium text-gray-500">
                      Note
                    </label>
                    <input
                      name="note"
                      placeholder="e.g. posted on Kijiji; screenshot on file"
                      className={FIELD_CLASS}
                    />
                  </div>
                  <button
                    type="submit"
                    className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Save proof
                  </button>
                </form>

                {/* Co-pilot channels complete ONLY via the co-pilot panel above,
                    which records proof + a browser_copilot attempt and never
                    marks live without a real URL. The generic status form is not
                    rendered for them so it can't bypass that path (Codex S482 P1). */}
                {!item.copilotScript && (
                  <form
                    action={updateRunItem}
                    className="space-y-3 border-t border-gray-100 pt-4"
                  >
                    <p className="text-xs font-medium text-gray-600">
                      Advanced status update
                    </p>
                    <input type="hidden" name="property_id" value={propertyId} />
                    <input type="hidden" name="item_id" value={item.id} />
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="w-40">
                        <label
                          htmlFor={`run-${item.id}-status`}
                          className="mb-1 block text-xs font-medium text-gray-600"
                        >
                          Status
                        </label>
                        <select
                          id={`run-${item.id}-status`}
                          name="publish_status"
                          defaultValue={item.publishStatus}
                          className={FIELD_CLASS}
                        >
                          {PUBLISH_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {publishStatusLabel(s)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="min-w-[14rem] flex-1">
                        <label
                          htmlFor={`run-${item.id}-url`}
                          className="mb-1 block text-xs font-medium text-gray-600"
                        >
                          {urlFieldLabel(item)}
                        </label>
                        <input
                          id={`run-${item.id}-url`}
                          name="external_url"
                          defaultValue={item.externalUrl ?? ""}
                          placeholder="https://..."
                          className={FIELD_CLASS}
                        />
                      </div>
                    </div>
                    <div>
                      <label
                        htmlFor={`run-${item.id}-notes`}
                        className="mb-1 block text-xs font-medium text-gray-600"
                      >
                        Notes
                      </label>
                      <input
                        id={`run-${item.id}-notes`}
                        name="notes"
                        defaultValue={item.notes ?? ""}
                        className={FIELD_CLASS}
                      />
                    </div>
                    <button
                      type="submit"
                      className={PRIMARY_BTN}
                      style={{ backgroundColor: "var(--brand-color)" }}
                    >
                      Save status
                    </button>
                  </form>
                )}
              </div>
            </details>
              </div>
            </details>
          </li>
        ))}
      </ul>

      <details className="mt-4 border-t border-gray-100 pt-3">
        <summary className="cursor-pointer list-none text-xs font-semibold text-gray-600 hover:text-gray-800 [&::-webkit-details-marker]:hidden">
          More site options
        </summary>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          {selectable.length > 0 && (
            <form action={addRunChannel} className="flex items-end gap-2">
              <input type="hidden" name="property_id" value={propertyId} />
              <input type="hidden" name="run_id" value={run.id} />
              <div>
                <label
                  htmlFor="run-add-channel"
                  className="mb-1 block text-xs font-medium text-gray-600"
                >
                  Add a site
                </label>
                <select
                  id="run-add-channel"
                  name="channel"
                  className={FIELD_CLASS}
                  defaultValue={firstSelectableChoice?.key ?? ""}
                >
                  {renderSelectableOptions()}
                </select>
              </div>
              <button
                type="submit"
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Add
              </button>
            </form>
          )}
          <form action={cancelDistributionRun}>
            <input type="hidden" name="property_id" value={propertyId} />
            <input type="hidden" name="run_id" value={run.id} />
            <button
              type="submit"
              className="text-xs font-medium text-red-600 hover:text-red-700"
            >
              Cancel this run
            </button>
          </form>
        </div>
      </details>
    </div>
  );
}
