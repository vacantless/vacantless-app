// Distribute command center (S412, Slice 1). One card per real channel, driven
// by lib/distribution-channels (the matrix + status reducer). This ABSORBS the
// old "Where this is posted" tracker: each channel card hosts that channel's
// tracked posts + the add/edit/remove forms, reusing the SAME server actions
// (addListingPost / updateListingPost / removeListingPost) and listing_posts
// rows — no data-model change. Asset prep (Marketing Kit, Listing Copy, Fill
// Sheet, Photos) stays on the Photos & listing copy tab; this tab is about WHERE
// the listing goes and WHAT still needs a human step.
//
// Server component: it renders <form action={serverAction}> directly and leans
// on two existing client islands for interactivity — CopyLink (tracked links)
// and CopyTextButton (channel wording). Nothing here posts to a portal or logs
// into anything: assisted-manual only, honest by design.

import { Icons } from "@/components/icons";
import { CopyLink } from "./copy-link";
import { CopyTextButton } from "@/components/copy-text-button";
import {
  addListingPost,
  updateListingPost,
  removeListingPost,
  upsertPartnerAccount,
} from "../actions";
import { disconnectFacebookPage } from "../distribution-actions";
import { startConciergePackCheckout } from "../../billing/actions";
import {
  PARTNER_STATUSES,
  partnerStatusLabel,
  partnerStatusTone,
  partnerNextStep,
  type PartnerStatus,
} from "@/lib/distribution-partner";
import {
  channelModeLabel,
  channelStatusLabel,
  channelStatusTone,
  daysBetween,
  groupByDistributionChannelDisplayGroup,
  type ChannelCategory,
  type DistributionChannel,
  type ChannelStatus,
  type StatusTone,
} from "@/lib/distribution-channels";
import {
  LISTING_POST_STATUSES,
  listingPostStatusLabel,
  type ListingPostStatus,
} from "@/lib/listing-distribution";
import {
  CONCIERGE_PACK_PRICE_CENTS,
  CONCIERGE_PACK_QUANTITY,
  formatAmount,
} from "@/lib/billing";
import {
  type PublishMode,
  type PublishStatus,
  type PublishTone,
} from "@/lib/distribution-publish";
import {
  type RunItemStatus,
  type RunStep,
} from "@/lib/distribution-run";
import type { DistributionKeepLiveAction } from "@/lib/distribution-channel-contracts";
import type { DistributionLifecycleAttention } from "@/lib/distribution-freshness";
import { buildReplySnippets } from "@/lib/reply-snippets";
import { GetOnlineView } from "./get-online-view";
import type {
  ListingPacketChannelReadiness,
  ListingPacketMissingField,
  ListingPacketReadiness,
} from "@/lib/listing-packet-readiness";
import {
  portalRequirementActionPlanFor,
  type PortalRequirementActionPlan,
  type PortalRequirementFieldKey,
} from "@/lib/portal-requirements";
import { PublishEverywhere } from "./publish-everywhere";


// S695: the run-item view types moved here from launch-run-panel.tsx when the
// assisted checklist was removed; page.tsx still builds them for Publish
// Everywhere (run items) and the desk hand-off.
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

export type LaunchRunData = {
  items: RunItemView[];
  conciergeDeskEnabled: boolean;
  conciergeUsage: { used: number; included: number };
};

export type ReplyInputs = {
  address: string;
  bookingUrl: string | null;
  rentLabel: string | null;
};

export type GetOnlineBasics = {
  address: string;
  addressDisplayMode: string | null;
  rentCents: number | null;
  beds: number | null;
  baths: number | null;
  parking: string | null;
  description: string | null;
  showingInstructions: string | null;
  showingArrivalPhone: string | null;
  status: string;
  availableDate: string | null;
  virtualTourUrl: string | null;
  sqft: number | null;
  floor: string | null;
  unitType: string | null;
  forRentBy: string | null;
  structureType: string | null;
  laundry: string | null;
  airConditioning: boolean;
  balcony: boolean;
  furnished: boolean;
  petsCats: boolean | null;
  petsDogs: boolean | null;
  petsDogSize: string | null;
  petsNotes: string | null;
  heatIncluded: boolean | null;
  hydroIncluded: boolean | null;
  waterIncluded: boolean | null;
  hasSmartLock: boolean;
  photosReady: boolean;
  leaseTerm: string | null;
  smoking: string | null;
  acType: string | null;
  onSiteManagement: boolean | null;
};

// One channel's tracked ad (a listing_posts row shaped for the card).
export type DistributePostRow = {
  id: string;
  status: ListingPostStatus;
  label: string | null;
  url: string | null;
  posted_on: string | null;
  notes: string | null;
  // The p=<id> tracked inquiry link, when the rental is Live (else null).
  trackedUrl: string | null;
  inquiryCount: number;
};

// The org-level feed-partner account for a channel (Slice 3), or null when the
// operator hasn't recorded one yet.
export type PartnerAccountView = {
  status: PartnerStatus;
  feedUrl: string | null;
  partnerContact: string | null;
  submittedOn: string | null;
  acceptedOn: string | null;
  lastCheckedOn: string | null;
  notes: string | null;
};

export type FacebookPageAccountView = {
  enabled: boolean;
  accountStatus: string | null;
  pageName: string | null;
  automationAuthorized: boolean;
};

export type InstagramAccountView = {
  enabled: boolean;
  accountStatus: string | null;
  automationAuthorized: boolean;
  label: string | null;
  pageName: string | null;
  hasLinkedBusinessAccount: boolean;
};

// A fully-resolved channel card: the matrix row + computed status + the
// matching channel copy + feed note + partner account + this channel's posts.
export type DistributeChannelCard = {
  channel: DistributionChannel;
  status: ChannelStatus;
  copy: { title: string; body: string } | null;
  feed: { inFeed: boolean; hint: string } | null;
  partner: PartnerAccountView | null;
  facebookPage?: FacebookPageAccountView | null;
  instagramAccount?: InstagramAccountView | null;
  posts: DistributePostRow[];
};

const TONE_CHIP: Record<StatusTone, string> = {
  positive: "bg-green-50 text-green-700",
  warning: "bg-amber-50 text-amber-700",
  danger: "bg-red-50 text-red-700",
  neutral: "bg-gray-100 text-gray-600",
};

const FIELD_CLASS =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";
const PRIMARY_BTN =
  "rounded-lg px-4 py-2 text-sm font-medium text-white";
const SECONDARY_BTN =
  "inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50";


export type DistributeRunNotice = {
  tone: "success" | "warning" | "danger" | "info";
  title: string;
  body: string;
  showConciergeActions?: boolean;
};

const RUN_NOTICE_CLASS: Record<DistributeRunNotice["tone"], string> = {
  success: "border-green-200 bg-green-50 text-green-700",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  danger: "border-red-200 bg-red-50 text-red-700",
  info: "border-blue-200 bg-blue-50 text-blue-800",
};

// S695: the control-room summary, health, automation and next-action helpers
// went with the assisted launch checklist (DECISION-S694).

export function DistributeTab({
  propertyId,
  basics,
  linkIsLive,
  addFormKey,
  today,
  setupOutstanding,
  canSetLive,
  listingPacket,
  channelCards,
  otherPosts,
  promotionNote,
  launchRun,
  replyInputs,
  runNotice,
  totalInquiryCount,
  publishEverywhereCopilotEnabled,
  stepClarityLiveEnabled,
  wizardEnabled,
}: {
  propertyId: string;
  basics: GetOnlineBasics;
  linkIsLive: boolean;
  addFormKey: string;
  today: string;
  setupOutstanding: number;
  canSetLive: boolean;
  listingPacket: ListingPacketReadiness;
  channelCards: DistributeChannelCard[];
  otherPosts: DistributePostRow[];
  promotionNote: string | null;
  launchRun: LaunchRunData;
  replyInputs: ReplyInputs;
  runNotice: DistributeRunNotice | null;
  totalInquiryCount: number;
  publishEverywhereCopilotEnabled: boolean;
  stepClarityLiveEnabled: boolean;
  wizardEnabled: boolean;
}) {
  const proofPostCount =
    channelCards.reduce((sum, card) => sum + card.posts.length, 0) +
    otherPosts.length;
  const proofIssueCount = channelCards.filter(
    (card) => card.status.value === "problem",
  ).length;
  const channelCardGroups = groupByDistributionChannelDisplayGroup(
    channelCards,
    (card) => card.channel.category,
  );
  const firstListingPacketMissing = listingPacket.missingRequired[0] ?? null;
  const firstListingPacketAction = firstListingPacketMissing
    ? packetFieldAction(firstListingPacketMissing, propertyId)
    : null;
  const publishEverywherePostingBlocker =
    firstListingPacketAction
      ? {
          title: "Answer the missing questions first.",
          detail: `${firstListingPacketAction.detail} Sign-in, payment, and the ad link come after this.`,
          href: firstListingPacketAction.href,
          action: firstListingPacketAction.action,
        }
      : null;
  const publishEverywhereSurface = (
    <div className="space-y-4">
      <ListingPacketCard readiness={listingPacket} propertyId={propertyId} />
      <PublishEverywhere
        propertyId={propertyId}
        basics={basics}
        linkIsLive={linkIsLive}
        setupOutstanding={setupOutstanding}
        canSetLive={canSetLive}
        channelCards={channelCards}
        replyInputs={replyInputs}
        totalInquiryCount={totalInquiryCount}
        conciergeDeskEnabled={launchRun.conciergeDeskEnabled}
        conciergeUsage={launchRun.conciergeUsage}
        copilotEnabled={publishEverywhereCopilotEnabled}
        stepClarityLiveEnabled={stepClarityLiveEnabled}
        wizardEnabled={wizardEnabled}
        runItems={launchRun.items.map((it) => ({
          id: it.id,
          channel: it.channel,
          publishStatus: it.publishStatus,
          mode: it.mode,
          canConcierge: it.canConcierge,
          externalUrl: it.externalUrl,
        }))}
        postingBlocker={publishEverywherePostingBlocker}
      />
    </div>
  );
  const advancedTools = (
    <>
      {/* Proof links (Slice 1): keep source-of-truth live ad URLs easy to save;
          tuck heavier posting tools behind per-channel disclosure rows. */}
      <details className="mt-4 rounded-2xl border border-gray-200 bg-white shadow-sm">
        <summary className="cursor-pointer list-none px-5 py-4 [&::-webkit-details-marker]:hidden">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900">
                Live ad links
              </p>
              <p className="text-xs text-gray-500">
                {proofPostCount} saved
                {proofIssueCount > 0
                  ? ` · ${proofIssueCount} still need a link`
                  : " · links to your ads and inquiry links"}
              </p>
            </div>
            <span className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700">
              Manage links
            </span>
          </div>
        </summary>
        <div className="border-t border-gray-100 px-5 py-4">
          <div className="space-y-4">
            {channelCardGroups.map(({ group, items }) => (
              <section key={group.id} className="space-y-3">
                <h4 className="px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  {group.title}
                </h4>
                <div className="space-y-3">
                  {items.map((card) => (
                    <ChannelCard
                      key={card.channel.key}
                      card={card}
                      propertyId={propertyId}
                      linkIsLive={linkIsLive}
                      addFormKey={addFormKey}
                      today={today}
                      replyInputs={replyInputs}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>

          <details className="mt-3 rounded-xl border border-gray-200 bg-white">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900">
                  Other live ad links
                </p>
                <p className="text-xs text-gray-500">
                  {otherPosts.length} saved outside the main site list
                </p>
              </div>
              <span className="text-xs font-semibold text-brand">Open</span>
            </summary>
            <div className="border-t border-gray-100 px-4 py-3">
              {otherPosts.length > 0 && (
                <ul className="mb-4 space-y-3">
                  {otherPosts.map((post) => (
                    <PostRow
                      key={post.id}
                      post={post}
                      propertyId={propertyId}
                      linkIsLive={linkIsLive}
                      fixedPortal="other"
                      showLabel
                    />
                  ))}
                </ul>
              )}

              {linkIsLive ? (
                <AddPostForm
                  propertyId={propertyId}
                  portal="other"
                  addFormKey={addFormKey}
                  showLabel
                />
              ) : (
                <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
                  Tracking turns on when this rental is Live.
                </p>
              )}
            </div>
          </details>
        </div>
      </details>

    </>
  );

  return (
    <div>

      <div
        id="distribute-header"
        className="scroll-mt-6"
      >
        {runNotice && (
          <div
            className={`mb-4 rounded-lg border px-3 py-2 text-xs ${RUN_NOTICE_CLASS[runNotice.tone]}`}
          >
            <p>
              <strong>{runNotice.title}</strong> {runNotice.body}
            </p>
            {runNotice.showConciergeActions && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <form action={startConciergePackCheckout}>
                  <input type="hidden" name="property_id" value={propertyId} />
                  <button className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">
                    Add a {CONCIERGE_PACK_QUANTITY}-pack -{" "}
                    {formatAmount(CONCIERGE_PACK_PRICE_CENTS)}
                  </button>
                </form>
                <a
                  href="/dashboard/billing"
                  className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Let us do it for you
                </a>
              </div>
            )}
          </div>
        )}
        {!linkIsLive && promotionNote && (
          <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {promotionNote}
          </p>
        )}
      </div>

      <GetOnlineView
        orgDefaultMode="simple"
        linkIsLive={linkIsLive}
        simple={publishEverywhereSurface}
        advanced={advancedTools}
      />
    </div>
  );
}

const PACKET_FIELD_HREF: Partial<Record<PortalRequirementFieldKey, string>> = {
  address: "#rental-details",
  rent: "#rental-details",
  beds_baths: "#rental-details",
  photos: "#property-photos",
  description: "#listing-description",
  property_type: "#property-unit-type",
  contact_phone: "/dashboard/settings",
  contact_email: "/dashboard/settings",
  availability_date: "#property-available-date",
  lease_term: "#rental-details",
  utilities: "#rental-details",
  parking: "#property-parking",
  amenities: "#rental-details",
  pets: "#rental-details",
  laundry: "#property-laundry",
  air_conditioning: "#rental-details",
  furnished: "#rental-details",
  square_footage: "#property-sqft",
  virtual_tour: "#virtual_tour_url",
};

const PACKET_TIER_LABEL: Record<ListingPacketChannelReadiness["tier"], string> = {
  included: "Included",
  needs_tap: "Needs your tap",
  top_up: "Buy more",
  broker: "Broker",
};

type PortalRequirementFlagChip = {
  key: string;
  label: string;
  className: string;
};

function portalRequirementFlagChips(
  plan: PortalRequirementActionPlan | null,
): PortalRequirementFlagChip[] {
  const chips: PortalRequirementFlagChip[] = [];
  if (!plan) return chips;
  if (plan.requiresAccount) {
    chips.push({
      key: "account",
      label: "Account",
      className: "bg-blue-50 text-blue-700",
    });
  }
  if (plan.requiresPayment) {
    chips.push({
      key: "payment",
      label: "Payment",
      className: "bg-amber-50 text-amber-700",
    });
  }
  if (plan.requiresProof) {
    chips.push({
      key: "proof",
      label: "Ad link",
      className: "bg-emerald-50 text-emerald-700",
    });
  }
  if (plan.requiresBroker) {
    chips.push({
      key: "broker",
      label: "Broker",
      className: "bg-slate-100 text-slate-700",
    });
  }
  if (plan.requiresFeedRoute) {
    chips.push({
      key: "feed",
      label: "Partner sites",
      className: "bg-cyan-50 text-cyan-700",
    });
  }
  if (plan.requiresAudience) {
    chips.push({
      key: "audience",
      label: "Audience",
      className: "bg-indigo-50 text-indigo-700",
    });
  }
  return chips;
}

function packetFieldHref(
  field: PortalRequirementFieldKey,
  propertyId?: string,
): string {
  if (field === "property_type" && propertyId) {
    return `/dashboard/properties/${encodeURIComponent(propertyId)}?tab=setup#property-unit-type`;
  }
  return PACKET_FIELD_HREF[field] ?? "#rental-details";
}

function packetFieldAction(
  missing: ListingPacketMissingField,
  propertyId?: string,
): { href: string; action: string; detail: string } {
  if (missing.field === "property_type") {
    return {
      href: packetFieldHref(missing.field, propertyId),
      action: "Choose property type",
      detail: "Choose the property type to unlock posting to rental sites.",
    };
  }

  const label = missing.label.toLowerCase();
  return {
    href: packetFieldHref(missing.field, propertyId),
    action: `Add ${label}`,
    detail: `Add ${label} before the rental sites can use your listing.`,
  };
}

function shortMissingList(items: readonly ListingPacketMissingField[]): string {
  if (items.length === 0) return "";
  const labels = items.slice(0, 3).map((item) => item.label.toLowerCase());
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels[0]}, ${labels[1]}, and ${labels[2]}`;
}

function ListingPacketCard({
  readiness,
  showAction = true,
  propertyId,
}: {
  readiness: ListingPacketReadiness;
  showAction?: boolean;
  propertyId?: string;
}) {
  const missingRequired = readiness.missingRequired;
  const ready = readiness.readyChannelCount === readiness.channelCount;
  const primaryMissing = missingRequired[0] ?? null;
  const primaryAction = primaryMissing
    ? packetFieldAction(primaryMissing, propertyId)
    : null;
  const missingText = shortMissingList(missingRequired);
  const actionHref = primaryAction?.href ?? "#distribute-header";
  const actionLabel = primaryAction?.action ?? "Choose sites";
  const headline = ready
    ? "Your listing has what every site needs."
    : `Your listing is ready for ${readiness.readyChannelCount} ${
        readiness.readyChannelCount === 1 ? "site" : "sites"
      }.`;
  const subline = ready
    ? "Posting choices stay below: which sites, sign-in steps, and any site fees."
    : primaryMissing?.field === "property_type"
      ? primaryAction?.detail ??
        "Choose the property type to unlock posting to rental sites."
      : `Add ${missingText} to satisfy the remaining sites.`;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <IconTile>
              <Icons.list className="h-4 w-4" />
            </IconTile>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Your listing
            </p>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                ready ? TONE_CHIP.positive : TONE_CHIP.warning
              }`}
            >
              {ready ? "Ready" : `${missingRequired.length} details missing`}
            </span>
          </div>
          <h3 className="mt-3 text-lg font-semibold text-gray-950">
            {headline}
          </h3>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-gray-600">
            {subline}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2 text-right">
          <div>
            <p className="text-2xl font-semibold text-gray-950">
              {readiness.readyChannelCount}
            </p>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              ready sites
            </p>
          </div>
          {showAction && (
            <a
              href={actionHref}
              className={
                ready
                  ? "rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white hover:opacity-90"
                  : "rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100"
              }
            >
              {actionLabel}
            </a>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-xs">
        <span className="rounded-full bg-gray-100 px-2.5 py-1 font-semibold text-gray-700">
          {readiness.channelCount} total sites
        </span>
        <span className="rounded-full bg-gray-100 px-2.5 py-1 font-semibold text-gray-700">
          {missingRequired.length} missing details
        </span>
        <span className="rounded-full bg-gray-100 px-2.5 py-1 font-semibold text-gray-700">
          Sign-in and fees come later
        </span>
      </div>

      <details className="mt-4 border-t border-gray-100 pt-3">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-gray-800 [&::-webkit-details-marker]:hidden">
          Why sites differ
          <span className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-600">
            Details
          </span>
        </summary>
        <ul className="mt-3 divide-y divide-gray-100">
          {readiness.channels.map((channel) => (
            <ListingPacketChannelRow key={channel.channel} channel={channel} />
          ))}
        </ul>
      </details>
    </section>
  );
}

function ListingPacketChannelRow({
  channel,
}: {
  channel: ListingPacketChannelReadiness;
}) {
  const actionPlan = portalRequirementActionPlanFor(channel.channel);
  const actionChips = portalRequirementFlagChips(actionPlan);
  const primaryActionLabel = actionPlan?.primaryActionLabel ?? null;
  const primaryActionDetail = actionPlan?.primaryAction?.detail ?? null;
  const actionPrefix = channel.ready ? "Next" : "Then";
  const missing = channel.missingRequired
    .slice(0, 3)
    .map((field) =>
      field === "contact_phone"
        ? "contact phone"
        : field === "beds_baths"
          ? "beds and baths"
          : field.replace(/_/g, " "),
    );
  const statusLabel = channel.ready
    ? "Ready"
    : `${channel.missingRequired.length} missing`;
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-gray-950">{channel.label}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-gray-500">
          {channel.ready
            ? packetReadyDetail(channel)
            : `Needs ${missing.join(", ")}.`}
        </p>
        {primaryActionLabel && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-brand/10 px-2.5 py-1 text-[11px] font-semibold text-brand">
              {actionPrefix}: {primaryActionLabel}
            </span>
            {actionChips.map((chip) => (
              <span
                key={chip.key}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${chip.className}`}
              >
                {chip.label}
              </span>
            ))}
          </div>
        )}
        {primaryActionDetail && (
          <p className="mt-1 text-xs leading-relaxed text-gray-500">
            {channel.ready
              ? primaryActionDetail
              : `Once the questions are answered: ${primaryActionDetail}`}
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-semibold text-gray-600">
          {PACKET_TIER_LABEL[channel.tier]}
        </span>
        <span
          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
            channel.ready ? TONE_CHIP.positive : TONE_CHIP.warning
          }`}
        >
          {statusLabel}
        </span>
      </div>
    </li>
  );
}

function packetReadyDetail(channel: ListingPacketChannelReadiness): string {
  if (channel.tier === "included") {
    return "Ready. We post it after you approve.";
  }
  if (channel.tier === "top_up") {
    return "Ready. You pay the site later.";
  }
  if (channel.tier === "broker") {
    return "Ready. Your agent sends the link later.";
  }
  return "Ready. You sign in and send the link later.";
}

// S695: SimpleGetOnline (the pre-Publish-Everywhere simple surface, never
// rendered under the PROD flags), PublishControlRoom and the basics / posting
// mode / health / automation / analytics panels were removed with the
// self-guided path (DECISION-S694). What stays behind "Advanced" is the
// channel card list: it owns the only Connect / Disconnect Facebook Page
// controls (fa4a808, held until the Meta verdict) and the tracked ad links.

// --- one channel card ------------------------------------------------------

// S695: the RentFaster posting kit (field sheet + gotchas, S262/S412) was
// removed with the self-guided posting path (DECISION-S694).

function ChannelCard({
  card,
  propertyId,
  linkIsLive,
  addFormKey,
  today,
  replyInputs,
}: {
  card: DistributeChannelCard;
  propertyId: string;
  linkIsLive: boolean;
  addFormKey: string;
  today: string;
  replyInputs: ReplyInputs;
}) {
  const { channel, status, copy, feed, partner } = card;
  const facebookPage = card.facebookPage;
  const instagramAccount = card.instagramAccount;
  const tone = channelStatusTone(status.value);
  const brokerRail =
    channel.mode === "broker" || channel.integrationStatus === "mls_gated";
  const combinedCopy = copy ? `${copy.title}\n\n${copy.body}` : null;
  // Reply snippets for the assisted-manual + feed channels (a renter messages
  // the operator; these route them to the branded booking page). Broker
  // (Realtor.ca, no copyKey) doesn't take DMs, so no snippets there.
  const replySnippets =
    channel.copyKey !== null
      ? buildReplySnippets({
          channelKey: channel.key,
          address: replyInputs.address,
          bookingUrl: replyInputs.bookingUrl,
          rentLabel: replyInputs.rentLabel,
        })
      : [];
  const refreshAge =
    status.value === "needs_refresh" && status.lastPostedOn
      ? daysBetween(status.lastPostedOn, today)
      : null;
  const proofSummary =
    card.posts.length > 0
      ? `${card.posts.length} ${card.posts.length === 1 ? "ad link" : "ad links"} saved`
      : "No ad link saved";

  return (
    <div
      className={`rounded-xl border p-4 ${
        brokerRail
          ? "border-slate-300 bg-slate-50 ring-1 ring-slate-200"
          : "border-gray-200 bg-white"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-semibold text-gray-900">
              {channel.label}
            </h4>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                brokerRail
                  ? "bg-slate-900 text-white"
                  : "bg-brand/10 text-brand"
              }`}
            >
              {channelModeLabel(channel.mode)}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE_CHIP[tone]}`}
            >
              {channelStatusLabel(status.value)}
            </span>
          </div>
          <p className="text-xs text-gray-500">
            {proofSummary}
            {status.inquiryCount > 0
              ? ` · ${status.inquiryCount} ${status.inquiryCount === 1 ? "inquiry" : "inquiries"}`
              : ""}
          </p>
        </div>
        {status.liveUrl && (
          <a
            href={status.liveUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
          >
            Open live ad
          </a>
        )}
      </div>

      {status.value === "needs_refresh" && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {refreshAge != null
            ? `Post it again after about ${refreshAge} days live.`
            : "Post it again."}
        </p>
      )}

      {status.value === "problem" && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          Live needs the link to your ad.
        </p>
      )}

      <div className="mt-3">
        {card.posts.length > 0 && (
          <ul className="mb-3 space-y-3">
            {card.posts.map((post) => (
              <PostRow
                key={post.id}
                post={post}
                propertyId={propertyId}
                linkIsLive={linkIsLive}
                fixedPortal={channel.key}
              />
            ))}
          </ul>
        )}

        {linkIsLive ? (
          <AddPostForm
            propertyId={propertyId}
            portal={channel.key}
            addFormKey={addFormKey}
          />
        ) : (
          <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
            Turn this rental on to create your links.
          </p>
        )}
      </div>

      <details className="mt-3 border-t border-gray-100 pt-3">
        <summary className="cursor-pointer text-xs font-semibold text-brand">
          Posting tools
        </summary>
        <div className="mt-3 space-y-3">
          <p className="text-xs text-gray-500">{channel.blurb}</p>

          {channel.key === "facebook_feed" && facebookPage?.enabled && (
            <div className="space-y-2 border-l-2 border-gray-200 pl-3 text-xs text-gray-600">
              <p>
                A Page post reaches people who follow your Page. For renters
                on Marketplace, use the Marketplace site instead.
              </p>
              {facebookPage.accountStatus === "connected" && facebookPage.pageName ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-gray-800">
                    Connected: {facebookPage.pageName}
                  </span>
                  <form action={disconnectFacebookPage}>
                    <input type="hidden" name="property_id" value={propertyId} />
                    <button
                      type="submit"
                      className="text-xs font-medium text-red-600 underline"
                    >
                      Disconnect
                    </button>
                  </form>
                </div>
              ) : (
                <a
                  href={`/api/integrations/facebook/connect?propertyId=${encodeURIComponent(propertyId)}`}
                  className={SECONDARY_BTN}
                >
                  Connect Facebook Page
                </a>
              )}
            </div>
          )}

          {channel.key === "instagram" && instagramAccount?.enabled && (
            <div className="space-y-2 border-l-2 border-gray-200 pl-3 text-xs text-gray-600">
              <p>
                We post one photo with a caption to your Instagram. The
                caption carries your inquiry link.
              </p>
              {instagramAccount.accountStatus === "connected" && instagramAccount.label ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-gray-800">
                    Connected: {instagramAccount.label}
                    {instagramAccount.pageName ? ` via ${instagramAccount.pageName}` : ""}
                  </span>
                  <form action={disconnectFacebookPage}>
                    <input type="hidden" name="property_id" value={propertyId} />
                    <button
                      type="submit"
                      className="text-xs font-medium text-red-600 underline"
                    >
                      Disconnect
                    </button>
                  </form>
                </div>
              ) : instagramAccount.hasLinkedBusinessAccount === false ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  The connected Facebook Page does not have a linked Instagram
                  Business account.
                </p>
              ) : (
                <a
                  href={`/api/integrations/facebook/connect?propertyId=${encodeURIComponent(propertyId)}`}
                  className={SECONDARY_BTN}
                >
                  Connect Facebook Page
                </a>
              )}
            </div>
          )}

          {status.blockers.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                Before posting
              </p>
              <ul className="space-y-1">
                {status.blockers.map((b) => (
                  <li
                    key={b}
                    className="flex items-start gap-1.5 text-xs text-gray-600"
                  >
                    <span aria-hidden className="mt-px text-amber-500">
                      ○
                    </span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {feed && (
            <p className="text-xs text-gray-500">
              <span className="font-medium text-gray-700">Partner sites:</span>{" "}
              {feed.inFeed
                ? "Sent on. Each partner site decides when to show it."
                : feed.hint}
            </p>
          )}

          {channel.feedEligible && (
            <PartnerSection
              channelKey={channel.key}
              channelLabel={channel.label}
              propertyId={propertyId}
              partner={partner}
            />
          )}

          <div className="flex flex-wrap items-center gap-2">
            <a
              href={channel.portalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={SECONDARY_BTN}
            >
              Open {channel.label} →
            </a>
            {combinedCopy && (
              <CopyTextButton
                value={combinedCopy}
                label="Copy this site's wording"
              />
            )}
            <a
              href="#listing-copy-title"
              className="text-xs font-medium text-brand underline"
            >
              Full wording and answers →
            </a>
          </div>

          {replySnippets.length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs font-medium text-brand">
                Reply snippets
              </summary>
              <div className="mt-2 space-y-2">
                {replySnippets.map((s) => (
                  <div
                    key={s.key}
                    className="rounded-lg border border-gray-200 bg-gray-50 p-2.5"
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                        {s.label}
                      </span>
                      <CopyTextButton value={s.text} label="Copy" />
                    </div>
                    <p className="text-xs text-gray-700">{s.text}</p>
                  </div>
                ))}
              </div>
            </details>
          )}

        </div>
      </details>
    </div>
  );
}

// --- one tracked post row (with inline edit + remove) ----------------------

function PostRow({
  post,
  propertyId,
  linkIsLive,
  fixedPortal,
  showLabel = false,
}: {
  post: DistributePostRow;
  propertyId: string;
  linkIsLive: boolean;
  fixedPortal: string;
  showLabel?: boolean;
}) {
  const statusChip =
    post.status === "live"
      ? TONE_CHIP.positive
      : post.status === "draft"
        ? TONE_CHIP.neutral
        : TONE_CHIP.warning;

  return (
    <li className="rounded-xl border border-gray-200 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {showLabel && post.label && (
          <span className="text-sm font-semibold text-gray-900">
            {post.label}
          </span>
        )}
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusChip}`}
        >
          {listingPostStatusLabel(post.status)}
        </span>
        <span className="text-xs text-gray-500">
          {post.inquiryCount}{" "}
          {post.inquiryCount === 1 ? "inquiry" : "inquiries"}
        </span>
        {post.posted_on && (
          <span className="text-xs text-gray-400">posted {post.posted_on}</span>
        )}
      </div>

      {post.trackedUrl ? (
        <>
          <p className="mb-1 text-xs font-medium text-gray-500">
            Your inquiry link for this post
          </p>
          <CopyLink url={post.trackedUrl} />
        </>
      ) : (
        <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
          Your links appear once this rental is on.
        </p>
      )}

      {post.notes && (
        <p className="mt-2 text-xs text-gray-500">{post.notes}</p>
      )}

      <details className="mt-2">
        <summary className="cursor-pointer text-xs font-medium text-brand">
          Edit or delete
        </summary>
        <form
          action={updateListingPost}
          className="mt-3 space-y-3 border-t border-gray-100 pt-3"
        >
          <input type="hidden" name="property_id" value={propertyId} />
          <input type="hidden" name="post_id" value={post.id} />
          <input type="hidden" name="portal" value={fixedPortal} />
          <PostFields
            idPrefix={`post-${post.id}`}
            defaults={post}
            showLabel={showLabel}
          />
          <button
            type="submit"
            className={PRIMARY_BTN}
            style={{ backgroundColor: "var(--brand-color)" }}
          >
            Save post
          </button>
        </form>
        <form action={removeListingPost} className="mt-2">
          <input type="hidden" name="property_id" value={propertyId} />
          <input type="hidden" name="post_id" value={post.id} />
          <button
            type="submit"
            className="text-xs font-medium text-red-600 hover:text-red-700"
          >
            Remove this post
          </button>
        </form>
      </details>
    </li>
  );
}

// --- "track a post / mark as posted" add form ------------------------------

function AddPostForm({
  propertyId,
  portal,
  addFormKey,
  showLabel = false,
}: {
  propertyId: string;
  portal: string;
  addFormKey: string;
  showLabel?: boolean;
}) {
  return (
    <details>
      <summary className="cursor-pointer text-sm font-medium text-brand">
        Save the link to your ad
      </summary>
      <form
        // Remount on a successful add to clear the uncontrolled inputs
        // (S226 form-reset). Per-portal key so each card's form is distinct.
        key={`add-${portal}-${addFormKey}`}
        action={addListingPost}
        className="mt-3 space-y-3 border-t border-gray-100 pt-3"
      >
        <input type="hidden" name="property_id" value={propertyId} />
        <input type="hidden" name="portal" value={portal} />
        <PostFields idPrefix={`add-${portal}`} showLabel={showLabel} />
        <button
          type="submit"
          className={PRIMARY_BTN}
          style={{ backgroundColor: "var(--brand-color)" }}
        >
          Save post
        </button>
      </form>
    </details>
  );
}

// Shared status / posted-date / url / label / notes fields for add + edit.
function PostFields({
  idPrefix,
  defaults,
  showLabel = false,
}: {
  idPrefix: string;
  defaults?: DistributePostRow;
  showLabel?: boolean;
}) {
  return (
    <>
      <div className="flex flex-wrap gap-3">
        <div className="w-36">
          <label
            htmlFor={`${idPrefix}-status`}
            className="mb-1 block text-xs font-medium text-gray-600"
          >
            Status
          </label>
          <select
            id={`${idPrefix}-status`}
            name="status"
            defaultValue={defaults?.status ?? "live"}
            className={FIELD_CLASS}
          >
            {LISTING_POST_STATUSES.map((s) => (
              <option key={s} value={s}>
                {listingPostStatusLabel(s)}
              </option>
            ))}
          </select>
        </div>
        <div className="w-40">
          <label
            htmlFor={`${idPrefix}-posted-on`}
            className="mb-1 block text-xs font-medium text-gray-600"
          >
            Posted date
          </label>
          <input
            id={`${idPrefix}-posted-on`}
            name="posted_on"
            type="date"
            defaultValue={defaults?.posted_on ?? ""}
            className={FIELD_CLASS}
          />
        </div>
      </div>
      <div>
        <label
          htmlFor={`${idPrefix}-url`}
          className="mb-1 block text-xs font-medium text-gray-600"
        >
          The link to your ad
        </label>
        <input
          id={`${idPrefix}-url`}
          name="url"
          defaultValue={defaults?.url ?? ""}
          placeholder="https://www.kijiji.ca/..."
          className={FIELD_CLASS}
        />
        <p className="mt-1 text-xs text-gray-400">
          We need this once the ad is up, so your link works.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        {showLabel && (
          <div className="flex-1 min-w-[12rem]">
            <label
              htmlFor={`${idPrefix}-label`}
              className="mb-1 block text-xs font-medium text-gray-600"
            >
              Label
            </label>
            <input
              id={`${idPrefix}-label`}
              name="label"
              defaultValue={defaults?.label ?? ""}
              placeholder="PadMapper"
              className={FIELD_CLASS}
            />
          </div>
        )}
        <div className="flex-1 min-w-[12rem]">
          <label
            htmlFor={`${idPrefix}-notes`}
            className="mb-1 block text-xs font-medium text-gray-600"
          >
            Notes
          </label>
          <input
            id={`${idPrefix}-notes`}
            name="notes"
            defaultValue={defaults?.notes ?? ""}
            className={FIELD_CLASS}
          />
        </div>
      </div>
    </>
  );
}

// --- feed-partner onboarding (Slice 3) -------------------------------------

function PartnerSection({
  channelKey,
  channelLabel,
  propertyId,
  partner,
}: {
  channelKey: string;
  channelLabel: string;
  propertyId: string;
  partner: PartnerAccountView | null;
}) {
  const status: PartnerStatus = partner?.status ?? "not_started";
  const tone = partnerStatusTone(status);
  const nextStep = partnerNextStep({
    status,
    hasFeedUrl: !!partner?.feedUrl,
  });

  return (
    <div className="mb-3 rounded-lg border border-gray-100 bg-gray-50 p-3">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          Partner site
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE_CHIP[tone]}`}
        >
          {partnerStatusLabel(status)}
        </span>
      </div>
      <p className="mb-2 text-xs text-gray-600">{nextStep}</p>
      <details>
        <summary className="cursor-pointer text-xs font-medium text-brand">
          {partner ? "Update partner setup" : "Set up a partner site"}
        </summary>
        <form
          action={upsertPartnerAccount}
          className="mt-3 space-y-3 border-t border-gray-100 pt-3"
        >
          <input type="hidden" name="property_id" value={propertyId} />
          <input type="hidden" name="channel" value={channelKey} />
          <div className="flex flex-wrap gap-3">
            <div className="w-40">
              <label
                htmlFor={`partner-${channelKey}-status`}
                className="mb-1 block text-xs font-medium text-gray-600"
              >
                Status
              </label>
              <select
                id={`partner-${channelKey}-status`}
                name="status"
                defaultValue={status}
                className={FIELD_CLASS}
              >
                {PARTNER_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {partnerStatusLabel(s)}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-[12rem] flex-1">
              <label
                htmlFor={`partner-${channelKey}-contact`}
                className="mb-1 block text-xs font-medium text-gray-600"
              >
                Partner contact
              </label>
              <input
                id={`partner-${channelKey}-contact`}
                name="partner_contact"
                defaultValue={partner?.partnerContact ?? ""}
                placeholder="name@partner.com"
                className={FIELD_CLASS}
              />
            </div>
          </div>
          <div>
            <label
              htmlFor={`partner-${channelKey}-feed-url`}
              className="mb-1 block text-xs font-medium text-gray-600"
            >
              Link sent to {channelLabel}
            </label>
            <input
              id={`partner-${channelKey}-feed-url`}
              name="feed_url"
              defaultValue={partner?.feedUrl ?? ""}
              placeholder="https://app.vacantless.com/api/feed/..."
              className={FIELD_CLASS}
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="w-40">
              <label
                htmlFor={`partner-${channelKey}-submitted`}
                className="mb-1 block text-xs font-medium text-gray-600"
              >
                Submitted
              </label>
              <input
                id={`partner-${channelKey}-submitted`}
                name="submitted_on"
                type="date"
                defaultValue={partner?.submittedOn ?? ""}
                className={FIELD_CLASS}
              />
            </div>
            <div className="w-40">
              <label
                htmlFor={`partner-${channelKey}-accepted`}
                className="mb-1 block text-xs font-medium text-gray-600"
              >
                Accepted
              </label>
              <input
                id={`partner-${channelKey}-accepted`}
                name="accepted_on"
                type="date"
                defaultValue={partner?.acceptedOn ?? ""}
                className={FIELD_CLASS}
              />
            </div>
            <div className="w-40">
              <label
                htmlFor={`partner-${channelKey}-checked`}
                className="mb-1 block text-xs font-medium text-gray-600"
              >
                Last checked
              </label>
              <input
                id={`partner-${channelKey}-checked`}
                name="last_checked_on"
                type="date"
                defaultValue={partner?.lastCheckedOn ?? ""}
                className={FIELD_CLASS}
              />
            </div>
          </div>
          <div>
            <label
              htmlFor={`partner-${channelKey}-notes`}
              className="mb-1 block text-xs font-medium text-gray-600"
            >
              Notes {partner?.status === "rejected" ? "on why it was turned down" : ""}
            </label>
            <input
              id={`partner-${channelKey}-notes`}
              name="notes"
              defaultValue={partner?.notes ?? ""}
              className={FIELD_CLASS}
            />
          </div>
          <button
            type="submit"
            className={PRIMARY_BTN}
            style={{ backgroundColor: "var(--brand-color)" }}
          >
            Save partner setup
          </button>
        </form>
      </details>
    </div>
  );
}

function IconTile({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand/10 text-brand">
      {children}
    </span>
  );
}
