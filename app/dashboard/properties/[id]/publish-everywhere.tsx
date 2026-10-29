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

import { MarketplaceRow, type MarketplaceKitData } from "./marketplace-row";
import { BrokerageRequestCard, type BrokerageRequestCardData } from "./brokerage-request-card";
import type { AdPreview } from "@/lib/ad-preview";
import { useState } from "react";
import { Icons } from "@/components/icons";
import { CopyLink } from "./copy-link";
import { allowChannelAndPostNow, publishProperty, requestConciergePublish, startSitePost } from "../actions";
import { isRobotPostedChannel } from "@/lib/posting-lanes";
import {
  authorizeAutopilotSubmit,
  readInstantPublishDestinations,
  revokeChannelAutomation,
  stopAutopilotSubmit,
} from "../distribution-actions";
import {
  derivePublishPreflight,
  resolvePublishMode,
  isCopilotSupportedKey,
  forYouLiveState,
  liveProofUrlFromPosts,
  retiredProofUrlsFromPosts,
  type PublishMode,
  type PublishBucket,
  type PublishChannelInput,
} from "@/lib/publish-everywhere";
import {
  conciergeUsageLabel,
  POSTING_ADDON_HREF,
  POSTING_OFFER,
} from "@/lib/billing";
import { POSTING_OFFER_PROOF } from "@/lib/proof-stats";
import { channelByKey, firstRunCostLine, firstRunIsFree } from "@/lib/distribution-channels";
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
  /** S708: the paid site's checkout the robot stopped on (pay there with the CVV). */
  checkoutUrl?: string | null;
  /** S709: the pay instruction for checkoutUrl (Kijiji: My Ads > Activate Ad). */
  checkoutHint?: string | null;
  /** S713d: a step only the landlord can do on the site (Zumper renter account). */
  siteSetup?: { message: string; href: string; action: string } | null;
  /** S719 (KI1303): the landlord has clicked Approve for this item. */
  approved?: boolean;
  /** S724 (V251-36): photos the site turned down on a live ad. */
  photoNote?: string | null;
};

export type PublishEverywherePostingBlocker = {
  title: string;
  detail: string;
  href: string;
  action: string;
  /** S700 (dress rehearsal F12): every missing detail at once, each with its own link. */
  items?: { label: string; href: string }[];
};

// --- per-channel presentation (mode -> chip) -------------------------------
// One place maps a resolved mode to its user-facing chip. No new color system:
// green = instant, indigo = we-post-for-you, gray = after-setup (same tones the
// north-star and the rest of the tab already use).
const MODE_CHIP: Record<PublishMode, { label: string; cls: string }> = {
  instant_auto: { label: "Instant", cls: "bg-green-50 text-green-700" },
  copilot_fill: { label: "We post it", cls: "bg-indigo-50 text-indigo-700" },
  paid_optin: { label: "We post it. Site fee", cls: "bg-indigo-50 text-indigo-700" },
  needs_connection: { label: "Sign in first", cls: "bg-gray-100 text-gray-600" },
  brokerage_gated: { label: "Via brokerage", cls: "bg-gray-100 text-gray-600" },
  planned: { label: "Coming soon", cls: "bg-gray-100 text-gray-600" },
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
      // S700 (dress rehearsal F17): a rental being IN our own feed is not the
      // site accepting the feed. inFeed flips true the moment the rental goes
      // live, which turned Rentals.ca and Zumper "Instant" for every org with
      // no partner accepted (none has, as of 2026-10-05). Only acceptance counts.
      card.partner?.status === "accepted",
    copilotSupported: copilotEnabled && isCopilotSupportedKey(ch.key),
    robotReady: card.robotReady === true,
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
  /** S702w: an authorized robot site; we already hold the sign-in. */
  alreadySignedIn?: boolean;
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
    // S734: one click authorizes and posts (allowChannelAndPostNow). Before,
    // Allow set a flag and the landlord had to find Post everywhere after.
    return (
      <form action={allowChannelAndPostNow} className="mt-1.5">
        <input type="hidden" name="property_id" value={propertyId} />
        <input type="hidden" name="channel" value={row.key} />
        <p className="mb-1 text-[11px] leading-relaxed text-amber-800">
          Post this rental here now, and again each time you post your edits.
        </p>
        <button
          type="submit"
          className="rounded-lg bg-amber-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-amber-700"
        >
          Post it here now
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

// S734: one Posting offer for the three robot sites, shown once under the
// list, instead of "Part of the Posting add-on. $49 a month. See Billing" on
// every locked tile (three prices per tile read as "free site, but $49").
function PostingOfferCard() {
  return (
    <li
      id="posting-offer"
      className="rounded-xl border border-indigo-200 bg-white p-4 shadow-sm"
    >
      <p className="text-sm font-semibold text-gray-900">{POSTING_OFFER.title}</p>
      <p className="mt-1 text-[12.5px] leading-relaxed text-gray-600">{POSTING_OFFER.body}</p>
      <p className="mt-1 text-[12.5px] text-gray-900">
        <span className="font-semibold">{POSTING_OFFER.price}</span> {POSTING_OFFER.fees}
      </p>
      <p className="mt-1 text-[11.5px] text-gray-500">{POSTING_OFFER_PROOF}</p>
      <a
        href={POSTING_ADDON_HREF}
        className="mt-3 inline-flex rounded-lg bg-indigo-600 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-indigo-700"
      >
        {POSTING_OFFER.action} →
      </a>
    </li>
  );
}

const ADDON_CHIP = { label: "Posting add-on", cls: "bg-gray-100 text-gray-600" };

function ChannelRow({
  row,
  propertyId,
  wizardEnabled = false,
  live = null,
  addonLocked = false,
}: {
  row: ResolvedRow;
  propertyId?: string;
  wizardEnabled?: boolean;
  /** S713: a robot site and the org has no Posting add-on. */
  addonLocked?: boolean;
  /** S692: the one live rule (forYouLiveState) for this row, so the rail never
   *  says "Sign in + post" about a site whose ad link is already saved. */
  live?: { isLive: boolean; liveUrl: string | null } | null;
}) {
  const isLive = live?.isLive === true;
  const locked = addonLocked && !isLive;
  const chip = isLive
    ? { label: "Live", cls: "bg-green-50 text-green-700" }
    : locked
      ? ADDON_CHIP
    : row.automationAction === "authorize"
      ? { label: "Needs your OK", cls: "bg-amber-50 text-amber-700" }
      : MODE_CHIP[row.mode];
  // S691: "Connect once" was a dead chip; it now opens the Connect sites
  // screen for this property. Every row shows what the site costs so a
  // first-time landlord can do the free ones first.
  // S705: a Facebook Page or Instagram row connects in Settings (where the
  // Connect / Disconnect controls live) and says "Connect", not "Sign in once".
  const isMetaRow = row.key === "facebook_feed" || row.key === "instagram";
  // S734: a connected Page that only needs "Allow us to post" showed the
  // "Connect" link again; it now shows "Needs your OK" over the Allow button.
  const connectHref =
    row.mode !== "needs_connection" || locked || row.automationAction === "authorize"
      ? null
      : isMetaRow
        ? "/dashboard/settings?tab=distribution#facebook-page"
        : propertyId && wizardEnabled
          ? `/dashboard/link-portals?property=${encodeURIComponent(propertyId)}`
          : null;
  const connectLabel = isMetaRow ? "Connect →" : "Sign in once →";
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
            {connectLabel}
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
  shownChannelKeys = null,
  marketplaceKit = null,
  brokerage = null,
  robotPostingAllowed = false,
  capNotes = {},
  adPreview = null,
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
  /**
   * SHOW_ONLY_PROVEN_CHANNELS: the channels that have actually placed an ad for
   * a customer (lib/channel-provenness). DISPLAY ONLY. Null means the rule is
   * off or could not be measured, and every channel renders as before.
   *
   * Filtering here and not at the source is deliberate: a landlord who has
   * already connected a site must still be able to post to it, and connecting
   * is how a channel earns its evidence in the first place. This hides what we
   * cannot yet stand behind; it removes nobody's account and no posting path.
   */
  shownChannelKeys?: readonly string[] | null;
  /** S712: the Facebook Marketplace kit (every org posts it from its own team). */
  marketplaceKit?: MarketplaceKitData | null;
  /** S735: Realtor.ca through a partner agent (a request a person answers, never a tile). */
  brokerage?: BrokerageRequestCardData | null;
  /** S713: canUseRobotPosting. False = Kijiji, Rentals.ca and Zumper show the add-on note. */
  robotPostingAllowed?: boolean;
  /** S723: per-site warning shown in the approval box (Rentals.ca free cap). */
  capNotes?: Readonly<Record<string, string>>;
  /** S724 (V251-29): the ad's facts, shown in the approval box. */
  adPreview?: AdPreview | null;
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
  const publicLink = replyInputs.bookingUrl;

  // The record decides what is listed. An unproven channel is absent, not
  // greyed out: a disabled tile still advertises something we cannot do.
  const shownSet = shownChannelKeys == null ? null : new Set(shownChannelKeys);
  const visibleCards =
    shownSet == null
      ? channelCards
      : channelCards.filter((card) => shownSet.has(card.channel.key));

  // Resolve every channel once, then group + tally.
  const resolved: ResolvedRow[] = visibleCards.map((card) => {
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
      alreadySignedIn: card.robotReady === true,
    };
  });
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
  // Count only what the landlord can actually see. A hidden channel with a
  // saved ad must not appear in "Live on N sites", or the headline points at
  // something the page does not list.
  // S705: the headline uses the SAME live rule as each site row
  // (forYouLiveState), so "Live on N sites" always matches the list below.
  // It used to count only fresh "posted" cards and read 2 while the list
  // showed 3 sites Live (an aging ad is still live).
  const proofSavedCount = resolved.filter((row) => liveStateFor(row).isLive).length;
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
    <div className="space-y-5">
      {/* S705: one column. The address card, the right-hand summary panel and
          the per-site "next step" box are gone: the page header already names
          the rental, and every site now appears once, in the list below. */}
      <div className="space-y-5">
        {linkIsLive ? (
          <section className="rounded-2xl border border-green-200 bg-green-50 p-6 shadow-sm">
            <span className="rounded-full bg-green-600 px-2.5 py-0.5 text-xs font-semibold text-white">
              You&apos;re online
            </span>
            <h3 className="mt-3 text-2xl font-semibold text-green-950">
              {onlineHeadline}
            </h3>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-green-800">
              {proofSavedCount > 0 ? "Your Vacantless page is live too. " : ""}
              {totalInquiryCount}{" "}
              {totalInquiryCount === 1 ? "inquiry" : "inquiries"} for this
              rental so far.
            </p>

            {postingBlocker && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-white px-4 py-3">
                <div>
                  <h4 className="text-base font-semibold text-amber-950">
                    {postingBlocker.title}
                  </h4>
                  <p className="mt-0.5 text-sm text-amber-900">
                    {postingBlocker.detail}
                  </p>
                  {postingBlocker.items && postingBlocker.items.length > 1 ? (
                    <ul className="mt-1.5 flex flex-wrap gap-1.5">
                      {postingBlocker.items.map((item) => (
                        <li key={item.href + item.label}>
                          <a
                            href={item.href}
                            className="inline-flex rounded-full border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-50"
                          >
                            {item.label} →
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <a
                  href={postingBlocker.href}
                  className="inline-flex items-center gap-1 rounded-xl bg-amber-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-800"
                >
                  {postingBlocker.action}
                </a>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3">
              {publicLink && <CopyLink url={publicLink} />}
              {!postingBlocker && (
                <button
                  type="button"
                  onClick={openConfirm}
                  className="inline-flex items-center gap-2 rounded-xl border border-green-300 bg-white px-4 py-2.5 text-sm font-semibold text-green-800 hover:bg-green-100"
                >
                  <Icons.bolt className="h-4 w-4" />
                  {proofSavedCount > 0 ? "Post your edits to every site" : "Post everywhere"}
                </button>
              )}
            </div>
          </section>
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
                  Approve each post
                </b>
                <small className="text-[11px] text-emerald-200">
                  We post it for you. You pay a site only if it charges.
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
                  Then approve each site&apos;s post
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

        {/* S705: ONE list of sites. Sites we post for you first (each with its
            one action), then every other site on one line each: connected
            sites, sites that need a sign-in, and the brokerage route. */}
        {(forYou.length > 0 || instantRows.length > 0 || setupRows.length > 0) && (
          <ForYouHandoff
            propertyId={propertyId}
            addressLabel={addressLabel}
            rows={copilotEnabled ? forYou : []}
            runItems={runItems}
            linkIsLive={linkIsLive}
            conciergeDeskEnabled={conciergeDeskEnabled}
            wizardEnabled={wizardEnabled}
            allSetSummary={liveForYouAllSet}
            postingBlocker={postingBlocker}
            marketplaceKit={marketplaceKit}
            brokerage={brokerage}
            robotPostingAllowed={robotPostingAllowed}
            capNotes={capNotes}
            adPreview={adPreview}
            otherRows={[...(copilotEnabled ? [] : forYou), ...instantRows, ...setupRows]}
            liveStateFor={liveStateFor}
          />
        )}
      </div>

      {confirmOpen && (
          <ConfirmModal
            propertyId={propertyId}
            addressLabel={addressLabel}
            instantDestinations={confirmDestinations}
            instantDestinationsLoading={confirmDestinationsLoading}
            instantDestinationsError={confirmDestinationsError}
            forYouRows={
              // S732 walk-through: Facebook Marketplace is posted by the
              // landlord from the kit, never after a sign-in, so it must not
              // count as "1 site needs sign-in" in the confirm dialog.
              (robotPostingAllowed
                ? forYou
                : forYou.filter((r) => !isRobotPostedChannel(r.key))
              ).filter((r) => !(r.key === "facebook" && marketplaceKit))
            }
            conciergeDeskEnabled={conciergeDeskEnabled}
          conciergeUsage={conciergeUsage}
          onClose={() => setConfirmOpen(false)}
        />
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
  wizardEnabled = false,
  allSetSummary,
  postingBlocker,
  marketplaceKit = null,
  brokerage = null,
  robotPostingAllowed = false,
  capNotes = {},
  adPreview = null,
  otherRows = [],
  liveStateFor,
}: {
  capNotes?: Readonly<Record<string, string>>;
  adPreview?: AdPreview | null;
  /** S734: the one-line rows (connected sites, sign-in sites), partitioned
   *  with the for-you rows so a locked Rentals.ca or Zumper row sits under
   *  the Posting offer, not above it. */
  otherRows?: ResolvedRow[];
  liveStateFor?: (row: ResolvedRow) => { isLive: boolean; liveUrl: string | null } | null;
  marketplaceKit?: MarketplaceKitData | null;
  brokerage?: BrokerageRequestCardData | null;
  robotPostingAllowed?: boolean;
  propertyId: string;
  addressLabel: string;
  rows: ResolvedRow[];
  runItems: PublishEverywhereRunItem[];
  linkIsLive: boolean;
  conciergeDeskEnabled: boolean;
  wizardEnabled?: boolean;
  allSetSummary: boolean;
  postingBlocker?: PublishEverywherePostingBlocker | null;
}) {
  const itemByChannel = new Map(runItems.map((it) => [it.channel, it]));
  return (
    <section className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <h3 className="text-base font-semibold tracking-tight text-indigo-950">
          Your rental sites
        </h3>
      </div>
      <p className="mt-1 text-[12.5px] leading-relaxed text-indigo-900/80">
        {postingBlocker
          ? "Posting to rental sites opens once your listing has the details every site needs."
          : allSetSummary
          ? "The link to each ad is saved here. Reopen a site only when you change the listing."
          : robotPostingAllowed
          ? "We post it for you. You approve each post and pay a site only if it charges."
          : "Facebook Page and Instagram post from here, free. The Marketplace kit gives you the ad to paste. Kijiji, Rentals.ca and Zumper are posted for you with the Posting add-on."}
      </p>
      {postingBlocker && (
        <a
          href={postingBlocker.href}
          className="mt-3 inline-flex rounded-lg bg-amber-700 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-800"
        >
          {postingBlocker.action}
        </a>
      )}
      {/* S734 (review item 1): without Posting, the free sites come first
          (Marketplace kit, then the one-click Facebook Page and Instagram
          rows), then one Posting offer, then the three locked sites. With
          Posting the order is unchanged: the sites we post for you first. */}
      {(() => {
        const locked = (row: ResolvedRow) => !robotPostingAllowed && isRobotPostedChannel(row.key);
        const renderRow = (row: ResolvedRow) => (
          <ForYouRow
            key={row.key}
            row={row}
            item={itemByChannel.get(row.key) ?? null}
            propertyId={propertyId}
            addressLabel={addressLabel}
            linkIsLive={linkIsLive}
            conciergeDeskEnabled={conciergeDeskEnabled}
            wizardEnabled={wizardEnabled}
            postingBlocked={Boolean(postingBlocker)}
            marketplaceKit={row.key === "facebook" ? marketplaceKit : null}
            addonLocked={locked(row)}
            capNote={capNotes[row.key] ?? null}
            adPreview={adPreview}
          />
        );
        const renderOther = (r: ResolvedRow) => (
          <ChannelRow
            key={r.key}
            row={r}
            propertyId={propertyId}
            wizardEnabled={wizardEnabled}
            live={liveStateFor ? liveStateFor(r) : null}
            addonLocked={locked(r)}
          />
        );
        const otherBox = (list: ResolvedRow[]) =>
          list.length > 0 ? (
            <div className="mt-3 rounded-xl border border-indigo-100 bg-white px-3 py-1">
              {list.map(renderOther)}
            </div>
          ) : null;
        const open = rows.filter((row) => !locked(row));
        const held = rows.filter(locked);
        const otherOpen = otherRows.filter((row) => !locked(row));
        const otherHeld = otherRows.filter(locked);
        if (robotPostingAllowed || (held.length === 0 && otherHeld.length === 0)) {
          return (
            <>
              <ul className="mt-3 space-y-2.5">{rows.map(renderRow)}</ul>
              {otherBox(otherRows)}
            </>
          );
        }
        return (
          <>
            <ul className="mt-3 space-y-2.5">{open.map(renderRow)}</ul>
            {otherBox(otherOpen)}
            <ul className="mt-3 space-y-2.5">
              {!postingBlocker && <PostingOfferCard />}
              {held.map(renderRow)}
            </ul>
            {otherBox(otherHeld)}
          </>
        );
      })()}
      {conciergeDeskEnabled && !postingBlocker && (
        <p className="mt-3 text-[11px] leading-relaxed text-gray-500">
          A site shows Live once the link to your ad is saved.
        </p>
      )}
      {/* S735: Realtor.ca is an MLS listing a licensed agent places, so it is
          a request under the list, never a site tile (S710 decision). */}
      {brokerage && <BrokerageRequestCard propertyId={propertyId} data={brokerage} />}
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
  wizardEnabled = false,
  postingBlocked: postingBlockedProp,
  marketplaceKit = null,
  addonLocked = false,
  capNote = null,
  adPreview = null,
}: {
  capNote?: string | null;
  adPreview?: AdPreview | null;
  marketplaceKit?: MarketplaceKitData | null;
  /** S713: a robot site and the org has no Posting add-on. */
  addonLocked?: boolean;
  row: ResolvedRow;
  item: PublishEverywhereRunItem | null;
  propertyId: string;
  addressLabel: string;
  linkIsLive: boolean;
  conciergeDeskEnabled: boolean;
  wizardEnabled?: boolean;
  postingBlocked?: boolean;
}) {
  const [approveOpen, setApproveOpen] = useState(false);
  // S712: Marketplace needs no sign-in, fee or square footage, so the "finish
  // your listing first" hold does not apply; its kit warns when photos are missing.
  const postingBlocked = postingBlockedProp && !marketplaceKit;
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
  // S708: the robot built a paid ad and stopped at the site's checkout. The
  // landlord pays there (a saved card still needs its CVV); no approval left.
  const payAtCheckout = !isLive && gate === "needs_payment" && !!item?.checkoutUrl;
  // S724 (V251-33): once approved, the item is the robot's until it finishes or
  // the landlord stops it. Offering "Approve" again invited a second post.
  const approvedRunning =
    !isLive &&
    !payAtCheckout &&
    item?.approved === true &&
    (gate === "needs_operator" || gate === "needs_payment");
  const needsApproval =
    !isLive &&
    !payAtCheckout &&
    !approvedRunning &&
    (gate === "needs_operator" || gate === "needs_payment");
  // S713d: the robot found a step only the landlord can do on the site itself.
  const siteSetup = needsApproval ? (item?.siteSetup ?? null) : null;
  // needs_login can't be approved — it needs a re-connect, so route to posting assist.
  const needsConnect = !isLive && gate === "needs_login";
  // S703: the run item still says live but its ad is gone (expired or
  // removed on the site, so the listing row no longer proves it). Re-staging
  // the site resets the item, so offer the same "add" step as a fresh site.
  // S708: a rejected item (e.g. an old desk item closed as superseded) is a
  // dead end too; without this it fell through to a billing link.
  const repostable =
    !isLive &&
    item != null &&
    (item.publishStatus === "live" || item.publishStatus === "rejected");
  const working =
    !isLive &&
    (approvedRunning || gate === "queued" || gate === "submitting" || gate === "submitted");
  // S719 (KI1303): right after "Post it for me" a robot item is queued while we
  // fill in the ad. Nothing is posted until the landlord approves it, so this
  // is "getting it ready", not "posting".
  // S724 (V251-28): until the landlord approves, the robot is only building the
  // ad (queued, then submitting while it fills the site's form). Say "Getting it
  // ready" through all of it; "We're posting it" only after Approve.
  const preparing =
    working &&
    (gate === "queued" || gate === "submitting" || gate === "submitted") &&
    item?.approved !== true &&
    isRobotPostedChannel(row.key);
  const locked = addonLocked && !isLive;

  const stateChip = isLive
    ? { label: "Live", cls: "bg-green-50 text-green-700" }
    : locked
      ? ADDON_CHIP
    : postingBlocked
      ? { label: "Waiting", cls: "bg-amber-50 text-amber-700" }
    : payAtCheckout
      ? { label: "Ready. Pay the site", cls: "bg-emerald-50 text-emerald-700" }
    : siteSetup
      ? { label: "Needs you", cls: "bg-amber-50 text-amber-700" }
    : needsApproval
      ? { label: "Ready. Approve it", cls: "bg-emerald-50 text-emerald-700" }
      : needsConnect
        ? { label: "Sign-in needed", cls: "bg-amber-50 text-amber-700" }
        : preparing
          ? { label: "Getting it ready", cls: "bg-amber-50 text-amber-700" }
        : working
          ? { label: "We're posting it", cls: "bg-amber-50 text-amber-700" }
          : repostable
            ? { label: "Needs a repost", cls: "bg-amber-50 text-amber-700" }
          : paid
            ? { label: "Not posted. Site fee", cls: "bg-indigo-50 text-indigo-700" }
            : { label: "Not posted yet", cls: "bg-indigo-50 text-indigo-700" };

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

      {locked ? null : postingBlocked && !isLive ? (
        <p className="mt-2 text-[12px] leading-relaxed text-indigo-900/70">
          Finish your listing first. Sign-in and any site fee come after the
          details are complete.
        </p>
      ) : isLive ? (
        <>
          {liveUrl ? (
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
          )}
          {item?.photoNote ? (
            <p className="mt-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-950">
              {item.photoNote}
            </p>
          ) : null}
        </>
      ) : marketplaceKit && linkIsLive ? (
        // S712: Marketplace is posted by the org's own team from the kit, never
        // by the desk or the robot (Facebook has no API for it).
        <MarketplaceRow propertyId={propertyId} kit={marketplaceKit} />
      ) : item == null || repostable ? (
        linkIsLive ? (
          <>
          {/* S740: the free-cap warning showed only inside the approval
              popup, so "Post it again" on Unit 3 gave no sign Agile already
              had all 3 free Rentals.ca listings in use. */}
          {capNote ? (
            <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-950">
              {capNote}
            </p>
          ) : null}
          <form
            action={startSitePost}
            className="mt-2 flex flex-wrap items-center gap-2"
          >
            <input type="hidden" name="property_id" value={propertyId} />
            <input type="hidden" name="channel" value={row.key} />
            <button
              type="submit"
              className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-indigo-700"
            >
              {repostable ? "Post it again →" : "Add this site →"}
            </button>
          </form>
          </>
        ) : (
          <p className="mt-2 text-[12px] text-gray-500">
            Post first, then come back to this step.
          </p>
        )
      ) : payAtCheckout && item?.checkoutUrl ? (
        <div className="mt-2">
          <p className="text-[12px] text-emerald-800">
            {item.checkoutHint ??
              "Your ad is built and waiting at checkout. You pay only when you press Pay. Pick your saved card, type its security code and press Pay."}
          </p>
          <a
            href={item.checkoutUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1.5 inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-emerald-700"
          >
            Pay on {PAID_SITE_LABEL[row.key] ?? row.label} ↗
          </a>
        </div>
      ) : needsApproval ? (
        <div className="mt-2">
          {siteSetup ? (
            <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-[12px] leading-relaxed text-amber-950">{siteSetup.message}</p>
              <a
                href={siteSetup.href}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-[12.5px] font-semibold text-amber-900 hover:underline"
              >
                {siteSetup.action} ↗
              </a>
            </div>
          ) : (
          <p className="text-[12px] text-emerald-800">
            Your ad is ready. Approve it to post
            {paid ? " and cover the fee" : ""}.
          </p>
          )}
          <button
            type="button"
            onClick={() => setApproveOpen(true)}
            className="mt-1.5 inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-emerald-700"
          >
            Approve and post →
          </button>
        </div>
      ) : needsConnect ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <a
            href={
              wizardEnabled
                ? `/dashboard/link-portals?property=${encodeURIComponent(propertyId)}`
                : `/dashboard/settings?tab=distribution#channel-${row.key}`
            }
            className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-indigo-700"
          >
            Sign in once →
          </a>
          <span className="text-[11px] text-gray-500">
            Or{" "}
            <a href="#ad-wording" className="underline">
              copy the ad wording
            </a>{" "}
            and post it on the site.
          </span>
        </div>
      ) : preparing ? (
        <p className="mt-2 text-[12px] text-amber-800">
          We&apos;re filling in the ad. You approve it here before anything is
          posted. Reload this page in a few minutes.
        </p>
      ) : working ? (
        <div className="mt-2">
          <p className="text-[12px] text-amber-800">
            We&apos;re posting this now and will bring back the live link here.
          </p>
          {item?.approved === true && (
            // S724 (V251-32): the landlord can take the approval back at any time.
            <form action={stopAutopilotSubmit} className="mt-1.5">
              <input type="hidden" name="property_id" value={propertyId} />
              <input type="hidden" name="item_id" value={item.id} />
              <button
                type="submit"
                className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-gray-700 hover:bg-gray-50"
              >
                Stop this post
              </button>
            </form>
          )}
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {conciergeDeskEnabled && item.canConcierge ? (
            <form action={requestConciergePublish}>
              <input type="hidden" name="property_id" value={propertyId} />
              <input type="hidden" name="item_id" value={item.id} />
              <button
                type="submit"
                className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-indigo-700"
              >
                {isRobotPostedChannel(row.key) ? "Post it for me →" : "Have us post it →"}
              </button>
            </form>
          ) : (
            <p className="text-[12px] text-gray-500">
              We post this site for you.{" "}
              <a href="/dashboard/billing" className="font-semibold text-indigo-700 hover:underline">
                Turn that on →
              </a>
            </p>
          )}
        </div>
      )}

      {approveOpen && item != null && !locked && (
        <ApprovalModal
          propertyId={propertyId}
          itemId={item.id}
          channelLabel={row.label}
          addressLabel={addressLabel}
          paid={paid}
          siteLabel={PAID_SITE_LABEL[row.key] ?? row.label}
          capNote={capNote}
          adPreview={adPreview}
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
  capNote = null,
  adPreview = null,
  onClose,
}: {
  propertyId: string;
  itemId: string;
  channelLabel: string;
  addressLabel: string;
  paid: boolean;
  siteLabel: string;
  capNote?: string | null;
  adPreview?: AdPreview | null;
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

        {adPreview && (
          <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-3">
            {adPreview.title && (
              <p className="text-[13px] font-semibold leading-snug text-gray-900">{adPreview.title}</p>
            )}
            <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
              {adPreview.facts.map((fact) => (
                <div key={fact.label} className="contents">
                  <dt className="text-gray-500">{fact.label}</dt>
                  <dd className={fact.missing ? "font-medium text-amber-800" : "text-gray-900"}>{fact.value}</dd>
                </div>
              ))}
            </dl>
            {adPreview.descriptionStart && (
              <p className="mt-2 text-[12px] leading-relaxed text-gray-600">{adPreview.descriptionStart}</p>
            )}
            <p className="mt-2 text-[11px] text-gray-500">
              Something wrong? Cancel and fix it on this rental first.
            </p>
          </div>
        )}

        {paid && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-[12.5px] leading-relaxed text-amber-950">
            {siteLabel} charges its own fee. You pay {siteLabel} with the card
            you keep there.
          </div>
        )}

        {capNote && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-[12.5px] leading-relaxed text-amber-950">
            {capNote}
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
  // S724 (V251-25): count real sites only. The Vacantless page is yours and
  // inquiry emails go to you; neither is a rental site.
  const siteCount = instantDestinations.length;
  const liveNowText =
    siteCount === 0
      ? "Posted now: your Vacantless page"
      : `Posted now: your Vacantless page and ${siteCount === 1 ? "1 connected site" : `${siteCount} connected sites`}`;
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
          {liveNowText} · {signInText} · {feeText}.
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
            ✉️ New inquiries emailed to you
            <span className="ml-auto text-[10px] font-black tracking-wide text-green-700">
              On
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
              Sign in to each site once. After that we post for you. We never
              see your password.
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
