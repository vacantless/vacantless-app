"use client";

// ============================================================================
// Publish Everywhere — the one-click "Market it" surface (S630 Slice 1;
// S631 Slice 3 adds the real co-pilot handoff + concierge queue + fees).
//
// Slice 1 was RENDER-ONLY: it resolved every channel to a MODE, grouped modes
// into three honest BUCKETS, showed reach + legend, and offered the dominant
// "Publish everywhere" CTA behind a preflight confirm modal that ran the EXISTING
// publishProperty (page-live + authorized-instant autofire).
//
// Slice 3 (behind PUBLISH_EVERYWHERE_COPILOT_ENABLED) makes the "we post these
// for you" bucket actionable, reusing the existing machinery — NO new posting
// path, NO new server action, NO migration:
//   • Co-pilot-capable channels (Kijiji + FB Marketplace, the extension-fillable
//     ones) resolve into the for-you bucket and, once a distribution run exists,
//     get a real "Open posting step" deep-link to the existing co-pilot
//     sidecar (the extension co-locates the fill on the portal page). The
//     landlord signs in, covers any site fee, and taps post — we never post,
//     log in, or pay for them.
//   • "Have us post it" hands the same item to the publishing desk via the
//     existing requestConciergePublish action (which consumes one done-for-you
//     publish from the plan allowance when CONCIERGE_DESK_ENABLED).
//   • Paid self-serve sites (paid_optin) show the paid-DIRECT fee disclosure:
//     the fee is set by the site and paid with the landlord's own card at post
//     time — Vacantless never charges it, fronts it, or is the merchant.
//
// Honesty invariants carried forward: nothing posts before the confirm modal
// (KI999); "instant" is claimed ONLY for connected/authorized/accepted channels
// and "we post it for you" ONLY for channels with a real co-pilot mechanism (the
// resolver enforces both); reach "included" is instant + for-you, never the raw
// channel count; the extension/desk never posts, signs in, or pays for the
// landlord (Meta App Review commitment). With the Slice-3 flag OFF the surface
// renders exactly as Slice 1.
// ============================================================================

import { useState } from "react";
import { Icons } from "@/components/icons";
import { CopyLink } from "./copy-link";
import { publishProperty, requestConciergePublish, openGuidedPosting } from "../actions";
import {
  authorizeAutopilotSubmit,
  authorizeChannelAutomation,
  readInstantPublishDestinations,
  revokeChannelAutomation,
} from "../distribution-actions";
import {
  derivePublishPreflight,
  resolvePublishMode,
  summarizeReach,
  isCopilotSupportedKey,
  forYouLiveState,
  liveProofUrlFromPosts,
  retiredProofUrlsFromPosts,
  type PublishMode,
  type PublishBucket,
  type PublishChannelInput,
} from "@/lib/publish-everywhere";
import { conciergeUsageLabel } from "@/lib/billing";
import { firstRunCostLine, firstRunIsFree } from "@/lib/distribution-channels";
import type {
  DistributeChannelCard,
  GetOnlineBasics,
  ReplyInputs,
} from "./distribute-tab";

// A for-you channel's live distribution run item (once publishProperty has
// created the run). Carries what an action row needs: the sidecar deep-link id,
// the channel key, the live/queued state, whether the desk can take it over
// (plan-gated, computed in page.tsx), and the recorded live-ad link.
export type PublishEverywhereRunItem = {
  id: string;
  channel: string;
  publishStatus: string;
  mode: string;
  canConcierge: boolean;
  externalUrl: string | null;
};

export type PublishEverywherePostingBlocker = {
  title: string;
  detail: string;
  href: string;
  action: string;
};

// --- per-channel presentation (mode -> chip) -------------------------------
// One place maps a resolved mode to its user-facing chip. No new color system:
// green = instant, indigo = we-post-for-you, gray = after-setup (same tones the
// north-star and the rest of the tab already use).
const MODE_CHIP: Record<PublishMode, { label: string; cls: string }> = {
  instant_auto: { label: "Instant", cls: "bg-green-50 text-green-700" },
  copilot_fill: { label: "Sign in + post", cls: "bg-indigo-50 text-indigo-700" },
  paid_optin: { label: "Sign in + fee", cls: "bg-indigo-50 text-indigo-700" },
  needs_connection: { label: "Sign in first", cls: "bg-gray-100 text-gray-600" },
  brokerage_gated: { label: "Via brokerage", cls: "bg-gray-100 text-gray-600" },
  planned: { label: "Coming soon", cls: "bg-gray-100 text-gray-600" },
};

const BUCKET_META: Record<
  PublishBucket,
  { title: string; note: string; dot: string }
> = {
  instant: {
    title: "Connected now",
    note: "",
    dot: "bg-green-500",
  },
  for_you: {
    title: "Needs your sign-in",
    note: "",
    dot: "bg-indigo-500",
  },
  after_setup: {
    title: "Needs setup",
    note: "",
    dot: "bg-gray-400",
  },
};

// A tiny per-channel glyph for the row. Purely decorative; unknown keys fall
// back to a house. Keeps the surface readable without pulling in brand SVGs.
const CHANNEL_GLYPH: Record<string, string> = {
  facebook: "🛒",
  kijiji: "🅺",
  linkedin: "in",
  instagram: "📸",
  facebook_feed: "📘",
  whatsapp: "🟢",
  snapchat: "👻",
  rentals_ca: "🏢",
  rentfaster: "🏘️",
  zumper: "📍",
  viewit: "👁️",
  realtor_ca: "Ⓡ",
};

// Paid self-serve listing sites (a listing fee applies, paid direct to the
// site). Only matters for LIVE assisted_manual channels — a planned one still
// resolves to "planned" unless it is also co-pilot-capable (the resolver
// settles this). The label is display-only; the fee amount is set by the site.
const PAID_SITE_KEYS = new Set(["viewit", "rentfaster"]);
const PAID_SITE_LABEL: Record<string, string> = {
  viewit: "Viewit",
  rentfaster: "RentFaster",
};

// Adapt a fully-resolved channel card into the resolver's structural input.
// Channel-agnostic: reads only the card's config + account state, never a
// hard-coded channel name (adding a channel is a config row, no edit here).
// `copilotEnabled` is the Slice-3 flag: only then do we mark the extension-
// fillable channels co-pilot-capable, so with the flag off the surface resolves
// exactly as Slice 1 (FB Marketplace stays "coming soon").
function toPublishInput(
  card: DistributeChannelCard,
  copilotEnabled: boolean,
): PublishChannelInput {
  const ch = card.channel;
  return {
    key: ch.key,
    integrationStatus: ch.integrationStatus,
    connectKind: ch.connectKind,
    mode: ch.mode,
    hasFee: PAID_SITE_KEYS.has(ch.key),
    connectedAuthorized:
      card.facebookPage?.automationAuthorized === true ||
      card.instagramAccount?.automationAuthorized === true,
    feedAccepted:
      card.feed?.inFeed === true || card.partner?.status === "accepted",
    copilotSupported: copilotEnabled && isCopilotSupportedKey(ch.key),
  };
}

type ResolvedRow = {
  key: string;
  label: string;
  mode: PublishMode;
  bucket: PublishBucket;
  automationAction?: "authorize" | "revoke" | null;
  /** URL of this channel's `live` listing_posts row (hand-posted or worker-posted), or null. */
  liveProofUrl?: string | null;
  /** URLs of this channel's non-live rows; a run item pointing at one is stale (S692). */
  retiredProofUrls?: readonly string[];
};

type InstantDestination = {
  key: string;
  label: string;
};

function ChannelAutomationAction({
  propertyId,
  row,
}: {
  propertyId: string;
  row: ResolvedRow;
}) {
  if (row.automationAction === "authorize") {
    return (
      <form action={authorizeChannelAutomation} className="mt-1.5">
        <input type="hidden" name="property_id" value={propertyId} />
        <input type="hidden" name="channel" value={row.key} />
        <p className="mb-1 text-[11px] leading-relaxed text-amber-800">
          Allow us to post this listing to this account. You approve every
          site before anything goes out.
        </p>
        <button
          type="submit"
          className="rounded-lg bg-amber-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-amber-700"
        >
          Allow us to post
        </button>
      </form>
    );
  }
  if (row.automationAction === "revoke") {
    return (
      <form action={revokeChannelAutomation} className="mt-1.5">
        <input type="hidden" name="property_id" value={propertyId} />
        <input type="hidden" name="channel" value={row.key} />
        <p className="mb-1 text-[11px] leading-relaxed text-gray-500">
          We can post to this account. Turn that off and stay signed in.
        </p>
        <button
          type="submit"
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50"
        >
          Turn off auto-post
        </button>
      </form>
    );
  }
  return null;
}

function ChannelRow({
  row,
  propertyId,
  wizardEnabled = false,
  live = null,
}: {
  row: ResolvedRow;
  propertyId?: string;
  wizardEnabled?: boolean;
  /** S692: the one live rule (forYouLiveState) for this row, so the rail never
   *  says "Sign in + post" about a site whose ad link is already saved. */
  live?: { isLive: boolean; liveUrl: string | null } | null;
}) {
  const isLive = live?.isLive === true;
  const chip = isLive
    ? { label: "Live", cls: "bg-green-50 text-green-700" }
    : row.automationAction === "authorize"
      ? { label: "Needs you", cls: "bg-amber-50 text-amber-700" }
      : MODE_CHIP[row.mode];
  // S691: "Connect once" was a dead chip; it now opens the Connect sites
  // screen for this property. Every row shows what the site costs so a
  // first-time landlord can do the free ones first.
  const connectHref =
    row.mode === "needs_connection" && propertyId && wizardEnabled
      ? `/dashboard/link-portals?property=${encodeURIComponent(propertyId)}`
      : null;
  const costLine =
    isLive || row.key === "site" || row.key === "email" ? null : firstRunCostLine(row.key);
  return (
    <div className="py-1.5">
      <div className="flex items-center gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-sm">
          {CHANNEL_GLYPH[row.key] ?? "🏠"}
        </span>
        <span className="text-sm font-semibold text-gray-800">{row.label}</span>
        {isLive && live?.liveUrl ? (
          <a
            href={live.liveUrl}
            target="_blank"
            rel="noreferrer"
            className={`ml-auto rounded-full px-2.5 py-1 text-[11px] font-bold underline-offset-2 hover:underline ${chip.cls}`}
          >
            Live ↗
          </a>
        ) : connectHref ? (
          <a
            href={connectHref}
            className={`ml-auto rounded-full px-2.5 py-1 text-[11px] font-bold underline-offset-2 hover:underline ${chip.cls}`}
          >
            Connect →
          </a>
        ) : (
          <span
            className={`ml-auto rounded-full px-2.5 py-1 text-[11px] font-bold ${chip.cls}`}
          >
            {chip.label}
          </span>
        )}
      </div>
      {costLine ? (
        <p className="ml-10 text-[11px] leading-snug text-gray-500">{costLine}</p>
      ) : null}
      {propertyId && row.automationAction ? (
        <div className="ml-10">
          <ChannelAutomationAction propertyId={propertyId} row={row} />
        </div>
      ) : null}
    </div>
  );
}

function automationActionForCard(
  card: DistributeChannelCard,
): ResolvedRow["automationAction"] {
  if (card.channel.mode !== "api_automatic") return null;
  const account =
    card.channel.key === "facebook_feed"
      ? card.facebookPage
      : card.channel.key === "instagram"
        ? card.instagramAccount
        : null;
  if (!account?.enabled || account.accountStatus !== "connected") return null;
  return account.automationAuthorized === true ? "revoke" : "authorize";
}

export function PublishEverywhere({
  propertyId,
  basics,
  linkIsLive,
  setupOutstanding,
  canSetLive,
  channelCards,
  replyInputs,
  totalInquiryCount,
  conciergeDeskEnabled,
  conciergeUsage,
  copilotEnabled = false,
  stepClarityLiveEnabled = false,
  runItems = [],
  postingBlocker = null,
  wizardEnabled = false,
}: {
  propertyId: string;
  basics: GetOnlineBasics;
  linkIsLive: boolean;
  setupOutstanding: number;
  canSetLive: boolean;
  channelCards: DistributeChannelCard[];
  replyInputs: ReplyInputs;
  totalInquiryCount: number;
  conciergeDeskEnabled: boolean;
  conciergeUsage: { used: number; included: number };
  copilotEnabled?: boolean;
  stepClarityLiveEnabled?: boolean;
  runItems?: PublishEverywhereRunItem[];
  postingBlocker?: PublishEverywherePostingBlocker | null;
  /** DISTRIBUTION_WIZARD_ENABLED: "Connect →" links to the wizard only when it is on. */
  wizardEnabled?: boolean;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmDestinations, setConfirmDestinations] = useState<
    InstantDestination[]
  >([]);
  const [confirmDestinationsLoading, setConfirmDestinationsLoading] =
    useState(false);
  const [confirmDestinationsError, setConfirmDestinationsError] = useState<
    string | null
  >(null);

  const addressLabel = basics.address || replyInputs.address || "this rental";
  const rentLabel =
    basics.rentCents != null
      ? `$${Math.round(basics.rentCents / 100).toLocaleString("en-CA")}/mo`
      : null;
  const publicLink = replyInputs.bookingUrl;

  // Resolve every channel once, then group + tally.
  const resolved: ResolvedRow[] = channelCards.map((card) => {
    const { mode, bucket } = resolvePublishMode(
      toPublishInput(card, copilotEnabled),
    );
    return {
      key: card.channel.key,
      label: card.channel.label,
      mode,
      bucket,
      automationAction: automationActionForCard(card),
      liveProofUrl: liveProofUrlFromPosts(card.posts),
      retiredProofUrls: retiredProofUrlsFromPosts(card.posts),
    };
  });
  const reach = summarizeReach(resolved.map((r) => r.bucket), true);
  const byBucket = (b: PublishBucket) => resolved.filter((r) => r.bucket === b);
  const instantRows = byBucket("instant");
  const instantDestinationsFromRows = instantRows.map(({ key, label }) => ({
    key,
    label,
  }));
  // S691: free sites first, in every list a first-time landlord reads.
  const freeFirst = (rows: ResolvedRow[]) =>
    [...rows].sort((a, b) => Number(firstRunIsFree(b.key)) - Number(firstRunIsFree(a.key)));
  const forYou = freeFirst(byBucket("for_you"));
  const setupRows = freeFirst(
    resolved.filter(
      (r) => r.mode === "needs_connection" || r.mode === "brokerage_gated",
    ),
  );
  const comingSoonRows = resolved.filter((r) => r.mode === "planned");
  const runItemByChannel = new Map(runItems.map((item) => [item.channel, item]));
  // S691: one live rule for the whole page (lib/publish-everywhere.ts). A site
  // posted by hand has a live listing_posts row and no run item; it is live.
  const liveStateFor = (row: ResolvedRow) =>
    forYouLiveState({
      runItem: runItemByChannel.get(row.key) ?? null,
      liveProofUrl: row.liveProofUrl ?? null,
      retiredUrls: row.retiredProofUrls ?? [],
    });
  const forYouIsLive = (row: ResolvedRow) => liveStateFor(row).isLive;
  const forYouNeedsOperatorStep = (row: ResolvedRow) => {
    // Live first: a hand-posted site has a live listing row and no run item.
    if (forYouIsLive(row)) return false;
    const item = runItemByChannel.get(row.key);
    if (item == null) return true;
    return !(
      item.mode === "concierge" &&
      (item.publishStatus === "queued" ||
        item.publishStatus === "submitting" ||
        item.publishStatus === "submitted")
    );
  };
  const firstOutstandingForYou =
    forYou.find((row) => forYouNeedsOperatorStep(row)) ?? null;
  const liveForYouAllSet =
    stepClarityLiveEnabled && linkIsLive && firstOutstandingForYou == null;
  const proofSavedCount = channelCards.filter(
    (card) => card.status.value === "posted",
  ).length;
  const onlineHeadline =
    proofSavedCount > 0
      ? `Live on ${proofSavedCount} ${
          proofSavedCount === 1 ? "site" : "sites"
        }.`
      : "Your Vacantless page is live.";

  const publishBlockedByBasics = setupOutstanding > 0;
  const canPublish =
    !postingBlocker && !publishBlockedByBasics && canSetLive;

  async function openConfirm() {
    setConfirmDestinations(instantDestinationsFromRows);
    setConfirmDestinationsError(null);
    setConfirmOpen(true);
    setConfirmDestinationsLoading(true);
    try {
      setConfirmDestinations(await readInstantPublishDestinations(propertyId));
    } catch {
      setConfirmDestinationsError(
        "We could not read your account list. Close this and try again.",
      );
    } finally {
      setConfirmDestinationsLoading(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
      {/* Left: listing summary + the one-click hero. */}
      <div className="space-y-5">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold ${
              linkIsLive
                ? "bg-green-50 text-green-700"
                : "bg-green-50 text-green-700"
            }`}
          >
            {linkIsLive ? "✓ You're online" : "✓ Ready to post"}
          </span>
          <h3 className="mt-2 text-xl font-semibold tracking-tight text-gray-950">
            {addressLabel}
          </h3>
          <div className="mt-1 flex flex-wrap gap-3 text-sm font-medium text-gray-600">
            {basics.beds != null && <span>🛏 {basics.beds} Bed</span>}
            {basics.baths != null && <span>🛁 {basics.baths} Bath</span>}
            {basics.sqft != null && (
              <span>📐 {basics.sqft.toLocaleString("en-CA")} sqft</span>
            )}
            {rentLabel && <span>{rentLabel}</span>}
          </div>
        </div>

        {linkIsLive ? (
          stepClarityLiveEnabled ? (
            <section className="rounded-2xl border border-green-200 bg-green-50 p-6 shadow-sm">
              <span className="rounded-full bg-green-600 px-2.5 py-0.5 text-xs font-semibold text-white">
                You&apos;re online
              </span>
              <h3 className="mt-3 text-2xl font-semibold text-green-950">
                {onlineHeadline}
              </h3>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-green-800">
                Your Vacantless page is live. Finish any site that still needs
                you.{" "}
                {totalInquiryCount}{" "}
                {totalInquiryCount === 1 ? "inquiry" : "inquiries"} tied to
                this rental so far.
              </p>

              <div className="mt-4 rounded-2xl border border-green-200 bg-white px-4 py-3">
                <p className="text-[11px] font-extrabold uppercase tracking-wide text-green-700">
                  Your next step
                </p>
                {postingBlocker ? (
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h4 className="text-base font-semibold text-green-950">
                        {postingBlocker.title}
                      </h4>
                      <p className="mt-0.5 text-sm text-green-800">
                        {postingBlocker.detail}
                      </p>
                    </div>
                    <a
                      href={postingBlocker.href}
                      className="inline-flex items-center gap-1 rounded-xl bg-amber-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-800"
                    >
                      {postingBlocker.action}
                    </a>
                  </div>
                ) : firstOutstandingForYou ? (
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h4 className="text-base font-semibold text-green-950">
                        Finish {firstOutstandingForYou.label}
                      </h4>
                      <p className="mt-0.5 text-sm text-green-800">
                        Sign in and post. Vacantless fills the ad; you handle
                        only the site&apos;s sign-in or fee step.
                      </p>
                    </div>
                    <a
                      href={`#for-you-${firstOutstandingForYou.key}`}
                      className="inline-flex items-center gap-1 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
                    >
                      Finish {firstOutstandingForYou.label} →
                    </a>
                  </div>
                ) : (
                  <div className="mt-1">
                    <h4 className="text-base font-semibold text-green-950">
                      You&apos;re all set
                    </h4>
                    <p className="mt-0.5 text-sm text-green-800">
                      Post again only when the listing changes.
                    </p>
                  </div>
                )}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                {publicLink && <CopyLink url={publicLink} />}
                {!postingBlocker && (
                  <button
                    type="button"
                    onClick={openConfirm}
                    className="inline-flex items-center gap-2 rounded-xl border border-green-300 bg-white px-4 py-2.5 text-sm font-semibold text-green-800 hover:bg-green-100"
                  >
                    <Icons.bolt className="h-4 w-4" />
                    Post the changes
                  </button>
                )}
              </div>
            </section>
          ) : (
          <section className="rounded-2xl border border-green-200 bg-green-50 p-6 shadow-sm">
            <span className="rounded-full bg-green-600 px-2.5 py-0.5 text-xs font-semibold text-white">
              You&apos;re online
            </span>
            <h3 className="mt-3 text-2xl font-semibold text-green-950">
              {onlineHeadline}
            </h3>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-green-800">
              Your Vacantless page is live. Any site that needs you shows its
              next step below.{" "}
              {totalInquiryCount}{" "}
              {totalInquiryCount === 1 ? "inquiry" : "inquiries"} tied to this
              rental so far.
            </p>
            {publicLink && (
              <div className="mt-4">
                <CopyLink url={publicLink} />
              </div>
            )}
            {!postingBlocker && (
              <button
                type="button"
                onClick={openConfirm}
                className="mt-4 inline-flex items-center gap-2 rounded-xl border border-green-300 bg-white px-4 py-2.5 text-sm font-semibold text-green-800 hover:bg-green-100"
              >
                <Icons.bolt className="h-4 w-4" />
                Post the changes
              </button>
            )}
          </section>
          )
        ) : (
          <section className="relative overflow-hidden rounded-2xl border border-emerald-900 bg-gradient-to-b from-emerald-900 to-emerald-950 p-7 text-center text-white shadow-sm">
            <div className="mx-auto mb-5 grid max-w-2xl gap-2 text-left sm:grid-cols-3">
              <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3">
                <span className="mb-2 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-300 text-xs font-black text-emerald-950">
                  1
                </span>
                <b className="block text-[12.5px] text-emerald-50">
                  Press Post
                </b>
                <small className="text-[11px] text-emerald-200">
                  Your Vacantless page and your sites turn on.
                </small>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3">
                <span className="mb-2 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-300 text-xs font-black text-emerald-950">
                  2
                </span>
                <b className="block text-[12.5px] text-emerald-50">
                  Sign in if asked
                </b>
                <small className="text-[11px] text-emerald-200">
                  We fill the ad. You sign in and pay any site fee.
                </small>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3">
                <span className="mb-2 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-300 text-xs font-black text-emerald-950">
                  3
                </span>
                <b className="block text-[12.5px] text-emerald-50">
                  Confirm the live link
                </b>
                <small className="text-[11px] text-emerald-200">
                  A site counts as Live after the link to your ad is saved.
                </small>
              </div>
            </div>

            {canPublish ? (
              <button
                type="button"
                onClick={openConfirm}
                className="mx-auto flex w-full max-w-md flex-col items-center gap-0.5 rounded-2xl bg-gradient-to-b from-green-400 to-green-600 px-6 py-4 text-lg font-black text-emerald-950 shadow-lg transition hover:-translate-y-0.5"
              >
                <span className="inline-flex items-center gap-2">
                  <Icons.bolt className="h-5 w-5" />
                  Post everywhere
                </span>
                <small className="text-[12.5px] font-semibold opacity-80">
                  Then follow the short sign-in or fee list
                </small>
              </button>
            ) : postingBlocker ? (
              <div className="mx-auto max-w-md rounded-xl border border-amber-200 bg-white/95 px-4 py-3 text-left">
                <p className="text-sm font-semibold text-amber-950">
                  {postingBlocker.title}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-amber-900">
                  {postingBlocker.detail}
                </p>
                <a
                  href={postingBlocker.href}
                  className="mt-2 inline-flex rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-50"
                >
                  {postingBlocker.action}
                </a>
              </div>
            ) : publishBlockedByBasics ? (
              <div className="mx-auto max-w-md rounded-xl border border-amber-200 bg-white/95 px-4 py-3 text-left">
                <p className="text-sm font-semibold text-amber-950">
                  Finish {setupOutstanding}{" "}
                  {setupOutstanding === 1 ? "answer" : "answers"}{" "}
                  first.
                </p>
                <a
                  href="#rental-details"
                  className="mt-2 inline-flex rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-50"
                >
                  Review listing
                </a>
              </div>
            ) : (
              <div className="mx-auto max-w-md rounded-xl border border-amber-200 bg-white/95 px-4 py-3 text-left">
                <p className="text-sm font-semibold text-amber-950">
                  Review the listing status before this rental can go online.
                </p>
                <a
                  href="#rental-details"
                  className="mt-2 inline-flex rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-50"
                >
                  Review listing
                </a>
              </div>
            )}
            <p className="mt-3 text-[12.5px] text-emerald-200">
              You approve every post. You pay a site only if it asks.
            </p>
          </section>
        )}

        {/* Slice 3: the real for-you handoff. Only with the flag on AND at least
            one co-pilot channel resolved; reuses the existing sidecar +
            requestConciergePublish, so with the flag off nothing new renders. */}
        {copilotEnabled && forYou.length > 0 && (
          <ForYouHandoff
            propertyId={propertyId}
            addressLabel={addressLabel}
            rows={forYou}
            runItems={runItems}
            linkIsLive={linkIsLive}
            conciergeDeskEnabled={conciergeDeskEnabled}
            allSetSummary={liveForYouAllSet}
            postingBlocker={postingBlocker}
          />
        )}
      </div>

      {/* Right: connected channels first, unavailable channels last. */}
      <aside className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-4 border-b border-gray-100 pb-4">
          <div className="text-3xl font-black leading-none tracking-tight text-green-700">
            {reach.included}
            <span className="mt-1 block text-[10px] font-extrabold uppercase tracking-wider text-gray-500">
              Included now
            </span>
          </div>
          <div>
            <div className="mb-1.5 text-[13px] font-bold text-gray-800">
              What happens
            </div>
            <div className="flex flex-wrap gap-1.5">
              <span className="rounded-full bg-green-50 px-2.5 py-1 text-[11px] font-bold text-green-700">
                {reach.instant} connected
              </span>
              <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-bold text-indigo-700">
                {forYou.filter((r) => forYouNeedsOperatorStep(r)).length} need sign-in
              </span>
              <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-bold text-gray-600">
                {setupRows.length + comingSoonRows.length} later
              </span>
            </div>
          </div>
        </div>

        {/* Instant bucket leads with the two always-on destinations. */}
        <div className="mb-3.5">
          <BucketLabel bucket="instant" />
          <ChannelRow
            row={{
              key: "site",
              label: "Vacantless page",
              mode: "instant_auto",
              bucket: "instant",
            }}
          />
          <ChannelRow
            row={{
              key: "email",
              label: "Email alerts",
              mode: "instant_auto",
              bucket: "instant",
            }}
          />
          {instantRows.map((r) => (
            <ChannelRow key={r.key} row={r} propertyId={propertyId} live={liveStateFor(r)} />
          ))}
        </div>

        {forYou.length > 0 && (
          <div className="mb-3.5">
            <BucketLabel bucket="for_you" />
            {stepClarityLiveEnabled && linkIsLive && (
              <p className="mb-1.5 text-[11px] leading-relaxed text-gray-500">
                {firstOutstandingForYou
                  ? "Same sites as “Post to these sites”; actions stay on the left."
                  : "Your live sites are listed here; nothing more to do."}
              </p>
            )}
            {forYou.map((r) => (
              <ChannelRow key={r.key} row={r} propertyId={propertyId} live={liveStateFor(r)} />
            ))}
          </div>
        )}

        {setupRows.length > 0 && (
          <div className="mb-3.5">
            <BucketLabel bucket="after_setup" />
            {setupRows.map((r) => (
              <ChannelRow
                key={r.key}
                row={r}
                propertyId={propertyId}
                wizardEnabled={wizardEnabled}
              />
            ))}
          </div>
        )}

        {comingSoonRows.length > 0 && (
          <div className="mb-3.5">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-wide text-gray-700">
              <span className="h-2 w-2 rounded-full bg-gray-300" />
              Coming soon
            </div>
            {comingSoonRows.map((r) => (
              <ChannelRow key={r.key} row={r} propertyId={propertyId} />
            ))}
          </div>
        )}

        <div className="mt-2 border-t border-gray-100 pt-3 text-[11.5px] leading-relaxed text-gray-500">
          <b className="text-gray-700">Ready</b> means we post it when you press
          Post. It shows Live once the link to your ad comes back.
          <br />
          <b className="text-gray-700">Needs you</b> means we fill the ad. You
          sign in, pay any fee, and press post.
          <br />
          <b className="text-gray-700">Not yet</b> means this site comes later.
        </div>
      </aside>

      {confirmOpen && (
          <ConfirmModal
            propertyId={propertyId}
            addressLabel={addressLabel}
            instantDestinations={confirmDestinations}
            instantDestinationsLoading={confirmDestinationsLoading}
            instantDestinationsError={confirmDestinationsError}
            forYouRows={forYou}
            conciergeDeskEnabled={conciergeDeskEnabled}
          conciergeUsage={conciergeUsage}
          onClose={() => setConfirmOpen(false)}
        />
      )}
    </div>
  );
}

function BucketLabel({ bucket }: { bucket: PublishBucket }) {
  const meta = BUCKET_META[bucket];
  return (
    <div className="mb-2 flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-wide text-gray-700">
      <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
      {meta.title}
      {meta.note && (
        <span className="text-[10.5px] font-semibold normal-case tracking-normal text-gray-400">
          {meta.note}
        </span>
      )}
    </div>
  );
}

// Slice 3 for-you handoff. Each co-pilot channel maps to its live distribution
// run item (created by publishProperty). Ready -> the honest two-tier choice:
//   • "Open posting step" opens the EXISTING co-pilot sidecar; the extension
//     co-locates the auto-fill on the portal page. The landlord signs in, covers
//     any site fee, taps post — we never post, log in, or pay for them.
//   • "Have us post it" hands the SAME item to the publishing desk via the
//     EXISTING requestConciergePublish (which spends one plan allowance when the
//     desk is enabled and records real live-ad proof before marking it live).
// Paid sites additionally disclose the paid-DIRECT fee. No run yet -> a hint to
// publish first. Live/queued -> reflect the recorded state.
function ForYouHandoff({
  propertyId,
  addressLabel,
  rows,
  runItems,
  linkIsLive,
  conciergeDeskEnabled,
  allSetSummary,
  postingBlocker,
}: {
  propertyId: string;
  addressLabel: string;
  rows: ResolvedRow[];
  runItems: PublishEverywhereRunItem[];
  linkIsLive: boolean;
  conciergeDeskEnabled: boolean;
  allSetSummary: boolean;
  postingBlocker?: PublishEverywherePostingBlocker | null;
}) {
  const itemByChannel = new Map(runItems.map((it) => [it.channel, it]));
  return (
    <section className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="text-lg">🤝</span>
        <h3 className="text-base font-semibold tracking-tight text-indigo-950">
          {postingBlocker
            ? "Finish your listing first"
            : allSetSummary
              ? "Your ads are live"
              : "Post to these sites"}
        </h3>
      </div>
      <p className="mt-1 text-[12.5px] leading-relaxed text-indigo-900/80">
        {postingBlocker
          ? "Posting to rental sites opens once your listing has the details every site needs."
          : allSetSummary
          ? "The link to each ad is saved here. Reopen a site only when you change the listing."
          : "We fill the ad. You sign in and pay if the site asks. Then save the link to your ad here."}
      </p>
      {postingBlocker && (
        <a
          href={postingBlocker.href}
          className="mt-3 inline-flex rounded-lg bg-amber-700 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-800"
        >
          {postingBlocker.action}
        </a>
      )}
      <ul className="mt-3 space-y-2.5">
        {rows.map((row) => (
          <ForYouRow
            key={row.key}
            row={row}
            item={itemByChannel.get(row.key) ?? null}
            propertyId={propertyId}
            addressLabel={addressLabel}
            linkIsLive={linkIsLive}
            conciergeDeskEnabled={conciergeDeskEnabled}
            postingBlocked={Boolean(postingBlocker)}
          />
        ))}
      </ul>
      {conciergeDeskEnabled && !postingBlocker && (
        <p className="mt-3 text-[11px] leading-relaxed text-gray-500">
          “Have us post it” uses one of your paid posts. We save the link to
          your ad before it shows as Live.
        </p>
      )}
    </section>
  );
}

// One for-you channel row. Owns the approval-modal open state. Its render adapts
// to the run item's live/gate state: the worker (S553/S631) moves a handed-off
// concierge item to a gate, and this row surfaces that gate as the right action —
// a branded one-tap "Approve & publish" for the ready/payment gates, a re-connect
// for the login gate, and "we're posting it" while the worker is mid-flight. No
// gate is ever a dead end.
function ForYouRow({
  row,
  item,
  propertyId,
  addressLabel,
  linkIsLive,
  conciergeDeskEnabled,
  postingBlocked,
}: {
  row: ResolvedRow;
  item: PublishEverywhereRunItem | null;
  propertyId: string;
  addressLabel: string;
  linkIsLive: boolean;
  conciergeDeskEnabled: boolean;
  postingBlocked?: boolean;
}) {
  const [approveOpen, setApproveOpen] = useState(false);
  const paid = row.mode === "paid_optin";
  const { isLive, liveUrl } = forYouLiveState({
    runItem: item,
    liveProofUrl: row.liveProofUrl ?? null,
    retiredUrls: row.retiredProofUrls ?? [],
  });
  const gate =
    item != null && item.mode === "concierge" ? item.publishStatus : null;
  // needs_operator (free channel, prepared) + needs_payment (paid site, prepared
  // pending the fee) both collapse to one branded "Approve & publish" tap.
  const needsApproval =
    !isLive && (gate === "needs_operator" || gate === "needs_payment");
  // needs_login can't be approved — it needs a re-connect, so route to posting assist.
  const needsConnect = !isLive && gate === "needs_login";
  const working =
    !isLive &&
    (gate === "queued" || gate === "submitting" || gate === "submitted");

  const stateChip = isLive
    ? { label: "Live", cls: "bg-green-50 text-green-700" }
    : postingBlocked
      ? { label: "Waiting", cls: "bg-amber-50 text-amber-700" }
    : needsApproval
      ? { label: "Ready. Approve it", cls: "bg-emerald-50 text-emerald-700" }
      : needsConnect
        ? { label: "Sign-in needed", cls: "bg-amber-50 text-amber-700" }
        : working
          ? { label: "We're posting it", cls: "bg-amber-50 text-amber-700" }
          : paid
            ? { label: "Sign in + fee", cls: "bg-indigo-50 text-indigo-700" }
            : { label: "Sign in + post", cls: "bg-indigo-50 text-indigo-700" };

  return (
    <li
      id={`for-you-${row.key}`}
      className="rounded-xl border border-indigo-100 bg-white p-3"
    >
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gray-100 text-xs">
          {CHANNEL_GLYPH[row.key] ?? "🏠"}
        </span>
        <span className="text-sm font-semibold text-gray-800">{row.label}</span>
        <span
          className={`ml-auto rounded-full px-2.5 py-1 text-[11px] font-bold ${stateChip.cls}`}
        >
          {stateChip.label}
        </span>
      </div>
      {!isLive && firstRunCostLine(row.key) ? (
        <p className="mt-1 text-[11px] leading-snug text-gray-500">{firstRunCostLine(row.key)}</p>
      ) : null}

      {paid && !isLive && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-gray-500">
          {PAID_SITE_LABEL[row.key] ?? "This site"} charges its own fee. You
          approve it here and pay the site with your own card.
        </p>
      )}

      {postingBlocked && !isLive ? (
        <p className="mt-2 text-[12px] leading-relaxed text-indigo-900/70">
          Finish your listing first. Sign-in and any site fee come after the
          details are complete.
        </p>
      ) : isLive ? (
        liveUrl ? (
          <a
            href={liveUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-semibold text-green-700 hover:underline"
          >
            View live ad ↗
          </a>
        ) : (
          <p className="mt-2 text-[12px] font-semibold text-green-700">Live.</p>
        )
      ) : item == null ? (
        linkIsLive ? (
          <form
            action={openGuidedPosting}
            className="mt-2 flex flex-wrap items-center gap-2"
          >
            <input type="hidden" name="property_id" value={propertyId} />
            <input type="hidden" name="channel" value={row.key} />
            <button
              type="submit"
              className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-indigo-700"
            >
              Open this site →
            </button>
          </form>
        ) : (
          <p className="mt-2 text-[12px] text-gray-500">
            Post first, then come back to this step.
          </p>
        )
      ) : needsApproval ? (
        <div className="mt-2">
          <p className="text-[12px] text-emerald-800">
            Your ad is ready. Approve it to post
            {paid ? " and cover the fee" : ""}.
          </p>
          <button
            type="button"
            onClick={() => setApproveOpen(true)}
            className="mt-1.5 inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-emerald-700"
          >
            Approve and post →
          </button>
        </div>
      ) : needsConnect ? (
        <form
          action={openGuidedPosting}
          className="mt-2 flex flex-wrap items-center gap-2"
        >
          <input type="hidden" name="property_id" value={propertyId} />
          <input type="hidden" name="channel" value={row.key} />
          <button
            type="submit"
            className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-indigo-700"
          >
            Sign in and continue →
          </button>
          <span className="text-[11px] text-gray-500">
            A quick one-time sign-in, then we finish it.
          </span>
        </form>
      ) : working ? (
        <p className="mt-2 text-[12px] text-amber-800">
          We&apos;re posting this now and will bring back the live link here.
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <a
            href={`/dashboard/properties/${propertyId}/copilot/${item.id}`}
            className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-indigo-700"
          >
            Open this site →
          </a>
          {conciergeDeskEnabled && item.canConcierge && (
            <form action={requestConciergePublish}>
              <input type="hidden" name="property_id" value={propertyId} />
              <input type="hidden" name="item_id" value={item.id} />
              <button
                type="submit"
                className="inline-flex items-center gap-1 rounded-lg border border-indigo-300 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-indigo-700 hover:bg-indigo-50"
              >
                Have us post it
              </button>
            </form>
          )}
        </div>
      )}

      {approveOpen && item != null && (
        <ApprovalModal
          propertyId={propertyId}
          itemId={item.id}
          channelLabel={row.label}
          addressLabel={addressLabel}
          paid={paid}
          siteLabel={PAID_SITE_LABEL[row.key] ?? row.label}
          onClose={() => setApproveOpen(false)}
        />
      )}
    </li>
  );
}

// The branded one-tap approval that turns a prepared concierge post into a live
// ad. Paid sites require standing spend authorization on the org/channel account
// row before this action will approve the prepared post. Posts through the
// EXISTING authorizeAutopilotSubmit; nothing is posted or charged before this
// tap, and a real live-ad link is recorded before Live.
function ApprovalModal({
  propertyId,
  itemId,
  channelLabel,
  addressLabel,
  paid,
  siteLabel,
  onClose,
}: {
  propertyId: string;
  itemId: string;
  channelLabel: string;
  addressLabel: string;
  paid: boolean;
  siteLabel: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700">
          Ready to post
        </span>
        <h3 className="mt-2 text-lg font-semibold tracking-tight text-gray-950">
          Post to {channelLabel}
        </h3>
        <p className="mt-1 text-sm text-gray-600">
          Your {addressLabel} ad is ready for {channelLabel}. Approve it once.
          The link to your ad comes back here.
        </p>

        {paid && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-[12.5px] leading-relaxed text-amber-950">
            {siteLabel} charges its own fee. You pay {siteLabel} with the card
            you keep there.
          </div>
        )}

        <form action={authorizeAutopilotSubmit} className="mt-4 flex gap-2.5">
          <input type="hidden" name="property_id" value={propertyId} />
          <input type="hidden" name="item_id" value={itemId} />
          <button
            type="submit"
            className="flex-1 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700"
          >
            {paid ? "Approve the post" : "Approve and post"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
        </form>
        <p className="mt-3 text-center text-[11px] text-gray-400">
          You approve every post. We save the link to your ad before it shows
          as Live.
        </p>
      </div>
    </div>
  );
}

// The mandatory preflight gate: nothing posts before the operator sees this.
// The primary action is the EXISTING publishProperty server action (page-live +
// current authorized-instant autofire) — identical to the old Simple hero. The
// for-you handoff itself happens after publish, in ForYouHandoff above.
function ConfirmModal({
  propertyId,
  addressLabel,
  instantDestinations,
  instantDestinationsLoading,
  instantDestinationsError,
  forYouRows,
  conciergeDeskEnabled,
  conciergeUsage,
  onClose,
}: {
  propertyId: string;
  addressLabel: string;
  instantDestinations: InstantDestination[];
  instantDestinationsLoading: boolean;
  instantDestinationsError: string | null;
  forYouRows: ResolvedRow[];
  conciergeDeskEnabled: boolean;
  conciergeUsage: { used: number; included: number };
  onClose: () => void;
}) {
  const preflight = derivePublishPreflight(forYouRows);
  const instantCount = instantDestinations.length + 2;
  const signInText =
    preflight.signInNeeded.length === 1
      ? "1 site needs sign-in"
      : `${preflight.signInNeeded.length} sites need sign-in`;
  const feeText =
    preflight.feeChannels.length === 0
      ? "no site fees now"
      : preflight.feeChannels.length === 1
        ? "1 site may ask for a fee"
        : `${preflight.feeChannels.length} sites may ask for a fee`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-h-[92vh] w-full max-w-md overflow-auto rounded-2xl bg-white p-6 shadow-2xl">
        <h3 className="text-lg font-semibold tracking-tight text-gray-950">
          Post {addressLabel}
        </h3>
        <p className="mt-1 text-sm text-gray-500">
          {instantCount} sites turn on now · {signInText} · {feeText}.
        </p>
        <p className="mt-1 text-xs text-gray-400">
          You approve every post. You pay a site only if it asks.
        </p>

        <div className="my-3.5 rounded-xl border border-gray-200 px-3">
          <div className="flex items-center gap-2 border-b border-gray-100 py-2.5 text-[13px]">
            🌐 Vacantless page
            <span className="ml-auto text-[10px] font-black tracking-wide text-green-700">
              Instant
            </span>
          </div>
          <div className="flex items-center gap-2 border-b border-gray-100 py-2.5 text-[13px]">
            ✉️ Email alerts
            <span className="ml-auto text-[10px] font-black tracking-wide text-green-700">
              Instant
            </span>
          </div>
          {instantDestinationsLoading ? (
            <div className="border-b border-gray-100 py-2.5 text-[13px] text-gray-600">
              Refreshing connected accounts...
            </div>
          ) : instantDestinations.length > 0 ? (
            instantDestinations.map((r) => (
              <div
                key={r.key}
                className="flex items-center gap-2 border-b border-gray-100 py-2.5 text-[13px]"
              >
                {CHANNEL_GLYPH[r.key] ?? "🏠"} {r.label}
                <span className="ml-auto text-[10px] font-black tracking-wide text-green-700">
                  Instant
                </span>
              </div>
            ))
          ) : (
            <div className="border-b border-gray-100 py-2.5 text-[13px] text-gray-600">
              No site posts yet.
            </div>
          )}
        </div>

        {instantDestinationsError && (
          <p className="my-3.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-[12.5px] leading-relaxed text-amber-950">
            {instantDestinationsError}
          </p>
        )}

        {preflight.signInNeeded.length > 0 && (
          <div className="my-3.5 rounded-xl border border-indigo-100 bg-indigo-50 px-3.5 py-3">
            <p className="text-[12.5px] font-semibold text-indigo-950">
              Quick sign-in
            </p>
            <div className="mt-2 space-y-1.5">
              {preflight.signInNeeded.map((row) => (
                <div
                  key={row.key}
                  className="flex items-center gap-2 text-[13px] text-indigo-950"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white text-xs">
                    {CHANNEL_GLYPH[row.key] ?? "🏠"}
                  </span>
                  <span className="font-semibold">{row.label}</span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11.5px] leading-relaxed text-indigo-900/80">
              We fill the post; you sign in and tap post. We never see your
              password.
            </p>
          </div>
        )}

        {preflight.feeChannels.length > 0 && (
          <div className="my-3.5 rounded-xl border border-gray-200 px-3.5 py-3">
            <div className="flex items-center justify-between gap-3 text-[12.5px] text-gray-700">
              <span>Site fees</span>
              <span className="text-right font-semibold text-gray-950">
                Paid on the site
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {preflight.feeChannels.map((row) => (
                <div
                  key={row.key}
                  className="flex items-start gap-2 rounded-lg border border-gray-200 px-3 py-2 text-[12.5px] text-gray-700"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gray-50 text-xs">
                    {CHANNEL_GLYPH[row.key] ?? "🏠"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-gray-900">
                      {row.label}
                    </span>
                    <span className="block text-xs text-gray-500">
                      {row.feeLabel} · you add it after this
                    </span>
                  </span>
                </div>
              ))}
              <p className="text-[11.5px] leading-relaxed text-gray-500">
                You add and pay these sites yourself, with your own card,
                after this step.
              </p>
            </div>
          </div>
        )}

        {conciergeDeskEnabled && (
          <div className="my-3.5 flex items-center gap-2.5 rounded-xl bg-green-50 px-3.5 py-3 text-[13px] text-gray-700">
            <span className="text-lg">✅</span>
            <span>{conciergeUsageLabel(conciergeUsage)}.</span>
          </div>
        )}

        <form action={publishProperty} className="mt-4 flex gap-2.5">
          <input type="hidden" name="id" value={propertyId} />
          <button
            type="submit"
            disabled={
              instantDestinationsLoading || Boolean(instantDestinationsError)
            }
            className="flex-1 rounded-xl bg-gradient-to-b from-green-400 to-green-600 px-4 py-3 text-sm font-black text-emerald-950 hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Post everywhere
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
        </form>

        <p className="mt-3 text-center text-[11px] text-gray-400">
          After this, any site that needs you shows one button. Sign in, pay
          the site, then save the link.
        </p>
      </div>
    </div>
  );
}
