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
  LaunchRunPanel,
  type PublishChannelChoiceView,
  type RunItemView,
} from "./launch-run-panel";
import { activeRunChannelCount, type RunProgress } from "@/lib/distribution-run";
import { buildReplySnippets } from "@/lib/reply-snippets";
import {
  analyticsTotals,
  type ChannelAnalyticsRow,
} from "@/lib/distribution-analytics";
import { QaChecker } from "./qa-checker";
import type { QaExpected } from "@/lib/post-publish-qa";
import {
  gradeLabel,
  type ListingQuality,
  type FairHousingFlag,
} from "@/lib/listing-quality";
import type { FillSheet } from "@/lib/listing-fill-sheet";

export type QualityView = {
  listing: ListingQuality;
  fairFlags: FairHousingFlag[];
  missing: string[];
};

export type LaunchRunData = {
  run: { id: string } | null;
  items: RunItemView[];
  progress: RunProgress;
  selectable: PublishChannelChoiceView[];
  startChannels: PublishChannelChoiceView[];
  // Distribution Lane B: REALTOR_REFERRAL_ENABLED firewall, threaded to the
  // Realtor.ca "dispatch a network agent" referral option in the run panel.
  realtorReferralEnabled: boolean;
};

export type ReplyInputs = {
  address: string;
  bookingUrl: string | null;
  rentLabel: string | null;
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

// A fully-resolved channel card: the matrix row + computed status + the
// matching channel copy + feed note + partner account + this channel's posts.
export type DistributeChannelCard = {
  channel: DistributionChannel;
  status: ChannelStatus;
  copy: { title: string; body: string } | null;
  fillSheet: FillSheet | null;
  feed: { inFeed: boolean; hint: string } | null;
  partner: PartnerAccountView | null;
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

type DistributionHealth = {
  totalChannels: number;
  activeChannels: number;
  liveChannels: number;
  submittedChannels: number;
  attentionChannels: number;
  staleChannels: number;
  proofIssueChannels: number;
  trackedPosts: number;
  attributedLeads: number;
  advancedLeads: number;
};

// --- next-action banner (Slice 1) ------------------------------------------
// One prioritized "do this next" line across all run channels, so the command
// center leads with a single obvious step (Codex #1/#4). Pure — derived only
// from the run items' publish status. Resolved states (live / submitted /
// skipped) and attention states handled inside the row (blocked / rejected)
// don't drive the banner; it points at the next thing to DO.
const NEXT_ACTION_WEIGHT: Record<string, number> = {
  needs_login: 1,
  needs_payment: 1,
  needs_operator: 2,
  queued: 3,
};
function nextRunAction(items: RunItemView[]): { label: string } | null {
  let best: { weight: number; item: RunItemView } | null = null;
  for (const item of items) {
    const weight = NEXT_ACTION_WEIGHT[item.publishStatus];
    if (weight == null) continue;
    if (!best || weight < best.weight) best = { weight, item };
  }
  if (!best) return null;
  const it = best.item;
  const label =
    it.publishStatus === "needs_payment"
      ? `Sign in or pay on ${it.channelLabel} to post it`
      : it.publishStatus === "needs_login"
        ? `Sign in on ${it.channelLabel} to post it`
        : it.publishStatus === "queued"
        ? `Start ${it.channelLabel}`
        : it.channel === "vacantless"
          ? "Confirm your renter page"
          : it.channel === "org_feed"
            ? "Confirm your listing feed"
            : it.mode === "broker"
              ? `Send ${it.channelLabel} to your agent`
              : it.mode === "feed_partner"
                ? `Publish ${it.channelLabel} via your feed`
                : `Post on ${it.channelLabel} next`;
  return { label };
}

function distributionHealth({
  channelCards,
  otherPosts,
  launchRun,
  analytics,
}: {
  channelCards: DistributeChannelCard[];
  otherPosts: DistributePostRow[];
  launchRun: LaunchRunData;
  analytics: ChannelAnalyticsRow[];
}): DistributionHealth {
  const runItems = launchRun.items;
  const activeChannels = activeRunChannelCount({
    hasRun: Boolean(launchRun.run),
    runItemCount: runItems.length,
  });
  const submittedChannels = runItems.filter(
    (item) => item.publishStatus === "submitted",
  ).length;
  const attentionChannels = runItems.filter(
    (item) =>
      item.publishStatus === "blocked" ||
      item.publishStatus === "rejected" ||
      item.publishStatus === "needs_login" ||
      item.publishStatus === "needs_payment" ||
      item.publishStatus === "needs_operator" ||
      item.liveWithoutUrl ||
      item.staleRefresh,
  ).length;
  const staleChannels = channelCards.filter(
    (card) => card.status.value === "needs_refresh",
  ).length;
  const proofIssueChannels = channelCards.filter(
    (card) => card.status.value === "problem",
  ).length;
  const allPosts = [
    ...channelCards.flatMap((card) => card.posts),
    ...otherPosts,
  ];
  const totals = analyticsTotals(analytics);

  return {
    totalChannels: channelCards.length,
    activeChannels,
    liveChannels: channelCards.filter(
      (card) =>
        card.status.value === "posted" ||
        card.status.value === "needs_refresh",
    ).length,
    submittedChannels,
    attentionChannels,
    staleChannels,
    proofIssueChannels,
    trackedPosts: allPosts.length,
    attributedLeads: totals.leads,
    advancedLeads: totals.advanced,
  };
}

export function DistributeTab({
  propertyId,
  linkIsLive,
  addFormKey,
  today,
  readyToShare,
  requiredOutstanding,
  channelCards,
  otherPosts,
  promotionNote,
  launchRun,
  replyInputs,
  analytics,
  quality,
  qaExpected,
  reservedTrackedLinksByChannel,
}: {
  propertyId: string;
  linkIsLive: boolean;
  addFormKey: string;
  today: string;
  readyToShare: boolean;
  requiredOutstanding: number;
  channelCards: DistributeChannelCard[];
  otherPosts: DistributePostRow[];
  promotionNote: string | null;
  launchRun: LaunchRunData;
  replyInputs: ReplyInputs;
  analytics: ChannelAnalyticsRow[];
  quality: QualityView;
  qaExpected: QaExpected;
  reservedTrackedLinksByChannel: Record<string, string>;
}) {
  const liveChannels = channelCards.filter(
    (c) => c.status.value === "posted" || c.status.value === "needs_refresh",
  ).length;
  const nextAction = launchRun.run ? nextRunAction(launchRun.items) : null;
  const health = distributionHealth({
    channelCards,
    otherPosts,
    launchRun,
    analytics,
  });

  return (
    <div>
      {/* Header — what this tab is + a one-line readiness signal. */}
      <div
        id="distribute-header"
        className="mb-6 scroll-mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
      >
        <div className="mb-2 flex items-center gap-2.5">
          <IconTile><Icons.link className="h-4 w-4" /></IconTile>
          <h3 className="text-sm font-semibold text-gray-900">
            Market this property
          </h3>
        </div>
        <p className="mb-3 text-xs text-gray-500">
          Choose where to publish, follow the steps for each site, and see which
          channels bring renters back. Vacantless handles what it can, guides you
          where a site needs login or payment, and saves proof before anything is
          counted as Live.
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span
            className={`rounded-full px-2.5 py-0.5 font-medium ${
              readyToShare ? TONE_CHIP.positive : TONE_CHIP.warning
            }`}
          >
            {readyToShare
              ? "Ready to distribute"
              : `${requiredOutstanding} ${
                  requiredOutstanding === 1 ? "thing" : "things"
                } to finish first`}
          </span>
          <span className="rounded-full bg-gray-100 px-2.5 py-0.5 font-medium text-gray-600">
            {liveChannels} {liveChannels === 1 ? "channel" : "channels"} posted
          </span>
          {!readyToShare && (
            <a href="#share" className="font-medium text-brand underline">
              Finish setup in Photos &amp; listing copy →
            </a>
          )}
        </div>
        {!linkIsLive && promotionNote && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {promotionNote}
          </p>
        )}
      </div>

      {/* Next-action banner (Slice 1): one prioritized step across all channels,
          so the command center leads with a single obvious action (Codex #1/#4). */}
      {nextAction && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-brand/30 bg-brand/5 px-5 py-3">
          <span className="rounded-full bg-brand px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">
            Next
          </span>
          <span className="text-sm font-semibold text-gray-900">
            {nextAction.label}
          </span>
        </div>
      )}

      <DistributionHealthPanel health={health} />

      {/* THE command center — one guided surface: pick channels, follow one next
          action per channel, paste the live URL. After the Slice 1 merge this is
          the single action surface (Codex #2). */}
      <LaunchRunPanel
        propertyId={propertyId}
        run={launchRun.run}
        items={launchRun.items}
        progress={launchRun.progress}
        selectable={launchRun.selectable}
        startChannels={launchRun.startChannels}
        realtorReferralEnabled={launchRun.realtorReferralEnabled}
      />

      {/* Posted links & tools (Slice 1): the old per-channel grid + the "other
          channels" tracker, demoted to a collapsed drawer. These are tools
          (tracked links, reply snippets, add-a-tracked-post), not a second action
          surface — one command center, one place per channel (Codex #2). Feed
          partner setup stays inside its channel card here. */}
      <details className="mt-4 rounded-2xl border border-gray-200 bg-white shadow-sm">
        <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-gray-900">
          Posted links &amp; tools
          <span className="ml-2 text-xs font-normal text-gray-500">
            Tracked links, reply snippets, and manually-tracked posts
          </span>
        </summary>
        <div className="border-t border-gray-100 px-5 py-4">
          {/* Per-channel cards (tracked posts, copy, reply snippets, partner). */}
          <div className="space-y-4">
            {channelCards.map((card) => (
              <ChannelCard
                key={card.channel.key}
                card={card}
                propertyId={propertyId}
                linkIsLive={linkIsLive}
                addFormKey={addFormKey}
                today={today}
                replyInputs={replyInputs}
                qaExpected={qaExpected}
                reservedTrackedUrl={
                  reservedTrackedLinksByChannel[card.channel.key] ?? null
                }
              />
            ))}
          </div>

          {/* Other / manual channels — anything not in the matrix (PadMapper, a
              local board, a custom post). Keeps the durable "this ad exists here"
              record for attribution. */}
          <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-5">
            <div className="mb-2 flex items-center gap-2.5">
              <IconTile><Icons.list className="h-4 w-4" /></IconTile>
              <h3 className="text-sm font-semibold text-gray-900">
                Other channels
              </h3>
            </div>
            <p className="mb-4 text-xs text-gray-500">
              Track any other place you posted, like a local board, community
              group, or niche site, so its inquiries are counted too.
            </p>

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
                Tracking a post turns on when this rental is Live and accepting
                inquiries.
              </p>
            )}
          </div>
        </div>
      </details>

      {/* Performance & setup (Slice 1): listing quality + what's-working
          analytics, collapsed. Present for power users, out of the first read
          (Codex #5). */}
      <details className="mt-4 rounded-2xl border border-gray-200 bg-white shadow-sm">
        <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-gray-900">
          Performance &amp; setup
          <span className="ml-2 text-xs font-normal text-gray-500">
            Listing quality and what&apos;s bringing renters back
          </span>
        </summary>
        <div className="border-t border-gray-100 px-5 py-4">
          <ListingQualityPanel quality={quality} />
          <AnalyticsPanel rows={analytics} />
        </div>
      </details>
    </div>
  );
}

function DistributionHealthPanel({ health }: { health: DistributionHealth }) {
  const coverageLabel =
    health.totalChannels > 0
      ? `${health.liveChannels}/${health.totalChannels}`
      : "0/0";
  const attentionTone =
    health.proofIssueChannels > 0
      ? "danger"
      : health.attentionChannels > 0 || health.staleChannels > 0
        ? "warning"
        : "positive";
  const attentionLabel =
    health.proofIssueChannels > 0
      ? `${health.proofIssueChannels} proof gap${
          health.proofIssueChannels === 1 ? "" : "s"
        }`
      : health.attentionChannels > 0
        ? `${health.attentionChannels} action${
            health.attentionChannels === 1 ? "" : "s"
          } needed`
        : health.staleChannels > 0
          ? `${health.staleChannels} refresh${
              health.staleChannels === 1 ? "" : "es"
            } due`
          : "Clean";

  return (
    <section className="mb-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <IconTile>
            <Icons.list className="h-4 w-4" />
          </IconTile>
          <h3 className="text-sm font-semibold text-gray-900">
            Distribution health
          </h3>
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE_CHIP[attentionTone]}`}
        >
          {attentionLabel}
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <HealthMetric label="Live coverage" value={coverageLabel} />
        <HealthMetric
          label="In active run"
          value={String(health.activeChannels)}
        />
        <HealthMetric
          label="Submitted, not live"
          value={String(health.submittedChannels)}
        />
        <HealthMetric
          label="Tracked posts"
          value={String(health.trackedPosts)}
        />
        <HealthMetric
          label="Attributed leads"
          value={String(health.attributedLeads)}
        />
        <HealthMetric
          label="Booked or advanced"
          value={String(health.advancedLeads)}
        />
        <HealthMetric
          label="Refresh due"
          value={String(health.staleChannels)}
        />
        <HealthMetric
          label="Proof gaps"
          value={String(health.proofIssueChannels)}
        />
      </div>
    </section>
  );
}

function HealthMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
      <p className="text-[11px] font-medium uppercase text-gray-500">
        {label}
      </p>
      <p className="mt-1 text-base font-semibold text-gray-900">{value}</p>
    </div>
  );
}

// --- distribution analytics (Slice 4) --------------------------------------

function AnalyticsPanel({ rows }: { rows: ChannelAnalyticsRow[] }) {
  if (rows.length === 0) return null;
  const totals = analyticsTotals(rows);
  return (
    <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-2 flex items-center gap-2.5">
        <IconTile><Icons.list className="h-4 w-4" /></IconTile>
        <h3 className="text-sm font-semibold text-gray-900">
          What&apos;s working
        </h3>
      </div>
      <p className="mb-4 text-xs text-gray-500">
        See which places actually produced renters: {totals.leads}{" "}
        {totals.leads === 1 ? "inquiry" : "inquiries"} across{" "}
        {totals.channelsWithLeads}{" "}
        {totals.channelsWithLeads === 1 ? "channel" : "channels"},{" "}
        {totals.advanced} that booked or progressed.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-500">
              <th className="py-1.5 pr-3 font-medium">Channel</th>
              <th className="py-1.5 pr-3 font-medium">Leads</th>
              <th className="py-1.5 pr-3 font-medium">Booked+</th>
              <th className="py-1.5 pr-3 font-medium">Days live</th>
              <th className="py-1.5 font-medium">Next step</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.channel} className="border-b border-gray-100 align-top">
                <td className="py-2 pr-3 font-medium text-gray-800">{r.label}</td>
                <td className="py-2 pr-3 text-gray-700">{r.leads}</td>
                <td className="py-2 pr-3 text-gray-700">{r.advanced}</td>
                <td className="py-2 pr-3 text-gray-500">
                  {r.daysLive != null ? r.daysLive : r.hasLivePost ? "-" : "not live"}
                </td>
                <td className="py-2 text-gray-500">{r.suggestion}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- one channel card ------------------------------------------------------

function groupedFillSheetFields(sheet: FillSheet): Array<{
  step: string;
  fields: FillSheet["fields"];
}> {
  const groups: Array<{ step: string; fields: FillSheet["fields"] }> = [];
  const byStep = new Map<string, FillSheet["fields"]>();
  for (const field of sheet.fields) {
    const step = field.step ?? "Fields";
    const fields = byStep.get(step) ?? [];
    fields.push(field);
    byStep.set(step, fields);
  }
  for (const [step, fields] of byStep) groups.push({ step, fields });
  return groups;
}

function RentFasterPostingKit({
  copy,
  fillSheet,
  reservedTrackedUrl,
}: {
  copy: { title: string; body: string } | null;
  fillSheet: FillSheet | null;
  reservedTrackedUrl: string | null;
}) {
  const groups = fillSheet ? groupedFillSheetFields(fillSheet) : [];
  const gotchas = [
    "Set Province to Ontario before choosing the address.",
    "Pick the Google address suggestion and confirm the community/map.",
    "Review property type; use Fourplex for a unit in a fourplex.",
    "Remove Credit Report and Zumper/PadMapper add-ons unless approved.",
    "Paid promotion is optional and owner-approved, not automatic.",
    "Upload photos after payment, then paste the public RentFaster ad URL.",
  ];

  return (
    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-amber-950">
            RentFaster posting kit
          </p>
          <p className="text-[11px] text-amber-800">
            Use this while logged in on the RentFaster add-listing page.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {copy && (
            <>
              <CopyTextButton value={copy.title} label="Copy title" />
              <CopyTextButton value={copy.body} label="Copy description" />
            </>
          )}
        </div>
      </div>

      <div className="mb-3 rounded-lg border border-amber-200 bg-white p-2.5">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-900">
          Tracked inquiry link
        </p>
        {reservedTrackedUrl ? (
          <CopyLink url={reservedTrackedUrl} />
        ) : (
          <p className="text-xs text-amber-800">
            Add RentFaster to a publish run to reserve the tracked link before
            you post.
          </p>
        )}
      </div>

      {fillSheet && (
        <details className="mb-3 rounded-lg border border-amber-200 bg-white p-2.5">
          <summary className="cursor-pointer text-xs font-semibold text-amber-950">
            RentFaster field sheet
          </summary>
          <div className="mt-2 space-y-3">
            {groups.map((group) => (
              <div key={group.step}>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  {group.step}
                </p>
                <dl className="space-y-1">
                  {group.fields.map((field) => (
                    <div
                      key={field.id}
                      className="rounded-lg border border-gray-100 bg-gray-50 px-2.5 py-2"
                    >
                      <dt className="text-[11px] font-semibold text-gray-700">
                        {field.label}
                      </dt>
                      <dd className="mt-0.5 text-xs text-gray-900">
                        {field.value ?? "Manual / review"}
                      </dd>
                      {field.hint && (
                        <dd className="mt-1 text-[11px] text-gray-500">
                          {field.hint}
                        </dd>
                      )}
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        </details>
      )}

      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-900">
          RentFaster gotchas
        </p>
        <ul className="space-y-1">
          {gotchas.map((gotcha) => (
            <li
              key={gotcha}
              className="flex items-start gap-1.5 text-xs text-amber-900"
            >
              <span aria-hidden className="mt-px">
                ○
              </span>
              <span>{gotcha}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ChannelCard({
  card,
  propertyId,
  linkIsLive,
  addFormKey,
  today,
  replyInputs,
  qaExpected,
  reservedTrackedUrl,
}: {
  card: DistributeChannelCard;
  propertyId: string;
  linkIsLive: boolean;
  addFormKey: string;
  today: string;
  replyInputs: ReplyInputs;
  qaExpected: QaExpected;
  reservedTrackedUrl: string | null;
}) {
  const { channel, status, copy, fillSheet, feed, partner } = card;
  const tone = channelStatusTone(status.value);
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

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      {/* Header row: name + mode + status. */}
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold text-gray-900">{channel.label}</h4>
        <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand">
          {channelModeLabel(channel.mode)}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE_CHIP[tone]}`}
        >
          {channelStatusLabel(status.value)}
        </span>
        {status.inquiryCount > 0 && (
          <span className="text-[11px] text-gray-500">
            {status.inquiryCount}{" "}
            {status.inquiryCount === 1 ? "inquiry" : "inquiries"}
          </span>
        )}
      </div>

      <p className="mb-3 text-xs text-gray-500">{channel.blurb}</p>

      {/* Live-ad summary (posted / needs refresh). */}
      {status.liveUrl && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs">
          <a
            href={status.liveUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-brand underline"
          >
            Open live ad →
          </a>
          {status.lastPostedOn && (
            <span className="text-gray-500">
              Posted {status.lastPostedOn}
            </span>
          )}
        </div>
      )}

      {/* Refresh reminder. */}
      {status.value === "needs_refresh" && (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {refreshAge != null
            ? `This ad has been up about ${refreshAge} days. Refresh or repost it so it stays near the top.`
            : "This ad may be stale. Refresh or repost it, then update its status below."}
        </p>
      )}

      {/* Problem: a live post lost its link. */}
      {status.value === "problem" && (
        <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          A post here is marked Live but has no ad link, so its inquiries
          can&apos;t be tracked. Add the ad URL below.
        </p>
      )}

      {/* Missing requirements (blockers). */}
      {status.blockers.length > 0 && (
        <div className="mb-3">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            Before you post here
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

      {/* Feed note (feed-eligible channels only). */}
      {feed && (
        <p className="mb-3 text-xs text-gray-500">
          <span className="font-medium text-gray-700">Listing feed:</span>{" "}
          {feed.inFeed
            ? "This rental is in your Vacantless feed. A partner site still needs to accept and show it before it is live there."
            : feed.hint}
        </p>
      )}

      {/* Feed-partner onboarding (Slice 3) — org-level, edited from here. */}
      {channel.feedEligible && (
        <PartnerSection
          channelKey={channel.key}
          channelLabel={channel.label}
          propertyId={propertyId}
          partner={partner}
        />
      )}

      {/* Actions: open portal + copy channel wording. */}
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <a
          href={channel.portalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={SECONDARY_BTN}
        >
          Open {channel.label} →
        </a>
        {combinedCopy && (
          <CopyTextButton value={combinedCopy} label="Copy this channel's wording" />
        )}
        <a href="#listing-copy-title" className="text-xs font-medium text-brand underline">
          Full copy &amp; field sheet in Photos &amp; listing copy →
        </a>
      </div>

      {channel.key === "rentfaster" && (
        <RentFasterPostingKit
          copy={copy}
          fillSheet={fillSheet}
          reservedTrackedUrl={reservedTrackedUrl}
        />
      )}

      {/* Reply snippets — ready-to-paste replies to a renter's message. */}
      {replySnippets.length > 0 && (
        <details className="mt-3">
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

      {/* Post-publish QA checker (Slice 6). */}
      <QaChecker channelKey={channel.key} expected={qaExpected} />

      {/* Tracked posts + add form. */}
      <div className="mt-3 border-t border-gray-100 pt-3">
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
            Set this rental Live to get a tracked inquiry link for this channel.
          </p>
        )}
      </div>
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
            Tracked inquiry link for this post
          </p>
          <CopyLink url={post.trackedUrl} />
        </>
      ) : (
        <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
          Tracked links are hidden while this rental is not Live.
        </p>
      )}

      {post.notes && (
        <p className="mt-2 text-xs text-gray-500">{post.notes}</p>
      )}

      <details className="mt-2">
        <summary className="cursor-pointer text-xs font-medium text-brand">
          Edit / remove
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
        + Track a live ad
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
          Ad URL
        </label>
        <input
          id={`${idPrefix}-url`}
          name="url"
          defaultValue={defaults?.url ?? ""}
          placeholder="https://www.kijiji.ca/..."
          className={FIELD_CLASS}
        />
        <p className="mt-1 text-xs text-gray-400">
          Required once the post is Live, so its tracked link works.
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

// --- listing quality (Slice 5) ---------------------------------------------

function ListingQualityPanel({ quality }: { quality: QualityView }) {
  const { listing, fairFlags, missing } = quality;
  const toneClass =
    listing.grade === "strong"
      ? "bg-green-50 text-green-700"
      : listing.grade === "fair"
        ? "bg-amber-50 text-amber-700"
        : "bg-red-50 text-red-700";
  const weakChecks = listing.checks.filter((c) => !c.ok);

  return (
    <details className="mb-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-gray-900">
          Listing quality
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${toneClass}`}
        >
          {gradeLabel(listing.grade)} · {listing.score}/100
        </span>
        {fairFlags.length > 0 && (
          <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">
            {fairFlags.length} wording{" "}
            {fairFlags.length === 1 ? "flag" : "flags"}
          </span>
        )}
      </summary>

      <div className="mt-3 space-y-3">
        {weakChecks.length > 0 && (
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              Strengthen
            </p>
            <ul className="space-y-1">
              {weakChecks.map((c) => (
                <li key={c.key} className="flex items-start gap-2 text-xs text-gray-600">
                  <span aria-hidden className="mt-px text-amber-500">○</span>
                  <span>{c.hint}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {fairFlags.length > 0 && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-red-700">
              Fair-housing wording (Ontario Human Rights Code)
            </p>
            <ul className="space-y-1.5">
              {fairFlags.map((f) => (
                <li key={f.key} className="text-xs text-red-800">
                  <span className="font-medium">{f.ground}:</span> {f.message}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-red-600">
              Guidance, not legal advice.
            </p>
          </div>
        )}

        {missing.length > 0 && (
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              Details that make ads convert
            </p>
            <p className="text-xs text-gray-500">
              Your description doesn&apos;t mention: {missing.join(", ")}.{" "}
              <a href="#listing-description" className="font-medium text-brand underline">
                Add a few in the description →
              </a>
            </p>
          </div>
        )}

        {weakChecks.length === 0 && fairFlags.length === 0 && missing.length === 0 && (
          <p className="text-xs text-gray-500">
            This listing is strong across the board - nothing to fix.
          </p>
        )}
      </div>
    </details>
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
          Feed partner
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
          {partner ? "Update partner setup" : "Set up feed partner"}
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
              Feed URL submitted to {channelLabel}
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
              Notes {partner?.status === "rejected" ? "(rejection reason)" : ""}
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
