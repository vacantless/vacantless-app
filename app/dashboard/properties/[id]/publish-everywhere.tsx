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
//     get a real "Start guided posting" deep-link to the existing co-pilot
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
import { authorizeAutopilotSubmit } from "../distribution-actions";
import {
  derivePublishPreflight,
  resolvePublishMode,
  summarizeReach,
  isCopilotSupportedKey,
  type PublishMode,
  type PublishBucket,
  type PublishChannelInput,
} from "@/lib/publish-everywhere";
import { conciergeUsageLabel } from "@/lib/billing";
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

// --- per-channel presentation (mode -> chip) -------------------------------
// One place maps a resolved mode to its user-facing chip. No new color system:
// green = instant, indigo = we-post-for-you, gray = after-setup (same tones the
// north-star and the rest of the tab already use).
const MODE_CHIP: Record<PublishMode, { label: string; cls: string }> = {
  instant_auto: { label: "Instant", cls: "bg-green-50 text-green-700" },
  copilot_fill: { label: "We'll fill it", cls: "bg-indigo-50 text-indigo-700" },
  paid_optin: { label: "We'll fill it · fee", cls: "bg-indigo-50 text-indigo-700" },
  needs_connection: { label: "Connect once", cls: "bg-gray-100 text-gray-600" },
  brokerage_gated: { label: "Via brokerage", cls: "bg-gray-100 text-gray-600" },
  planned: { label: "Coming soon", cls: "bg-gray-100 text-gray-600" },
};

const BUCKET_META: Record<
  PublishBucket,
  { title: string; note: string; dot: string }
> = {
  instant: {
    title: "Goes live instantly",
    note: "— the moment you tap",
    dot: "bg-green-500",
  },
  for_you: {
    title: "We post these for you",
    note: "— no API, so we auto-fill; you sign in & post",
    dot: "bg-indigo-500",
  },
  after_setup: {
    title: "Available after a one-time setup",
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
};

function ChannelRow({ row }: { row: ResolvedRow }) {
  const chip = MODE_CHIP[row.mode];
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-sm">
        {CHANNEL_GLYPH[row.key] ?? "🏠"}
      </span>
      <span className="text-sm font-semibold text-gray-800">{row.label}</span>
      <span
        className={`ml-auto rounded-full px-2.5 py-1 text-[11px] font-bold ${chip.cls}`}
      >
        {chip.label}
      </span>
    </div>
  );
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
  runItems = [],
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
  runItems?: PublishEverywhereRunItem[];
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);

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
    return { key: card.channel.key, label: card.channel.label, mode, bucket };
  });
  const reach = summarizeReach(resolved.map((r) => r.bucket), true);
  const byBucket = (b: PublishBucket) => resolved.filter((r) => r.bucket === b);
  const forYou = byBucket("for_you");

  const publishBlockedByBasics = setupOutstanding > 0;
  const canPublish = !publishBlockedByBasics && canSetLive;

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
            {linkIsLive ? "✓ You're online" : "✓ Ready to publish"}
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
          <section className="rounded-2xl border border-green-200 bg-green-50 p-6 shadow-sm">
            <span className="rounded-full bg-green-600 px-2.5 py-0.5 text-xs font-semibold text-white">
              You&apos;re online
            </span>
            <h3 className="mt-3 text-2xl font-semibold text-green-950">
              Live on {reach.instant} {reach.instant === 1 ? "channel" : "channels"}.
            </h3>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-green-800">
              The renter page is live. Connected channels stay in sync; the
              for-you channels stay ready in the guided queue.{" "}
              {totalInquiryCount}{" "}
              {totalInquiryCount === 1 ? "inquiry" : "inquiries"} tied to this
              rental so far.
            </p>
            {publicLink && (
              <div className="mt-4">
                <CopyLink url={publicLink} />
              </div>
            )}
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              className="mt-4 inline-flex items-center gap-2 rounded-xl border border-green-300 bg-white px-4 py-2.5 text-sm font-semibold text-green-800 hover:bg-green-100"
            >
              <Icons.bolt className="h-4 w-4" />
              Sync updates / re-publish
            </button>
          </section>
        ) : (
          <section className="relative overflow-hidden rounded-2xl border border-emerald-900 bg-gradient-to-b from-emerald-900 to-emerald-950 p-7 text-center text-white shadow-sm">
            <div className="mx-auto mb-5 flex max-w-md flex-wrap justify-center gap-5 text-left">
              <div className="max-w-[150px]">
                <div className="text-lg">⚡</div>
                <b className="block text-[12.5px] text-emerald-50">
                  Instant where connected
                </b>
                <small className="text-[11px] text-emerald-200">
                  Page, email, and any connected sites
                </small>
              </div>
              <div className="max-w-[150px]">
                <div className="text-lg">🤝</div>
                <b className="block text-[12.5px] text-emerald-50">
                  We post the rest
                </b>
                <small className="text-[11px] text-emerald-200">
                  Marketplace, Kijiji &amp; paid sites
                </small>
              </div>
              <div className="max-w-[150px]">
                <div className="text-lg">🔄</div>
                <b className="block text-[12.5px] text-emerald-50">
                  Connected stays synced
                </b>
                <small className="text-[11px] text-emerald-200">
                  Edits auto-update connected channels
                </small>
              </div>
            </div>

            {canPublish ? (
              <button
                type="button"
                onClick={() => setConfirmOpen(true)}
                className="mx-auto flex w-full max-w-md flex-col items-center gap-0.5 rounded-2xl bg-gradient-to-b from-green-400 to-green-600 px-6 py-4 text-lg font-black text-emerald-950 shadow-lg transition hover:-translate-y-0.5"
              >
                <span className="inline-flex items-center gap-2">
                  <Icons.bolt className="h-5 w-5" />
                  Publish everywhere
                </span>
                <small className="text-[12.5px] font-semibold opacity-80">
                  One tap — we handle the rest
                </small>
              </button>
            ) : publishBlockedByBasics ? (
              <div className="mx-auto max-w-md rounded-xl border border-amber-200 bg-white/95 px-4 py-3 text-left">
                <p className="text-sm font-semibold text-amber-950">
                  Finish {setupOutstanding}{" "}
                  {setupOutstanding === 1 ? "listing detail" : "listing details"}{" "}
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
              🔒 You&apos;ll see exactly what happens before anything posts
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
          />
        )}
      </div>

      {/* Right: reach summary + the three buckets + legend. */}
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
              Reach for this publish
            </div>
            <div className="flex flex-wrap gap-1.5">
              <span className="rounded-full bg-green-50 px-2.5 py-1 text-[11px] font-bold text-green-700">
                {reach.instant} instant
              </span>
              <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-bold text-indigo-700">
                {reach.for_you} for you
              </span>
              <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-bold text-gray-600">
                {reach.after_setup} after setup
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
          {byBucket("instant").map((r) => (
            <ChannelRow key={r.key} row={r} />
          ))}
        </div>

        {forYou.length > 0 && (
          <div className="mb-3.5">
            <BucketLabel bucket="for_you" />
            {forYou.map((r) => (
              <ChannelRow key={r.key} row={r} />
            ))}
          </div>
        )}

        {byBucket("after_setup").length > 0 && (
          <div className="mb-3.5">
            <BucketLabel bucket="after_setup" />
            {byBucket("after_setup").map((r) => (
              <ChannelRow key={r.key} row={r} />
            ))}
          </div>
        )}

        <div className="mt-2 border-t border-gray-100 pt-3 text-[11.5px] leading-relaxed text-gray-500">
          <b className="text-gray-700">Instant</b> — published and kept in sync
          automatically.
          <br />
          <b className="text-gray-700">We&apos;ll fill it</b> — we auto-fill the whole
          post; you sign in, cover any site fee, and tap post.
          <br />
          <b className="text-gray-700">After setup</b> — a one-time sign-in (or
          your brokerage) adds it to every future publish.
        </div>
      </aside>

      {confirmOpen && (
        <ConfirmModal
          propertyId={propertyId}
          addressLabel={addressLabel}
          instantRows={byBucket("instant")}
          forYouRows={forYou}
          conciergeDeskEnabled={conciergeDeskEnabled}
          conciergeUsage={conciergeUsage}
          copilotEnabled={copilotEnabled}
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
//   • "Start guided posting" opens the EXISTING co-pilot sidecar; the extension
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
}: {
  propertyId: string;
  addressLabel: string;
  rows: ResolvedRow[];
  runItems: PublishEverywhereRunItem[];
  linkIsLive: boolean;
  conciergeDeskEnabled: boolean;
}) {
  const itemByChannel = new Map(runItems.map((it) => [it.channel, it]));
  return (
    <section className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="text-lg">🤝</span>
        <h3 className="text-base font-semibold tracking-tight text-indigo-950">
          We post these for you
        </h3>
      </div>
      <p className="mt-1 text-[12.5px] leading-relaxed text-indigo-900/80">
        These sites have no API, so we auto-fill the whole post for you. When it is
        ready we bring it back here for one tap — we never post, sign in, or pay on
        your behalf without you.
      </p>
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
          />
        ))}
      </ul>
      {conciergeDeskEnabled && (
        <p className="mt-3 text-[11px] leading-relaxed text-gray-500">
          “Have us post it” uses one done-for-you publish from your plan. We record
          a real live-ad link before it is marked live.
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
}: {
  row: ResolvedRow;
  item: PublishEverywhereRunItem | null;
  propertyId: string;
  addressLabel: string;
  linkIsLive: boolean;
  conciergeDeskEnabled: boolean;
}) {
  const [approveOpen, setApproveOpen] = useState(false);
  const paid = row.mode === "paid_optin";
  const isLive =
    item != null && (item.publishStatus === "live" || Boolean(item.externalUrl));
  const gate =
    item != null && item.mode === "concierge" ? item.publishStatus : null;
  // needs_operator (free channel, prepared) + needs_payment (paid site, prepared
  // pending the fee) both collapse to one branded "Approve & publish" tap.
  const needsApproval =
    !isLive && (gate === "needs_operator" || gate === "needs_payment");
  // needs_login can't be approved — it needs a re-connect, so route to guided posting.
  const needsConnect = !isLive && gate === "needs_login";
  const working =
    !isLive &&
    (gate === "queued" || gate === "submitting" || gate === "submitted");

  const stateChip = isLive
    ? { label: "Live", cls: "bg-green-50 text-green-700" }
    : needsApproval
      ? { label: "Ready — approve", cls: "bg-emerald-50 text-emerald-700" }
      : needsConnect
        ? { label: "Sign-in needed", cls: "bg-amber-50 text-amber-700" }
        : working
          ? { label: "We're posting it", cls: "bg-amber-50 text-amber-700" }
          : paid
            ? { label: "We'll fill it · fee", cls: "bg-indigo-50 text-indigo-700" }
            : { label: "We'll fill it", cls: "bg-indigo-50 text-indigo-700" };

  return (
    <li className="rounded-xl border border-indigo-100 bg-white p-3">
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

      {paid && !isLive && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-gray-500">
          {PAID_SITE_LABEL[row.key] ?? "This site"} charges a listing fee set by
          the site. You approve it here and it is paid to them with your own card —
          Vacantless never charges, fronts, or handles that fee.
        </p>
      )}

      {item == null ? (
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
              Start guided posting →
            </button>
          </form>
        ) : (
          <p className="mt-2 text-[12px] text-gray-500">
            Publish first, then start the guided post here.
          </p>
        )
      ) : isLive ? (
        item.externalUrl ? (
          <a
            href={item.externalUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-semibold text-green-700 hover:underline"
          >
            View live ad ↗
          </a>
        ) : (
          <p className="mt-2 text-[12px] font-semibold text-green-700">Live.</p>
        )
      ) : needsApproval ? (
        <div className="mt-2">
          <p className="text-[12px] text-emerald-800">
            We prepared your ad — approve to publish
            {paid ? " and cover the fee" : ""}.
          </p>
          <button
            type="button"
            onClick={() => setApproveOpen(true)}
            className="mt-1.5 inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-emerald-700"
          >
            Approve &amp; publish →
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
            Sign in &amp; continue →
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
            Start guided posting →
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

// The branded one-tap consent that turns a prepared concierge post into a live
// ad. Free channel -> authorizes the post; paid site -> authorizes the site's
// listing fee (paid to the site with the landlord's own on-file method;
// Vacantless never sees or stores the card). Posts through the EXISTING
// authorizeAutopilotSubmit; nothing is posted or charged before this tap, and a
// real live-ad link is recorded before Live.
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
          Ready to publish
        </span>
        <h3 className="mt-2 text-lg font-semibold tracking-tight text-gray-950">
          Publish to {channelLabel}
        </h3>
        <p className="mt-1 text-sm text-gray-600">
          We prepared your {addressLabel} ad for {channelLabel}. One tap and we
          post it — the live link comes back to this page.
        </p>

        {paid && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-[12.5px] leading-relaxed text-amber-950">
            {siteLabel} charges its own listing fee, paid directly to {siteLabel}{" "}
            with your card on file there. Approving authorizes that charge —
            Vacantless never sees, stores, or handles your card.
          </div>
        )}

        <form action={authorizeAutopilotSubmit} className="mt-4 flex gap-2.5">
          <input type="hidden" name="property_id" value={propertyId} />
          <input type="hidden" name="item_id" value={itemId} />
          <button
            type="submit"
            className="flex-1 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700"
          >
            {paid ? "Approve fee & publish" : "Approve & publish"}
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
          Nothing is posted or charged until you approve. We record a real live-ad
          link before marking it live.
        </p>
      </div>
    </div>
  );
}

// The mandatory preflight gate: nothing posts before the operator sees this.
// The primary action is the EXISTING publishProperty server action (page-live +
// current authorized-instant autofire) — identical to the old Simple hero. The
// for-you handoff itself happens after publish, in ForYouHandoff above.
function formatFeeCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-CA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function checkedFeeTotalLabel(
  checkedFees: Array<{ feeCents: number | null }>,
): string {
  if (checkedFees.length === 0) return "$0.00";
  const knownTotal = checkedFees.reduce(
    (sum, fee) => sum + (fee.feeCents ?? 0),
    0,
  );
  const hasUnknown = checkedFees.some((fee) => fee.feeCents == null);
  if (hasUnknown && knownTotal > 0) {
    return `${formatFeeCents(knownTotal)} fixed + site fee may apply`;
  }
  if (hasUnknown) return "a site fee may apply";
  return formatFeeCents(knownTotal);
}

function ConfirmModal({
  propertyId,
  addressLabel,
  instantRows,
  forYouRows,
  conciergeDeskEnabled,
  conciergeUsage,
  copilotEnabled,
  onClose,
}: {
  propertyId: string;
  addressLabel: string;
  instantRows: ResolvedRow[];
  forYouRows: ResolvedRow[];
  conciergeDeskEnabled: boolean;
  conciergeUsage: { used: number; included: number };
  copilotEnabled: boolean;
  onClose: () => void;
}) {
  const preflight = derivePublishPreflight(forYouRows);
  const instantCount = instantRows.length + 2;
  const [selectedFeeKeys, setSelectedFeeKeys] = useState<string[]>([]);
  const checkedFees = preflight.feeChannels.filter((row) =>
    selectedFeeKeys.includes(row.key),
  );
  const checkedFeeTotal = checkedFeeTotalLabel(checkedFees);
  const signInVerb = preflight.signInNeeded.length === 1 ? "needs" : "need";
  const feeVerb = preflight.feeChannels.length === 1 ? "costs" : "cost";
  function toggleFee(key: string, checked: boolean) {
    setSelectedFeeKeys((current) =>
      checked
        ? Array.from(new Set([...current, key]))
        : current.filter((item) => item !== key),
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-h-[92vh] w-full max-w-md overflow-auto rounded-2xl bg-white p-6 shadow-2xl">
        <h3 className="text-lg font-semibold tracking-tight text-gray-950">
          Publish {addressLabel}
        </h3>
        <p className="mt-1 text-sm text-gray-500">
          {instantCount} sites go live instantly ·{" "}
          {preflight.signInNeeded.length} {signInVerb} a quick sign-in ·{" "}
          {preflight.feeChannels.length} {feeVerb} a fee.
        </p>
        <p className="mt-1 text-xs text-gray-400">
          Nothing posts until you tap Publish everywhere.
        </p>

        <div className="my-3.5 rounded-xl border border-gray-200 px-3">
          <div className="flex items-center gap-2 border-b border-gray-100 py-2.5 text-[13px]">
            🌐 Vacantless page
            <span className="ml-auto text-[10px] font-black tracking-wide text-green-700">
              INSTANT
            </span>
          </div>
          <div className="flex items-center gap-2 border-b border-gray-100 py-2.5 text-[13px]">
            ✉️ Email alerts
            <span className="ml-auto text-[10px] font-black tracking-wide text-green-700">
              INSTANT
            </span>
          </div>
          {instantRows.map((r) => (
            <div
              key={r.key}
              className="flex items-center gap-2 border-b border-gray-100 py-2.5 text-[13px]"
            >
              {CHANNEL_GLYPH[r.key] ?? "🏠"} {r.label}
              <span className="ml-auto text-[10px] font-black tracking-wide text-green-700">
                INSTANT
              </span>
            </div>
          ))}
        </div>

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

        <div className="my-3.5 rounded-xl border border-gray-200 px-3.5 py-3">
          <div className="flex items-center justify-between gap-3 text-[12.5px] text-gray-700">
            <span>Third-party listing fees today</span>
            <span className="text-right font-semibold text-gray-950">
              {checkedFeeTotal}
            </span>
          </div>
          {preflight.feeChannels.length > 0 ? (
            <div className="mt-3 space-y-2">
              {preflight.feeChannels.map((row) => {
                const checked = selectedFeeKeys.includes(row.key);
                return (
                  <label
                    key={row.key}
                    className="flex cursor-pointer items-start gap-2 rounded-lg border border-gray-200 px-3 py-2 text-[12.5px] text-gray-700"
                  >
                    <input
                      type="checkbox"
                      name="paid_channels"
                      value={row.key}
                      checked={checked}
                      onChange={(event) =>
                        toggleFee(row.key, event.currentTarget.checked)
                      }
                      className="mt-0.5 h-4 w-4 rounded border-gray-300"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-gray-900">
                        {row.label}
                      </span>
                      <span className="block text-xs text-gray-500">
                        {row.feeLabel}
                      </span>
                    </span>
                  </label>
                );
              })}
              <p className="text-[11.5px] leading-relaxed text-gray-500">
                Paid sites are off unless checked. Unchecked means no charge;
                you can add the site later.
              </p>
            </div>
          ) : (
            <p className="mt-2 text-[12.5px] text-gray-500">
              <b>$0.00</b> — no paid sites are included in this publish.
            </p>
          )}
        </div>

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
            className="flex-1 rounded-xl bg-gradient-to-b from-green-400 to-green-600 px-4 py-3 text-sm font-black text-emerald-950 hover:opacity-95"
          >
            Publish everywhere
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
          {copilotEnabled
            ? "For the for-you sites we auto-fill everything. After you publish, tap “Start guided posting”, sign in, cover any site fee, and post — we record the live link back here."
            : "For the for-you sites we auto-fill everything; you sign in, cover any fee, and tap post. One-tap auto-fill handoff arrives in a later update for this org; live links are tracked back here."}
        </p>
      </div>
    </div>
  );
}
