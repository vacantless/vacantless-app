"use client";

// ============================================================================
// Publish Everywhere — the one-click "Market it" surface (S630, Slice 1).
//
// RENDER-ONLY. This is the approved v3 north-star ported to real per-org data:
// it renders every channel by resolving it (lib/publish-everywhere.ts) to one
// publish MODE, grouping modes into the three honest BUCKETS, showing the reach
// summary + legend, and offering the dominant "Publish everywhere" CTA behind a
// preflight confirm modal. The CTA runs the EXISTING publishProperty server
// action (page-live + current authorized-instant autofire) — exactly what the
// old Simple hero already did. No new posting path, no co-pilot handoff, no
// charge, no migration. Those arrive in later slices; here they are display-only
// or shown-but-disabled. Ships dark behind PUBLISH_EVERYWHERE_ENABLED.
//
// Honesty invariants carried forward: nothing posts before the confirm modal
// (KI999); "instant" is claimed ONLY for connected/authorized/accepted channels
// (the resolver enforces this); reach "included" is instant + for-you, never the
// raw channel count.
// ============================================================================

import { useState } from "react";
import { Icons } from "@/components/icons";
import { CopyLink } from "./copy-link";
import { publishProperty } from "../actions";
import {
  resolvePublishMode,
  summarizeReach,
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
// resolves to "planned" (the resolver settles that first).
const PAID_SITE_KEYS = new Set(["viewit", "rentfaster"]);

// Adapt a fully-resolved channel card into the resolver's structural input.
// Channel-agnostic: reads only the card's config + account state, never a
// hard-coded channel name (adding a channel is a config row, no edit here).
function toPublishInput(card: DistributeChannelCard): PublishChannelInput {
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
    const { mode, bucket } = resolvePublishMode(toPublishInput(card));
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

// The mandatory preflight gate: nothing posts before the operator sees this.
// The primary action is the EXISTING publishProperty server action (page-live +
// current authorized-instant autofire) — identical to the old Simple hero.
function ConfirmModal({
  propertyId,
  addressLabel,
  instantRows,
  forYouRows,
  conciergeDeskEnabled,
  conciergeUsage,
  onClose,
}: {
  propertyId: string;
  addressLabel: string;
  instantRows: ResolvedRow[];
  forYouRows: ResolvedRow[];
  conciergeDeskEnabled: boolean;
  conciergeUsage: { used: number; included: number };
  onClose: () => void;
}) {
  const forYouLabels = forYouRows.map((r) => r.label).join(", ");
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
          Exactly what happens when you tap — nothing posts before you see this.
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
          {forYouRows.length > 0 && (
            <div className="flex items-center gap-2 py-2.5 text-[13px]">
              🤝 {forYouLabels}
              <span className="ml-auto shrink-0 text-[10px] font-black tracking-wide text-indigo-600">
                WE FILL · YOU POST
              </span>
            </div>
          )}
        </div>

        <div className="my-3.5 flex justify-between rounded-xl border border-gray-200 px-3.5 py-2.5 text-[12.5px] text-gray-700">
          <span>Third-party listing fees today</span>
          <span>
            <b>$0.00</b> — always shown first
          </span>
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
          For the for-you sites we auto-fill everything; you sign in, cover any
          fee, and tap post. One-tap auto-fill handoff arrives in a later update
          for this org; live links are tracked back here.
        </p>
      </div>
    </div>
  );
}
