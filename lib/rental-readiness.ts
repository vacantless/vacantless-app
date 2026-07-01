// Pure per-rental readiness signals for the Rentals LIST page (Codex design
// audit #5: "add explicit Rentals readiness columns: link, photos, viewings,
// feed"). The list now answers, at a glance per row, the four questions an
// operator asks before a rental can actually pull inquiries:
//   - Link    : is the public inquiry page live + bookable?
//   - Photos  : does it have at least one photo?
//   - Viewings: can a renter self-book a viewing once they land? (org-wide
//                weekly availability windows — the same signal share-readiness
//                uses; identical across rows by design)
//   - Feed    : is it syndicating to the aggregator listing feed?
//
// No DB / env / IO — the page fetches the signals and passes them in, so this
// stays unit-testable (see scripts/test-rental-readiness.ts). It deliberately
// REUSES the existing single sources of truth (isPublicBookable for "live",
// listingFeedReadiness for the feed-required fields) so the list can never
// disagree with the property detail page or the feed RPC.

import { isPublicBookable, isPubliclyVisible } from "./listing-state";
import { listingFeedReadiness } from "./listing-feed";

/** ok = ready (green); warn = actionable gap (amber); muted = intentional
 *  state, not an error (gray, e.g. a leased link or a not-live feed row). */
export type ReadinessTone = "ok" | "warn" | "muted";

export type ReadinessSignal = {
  key: "link" | "photos" | "viewings" | "feed";
  /** Column label, e.g. "Link". */
  label: string;
  /** True only when the signal is fully satisfied (green). */
  ok: boolean;
  tone: ReadinessTone;
  /** Short value shown in the chip, e.g. "live", "4", "in feed", "not live". */
  detail: string;
  /** Tooltip / a11y guidance explaining the state and what to do. */
  hint: string;
};

export type RentalReadinessInput = {
  status: string;
  rentCents: number | null;
  beds: number | null;
  baths: number | null;
  address: string | null;
  description: string | null;
  photoCount: number;
  /** Org-wide weekly viewing windows (one number for the whole org). */
  availabilityWindowCount: number;
};

// Friendly names for the feed-required fields listingFeedReadiness reports.
const FEED_FIELD_LABEL: Record<string, string> = {
  price: "rent",
  photo: "a photo",
  description: "a description",
  address: "an address",
};

function linkSignal(status: string): ReadinessSignal {
  if (isPublicBookable(status)) {
    return {
      key: "link",
      label: "Link",
      ok: true,
      tone: "ok",
      detail: "live",
      hint: "The public inquiry page is live — renters can view it, inquire, and book a viewing.",
    };
  }
  if (isPubliclyVisible(status)) {
    // leased / paused: the /r page LOADS but shows "not available".
    const word = status === "leased" ? "Leased" : "Paused";
    return {
      key: "link",
      label: "Link",
      ok: false,
      tone: "muted",
      detail: status === "leased" ? "leased" : "paused",
      hint: `${word} — the public page still loads but tells renters the unit is not currently available, so it can't take inquiries.`,
    };
  }
  // draft / off_market: the public link 404s.
  return {
    key: "link",
    label: "Link",
    ok: false,
    tone: "muted",
    detail: "not live",
    hint: "Set the rental Live so its public inquiry page works and you can share the link.",
  };
}

function photosSignal(photoCount: number): ReadinessSignal {
  if (photoCount > 0) {
    return {
      key: "photos",
      label: "Photos",
      ok: true,
      tone: "ok",
      detail: String(photoCount),
      hint:
        photoCount === 1
          ? "1 photo added."
          : `${photoCount} photos added.`,
    };
  }
  return {
    key: "photos",
    label: "Photos",
    ok: false,
    tone: "warn",
    detail: "none",
    hint: "Add at least one photo — listings with photos get far more inquiries (and a photo is required to syndicate to the feed).",
  };
}

function viewingsSignal(windowCount: number): ReadinessSignal {
  if (windowCount > 0) {
    return {
      key: "viewings",
      label: "Viewings",
      ok: true,
      tone: "ok",
      detail: "set",
      hint: "Weekly viewing windows are set, so renters can self-book a viewing online.",
    };
  }
  return {
    key: "viewings",
    label: "Viewings",
    ok: false,
    tone: "warn",
    detail: "none",
    hint: "Set weekly viewing windows under Leasing → Availability so renters can self-book a viewing once they land on the page.",
  };
}

// Exported so the listing-marketing kit (S388) can show the same "is this
// rental in the aggregator feed" status the rentals list shows, from the one
// source of truth (the list, the detail kit, and the feed RPC never disagree).
export function feedSignal(input: RentalReadinessInput): ReadinessSignal {
  // Only Live (available) rentals syndicate — mirror the feed RPC's status gate
  // (FEED_LISTABLE_STATUS). A leased/paused/draft rental is intentionally NOT
  // in the feed, so report it as a muted state, not an error.
  if (!isPublicBookable(input.status)) {
    return {
      key: "feed",
      label: "Feed",
      ok: false,
      tone: "muted",
      detail: "not live",
      hint: "Only Live rentals syndicate to the listing feed. Set it Live to include it.",
    };
  }
  const readiness = listingFeedReadiness({
    id: "row",
    address: input.address,
    rent_cents: input.rentCents,
    beds: input.beds,
    baths: input.baths,
    description: input.description,
    photos: input.photoCount > 0 ? new Array(input.photoCount).fill("x") : [],
  });
  if (readiness.ready) {
    return {
      key: "feed",
      label: "Feed",
      ok: true,
      tone: "ok",
      detail: "in feed",
      hint: "Syndicating to your listing feed for rental aggregators.",
    };
  }
  const missingNames = readiness.missing.map((m) => FEED_FIELD_LABEL[m] ?? m);
  return {
    key: "feed",
    label: "Feed",
    ok: false,
    tone: "warn",
    detail: "blocked",
    hint: `Not syndicating yet — add ${missingNames.join(", ")} so this rental can go out to aggregators.`,
  };
}

/**
 * Compute the four readiness signals for one rental row, in display order
 * (link, photos, viewings, feed).
 */
export function rentalRowReadiness(
  input: RentalReadinessInput,
): ReadinessSignal[] {
  return [
    linkSignal(input.status),
    photosSignal(input.photoCount),
    viewingsSignal(input.availabilityWindowCount),
    feedSignal(input),
  ];
}
