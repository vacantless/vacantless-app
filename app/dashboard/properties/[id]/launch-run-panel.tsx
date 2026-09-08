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
  type PublishMode,
  type PublishStatus,
  type PublishTone,
} from "@/lib/distribution-publish";
import {
  groupByDistributionChannelDisplayGroup,
  type ChannelCategory,
} from "@/lib/distribution-channels";
import type { DistributionKeepLiveAction } from "@/lib/distribution-channel-contracts";
import type { DistributionLifecycleAttention } from "@/lib/distribution-freshness";

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
  lifecycleAttention?: DistributionLifecycleAttention | null;
  keepLiveAction?: DistributionKeepLiveAction | null;
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
  lifecycleSummary: string;
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

const ATTENTION_BOX: Record<PublishTone, string> = {
  positive: "border-green-200 bg-green-50 text-green-800",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  danger: "border-red-200 bg-red-50 text-red-700",
  neutral: "border-slate-200 bg-slate-50 text-slate-700",
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

type LifecycleDisplay = Pick<
  DistributionLifecycleAttention,
  "label" | "tone" | "detail" | "dueAt"
> & { kind: string };

function lifecycleDisplay(item: RunItemView): LifecycleDisplay | null {
  return item.keepLiveAction ?? item.lifecycleAttention ?? null;
}

function LifecycleStatusChip({ item }: { item: RunItemView }) {
  const display = lifecycleDisplay(item);
  if (!display || isRemovedTakedownItem(item)) return null;
  return (
    <span
      title={display.detail}
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_CHIP[display.tone]}`}
    >
      {display.label}
    </span>
  );
}

function LifecycleAttentionBox({ item }: { item: RunItemView }) {
  const display = lifecycleDisplay(item);
  if (!display || isRemovedTakedownItem(item)) return null;
  return (
    <div
      className={`mb-3 rounded-lg border px-3 py-2 text-xs ${ATTENTION_BOX[display.tone]}`}
    >
      <p className="font-semibold">{display.label}</p>
      <p className="mt-1 leading-relaxed">{display.detail}</p>
    </div>
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
  if (isRemovedTakedownItem(item)) return { label: "Taken down", tone: "positive" };
  if (item.liveWithoutUrl) return { label: "Needs the link", tone: "danger" };
  if (item.staleRefresh) return { label: "Needs refresh", tone: "warning" };
  if (item.publishStatus === "submitted")
    return { label: "Sent. Not live yet", tone: "warning" };
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
  if (item.channel === "vacantless") return "Open your Vacantless page";
  if (item.channel === "org_feed") return "Open your partner sites";
  if (item.mode === "broker") return "Open broker page";
  if (item.mode === "feed_partner") return "Open the partner page";
  return `Open ${item.channelLabel}`;
}

function urlFieldLabel(item: RunItemView): string {
  if (item.channel === "vacantless") return "Your Vacantless page link";
  if (item.channel === "org_feed") return "Partner site link";
  if (item.mode === "feed_partner") return "Partner site link";
  if (item.mode === "broker") return "Broker or MLS link";
  return "The link to your ad";
}

const OPERATOR_ACTION_WEIGHT: Partial<Record<PublishStatus, number>> = {
  needs_payment: 1,
  needs_login: 1,
  needs_operator: 2,
  queued: 3,
};

function operatorActionWeight(item: RunItemView): number | null {
  if (item.keepLiveAction) {
    switch (item.keepLiveAction.kind) {
      case "remove_ad":
      case "save_proof":
        return 0;
      case "request_account":
      case "request_authorization":
      case "request_spend":
        return 1;
      case "send_reminder":
        return 2;
      case "auto_refresh":
      case "watching":
      case "none":
        return null;
    }
  }
  if (item.lifecycleAttention?.kind === "takedown_needed") return 0;
  if (item.lifecycleAttention?.kind === "proof_needed") return 0;
  if (item.liveWithoutUrl) return 0;
  if (item.lifecycleAttention?.kind === "refresh_due") return 1;
  if (item.staleRefresh) return 1;
  if (item.lifecycleAttention?.kind === "expires_soon") return 2;
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
  if (item.keepLiveAction && item.keepLiveAction.kind !== "none") {
    return item.keepLiveAction.detail;
  }
  if (isTakedownItem(item)) {
    if (isRemovedTakedownItem(item)) return `Your ${item.channelLabel} ad is down.`;
    if (item.publishStatus === "queued") return `We will take the ${item.channelLabel} ad down.`;
    return `Take the ${item.channelLabel} ad down, then mark it here.`;
  }
  if (item.lifecycleAttention?.kind === "takedown_needed") {
    return item.lifecycleAttention.detail;
  }
  if (item.lifecycleAttention?.kind === "proof_needed") {
    return item.lifecycleAttention.detail;
  }
  if (item.lifecycleAttention?.kind === "refresh_due") {
    return item.lifecycleAttention.detail;
  }
  if (item.lifecycleAttention?.kind === "expires_soon") {
    return item.lifecycleAttention.detail;
  }
  if (item.liveWithoutUrl) {
    return "Paste the link to your ad before this site counts as Live.";
  }
  if (item.staleRefresh) {
    return "Post this ad again, then save the new link.";
  }
  if (item.mode === "browser_copilot") {
    switch (item.publishStatus) {
      case "needs_payment":
        return `Open ${item.channelLabel}. Approve any fee, then save the link to your ad.`;
      case "needs_login":
        return `Open ${item.channelLabel}. Sign in and post, then save the link to your ad.`;
      case "needs_operator":
      case "queued":
        return `Open ${item.channelLabel}. We write the ad and wait for your link.`;
    }
  }
  switch (item.publishStatus) {
    case "needs_payment":
      return `Sign in or pay on ${item.channelLabel}. Then paste the link here.`;
    case "needs_login":
      return `Sign in on ${item.channelLabel} and post. Then paste the link here.`;
    case "needs_operator":
      return `Follow the ${item.channelLabel} steps. Save the link when it is live.`;
    case "queued":
      return `Open ${item.channelLabel} when you are ready.`;
    case "submitting":
      return `We are sending it to ${item.channelLabel}. Check back for the link.`;
    case "submitted":
      return `Sent to ${item.channelLabel}. It decides when to show it.`;
    case "live":
      return `${item.channelLabel} has its link. You are done unless the ad changes.`;
    case "blocked":
      return `${item.channelLabel} is blocked. Fix the setup issue before posting.`;
    case "rejected":
      return `${item.channelLabel} was rejected. Review the note before trying again.`;
    case "skipped":
      return `${item.channelLabel} is skipped for this run.`;
  }
}

function operatorOwnerLine(item: RunItemView): string {
  if (item.keepLiveAction) {
    switch (item.keepLiveAction.kind) {
      case "auto_refresh":
        return "We post it again, then wait for the link to your ad.";
      case "send_reminder":
        return "We will remind you instead, because we do not have your go.";
      case "request_spend":
        return "Set your limit before we post again on a paid site.";
      case "request_account":
      case "request_authorization":
        return "One setup step. After that we can post from this account.";
      case "remove_ad":
        return "The ad counts as down once you save the link here.";
      case "save_proof":
        return "We count this site as Live once you save the link.";
      case "watching":
        return "Once the link is saved, we watch this row for the end date.";
      case "none":
        break;
    }
  }
  if (isTakedownItem(item)) {
    return "We keep this row so your inquiries still add up.";
  }
  if (item.channel === "facebook_feed") {
    return "Allow us to post to your Facebook Page. We then save the link.";
  }
  if (item.mode === "automatic") {
    return "We can check this in the app, then save the link here.";
  }
  if (item.mode === "feed_partner") {
    return "We send it on. Each partner site decides when to show it.";
  }
  if (item.mode === "browser_copilot") {
    return "A window opens with the wording and a box for your link. We wait for it.";
  }
  if (item.mode === "concierge") {
    return "We can do this one for you. We still need the link to your ad.";
  }
  if (item.mode === "broker") {
    return "A licensed agent posts on that site. We keep the link here.";
  }
  return "Use this for anywhere else you posted, so inquiries add up.";
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
      const brokerRail = c.key === "realtor_ca" || c.modeLabel === "Broker or MLS";
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
            <span className="block truncate text-[11px] text-slate-500">
              {c.lifecycleSummary}
            </span>
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

  if (setupBlocker) {
    const waitingSiteCount =
      items.length ||
      startChannels.filter((channel) => channel.defaultSelected).length ||
      startChannels.length;

    return (
      <div
        id="publish-checklist"
        className="mb-4 scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-gray-950">
            Your sites
          </h3>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
            No posting yet
          </span>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">
            Finish your listing first
          </p>
          <p className="mt-1 text-base font-semibold text-amber-950">
            {setupBlocker.title}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-amber-900">
            {setupBlocker.detail}
          </p>
          <a
            href={setupBlocker.href}
            className="mt-3 inline-flex rounded-lg bg-amber-700 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-800"
          >
            {setupBlocker.action}
          </a>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
          <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold">
            {waitingSiteCount} {waitingSiteCount === 1 ? "site" : "sites"} waiting
          </span>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold">
            Account, spend, and the ad link later
          </span>
        </div>
      </div>
    );
  }

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
                Site setup
              </Link>
            )}
            <Link
              href="/dashboard/settings?tab=distribution"
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Site settings
            </Link>
          </div>
        </div>
        <p className="mb-3 text-xs text-gray-500">
          Pick the sites we should post this listing to.
        </p>
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
    ? `Your Vacantless page is up · ${outsideLiveProofCount} of ${outsideItems.length} rental sites live`
    : `${outsideLiveProofCount} of ${outsideItems.length} rental sites live`;

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
            Site settings
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
                : "You are all caught up. Watch the end dates or add a site."}
            </p>
            <p className="mt-2 text-xs text-gray-600">
              {priorityItem
                ? operatorOwnerLine(priorityItem)
                : "Your page and your finished sites are tracked here."}
            </p>
            <p className="mt-2 text-xs text-gray-500">
              {outsideLiveProofCount} of {outsideItems.length} rental sites
              have their link saved. A site counts as Live once we have it.
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
                      {item.modeLabel}
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
                    <LifecycleStatusChip item={item} />
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
                <LifecycleAttentionBox item={item} />

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
                  Your inquiry link for this post
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
                  Mark it taken down
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
                    Ask an agent to post it
                  </button>
                  <span className="ml-2 text-[11px] text-gray-500">
                    A licensed agent lists your rental through their own
                    brokerage. We mark it live with the real Realtor.ca link.
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
                  Have Vacantless handle it
                </button>
                <span className="ml-2 text-[11px] text-gray-500">
                  We do this one for you. We still save the link to your ad
                  before it shows as Live.
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
                  Allow us to post
                </button>
                <span className="ml-2 text-[11px] text-gray-500">
                  {item.channel === "facebook_feed"
                    ? "We post one link to your Facebook Page and report back."
                    : `We post this ad to ${item.channelLabel} and report back. Paid sites need your limit first.`}
                </span>
              </form>
            )}
            {item.canAutopilot && item.autopilotApproved && (
              <p className="mb-3 text-xs font-medium text-brand">
                Thanks. We will post {item.channelLabel} and report back.
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
                    ? "We post it again for you"
                    : "Let us post it again for you"}
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
                    ? "Check your Vacantless page"
                    : "Check your partner sites"}
                </button>
                <span className="ml-2 text-[11px] text-gray-500">
                  This saves the link for this site.
                </span>
              </form>
            )}
            {item.proofUrl && (
              <p className="mb-3 truncate text-xs text-gray-500">
                Ad link:{" "}
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
                      The link to your ad
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
                    Save the ad link
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
