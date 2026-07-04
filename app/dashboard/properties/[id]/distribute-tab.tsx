// Distribute command center (S412, Slice 1). One card per real channel, driven
// by lib/distribution-channels (the matrix + status reducer). This ABSORBS the
// old "Where this is posted" tracker: each channel card hosts that channel's
// tracked posts + the add/edit/remove forms, reusing the SAME server actions
// (addListingPost / updateListingPost / removeListingPost) and listing_posts
// rows — no data-model change. Asset prep (Marketing Kit, Listing Copy, Fill
// Sheet, Photos) stays on the Photos & marketing tab; this tab is about WHERE
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
} from "../actions";
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

// A fully-resolved channel card: the matrix row + computed status + the
// matching channel copy + feed note + this channel's tracked posts.
export type DistributeChannelCard = {
  channel: DistributionChannel;
  status: ChannelStatus;
  copy: { title: string; body: string } | null;
  feed: { inFeed: boolean; hint: string } | null;
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
}) {
  const liveChannels = channelCards.filter(
    (c) => c.status.value === "posted" || c.status.value === "needs_refresh",
  ).length;

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
            Distribute this rental
          </h3>
        </div>
        <p className="mb-3 text-xs text-gray-500">
          One place to see where this listing is live, what still needs a human
          step, and which channel is producing renters. Vacantless prepares the
          copy, field sheet, and gotchas; posting to Facebook, Kijiji, and the
          other portals stays a guided manual step - it never posts on your
          behalf.
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
              Finish setup in Photos &amp; marketing →
            </a>
          )}
        </div>
        {!linkIsLive && promotionNote && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {promotionNote}
          </p>
        )}
      </div>

      {/* Channel cards. */}
      <div className="space-y-4">
        {channelCards.map((card) => (
          <ChannelCard
            key={card.channel.key}
            card={card}
            propertyId={propertyId}
            linkIsLive={linkIsLive}
            addFormKey={addFormKey}
            today={today}
          />
        ))}
      </div>

      {/* Other / manual channels — anything not in the matrix (PadMapper, a
          local board, a custom post). Keeps the durable "this ad exists here"
          record for attribution. */}
      <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-2 flex items-center gap-2.5">
          <IconTile><Icons.list className="h-4 w-4" /></IconTile>
          <h3 className="text-sm font-semibold text-gray-900">
            Other channels
          </h3>
        </div>
        <p className="mb-4 text-xs text-gray-500">
          Track any other place you posted - a niche board, a community group, a
          custom site - so its inquiries are attributed too.
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
  );
}

// --- one channel card ------------------------------------------------------

function ChannelCard({
  card,
  propertyId,
  linkIsLive,
  addFormKey,
  today,
}: {
  card: DistributeChannelCard;
  propertyId: string;
  linkIsLive: boolean;
  addFormKey: string;
  today: string;
}) {
  const { channel, status, copy, feed } = card;
  const tone = channelStatusTone(status.value);
  const combinedCopy = copy ? `${copy.title}\n\n${copy.body}` : null;
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
          <span className="font-medium text-gray-700">Feed:</span>{" "}
          {feed.inFeed
            ? "This listing is in your Vacantless feed, ready for a partner route once one is set up."
            : feed.hint}
        </p>
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
          Full copy &amp; field sheet in Photos &amp; marketing →
        </a>
      </div>

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
        + Track a post / mark as posted
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

function IconTile({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand/10 text-brand">
      {children}
    </span>
  );
}
