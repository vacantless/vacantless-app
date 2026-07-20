// ============================================================================
// Pure helpers for the lead-detail page (enrichment).
// No DOM / env / IO — fully unit-testable (see scripts/test-lead-detail.ts).
//
// Three concerns:
//   1. resolveLeadSource — turn a lead's source / source_detail (+ the optional
//      joined listing_post) into a display label + an openable ad URL, so the
//      page can show "via Kijiji" linking to the real ad. Completes the S187
//      per-portal source-tracking loop on the read side.
//   2. follow-up — interpret leads.next_action_at relative to "today" so the
//      page + the leads list can flag overdue / due-today / upcoming follow-ups
//      (the Learning-Audit follow-up-discipline gap).
//   3. suggestedNextStages — the small set of one-click forward stage moves for
//      the quick-stage buttons (a fast path over the full status dropdown).
// ============================================================================

import { portalLabel, normalizeUrl, normalizeText, normalizeDate } from "./listing-distribution";
import {
  PIPELINE_STAGES,
  statusLabel,
  type LeadStatus,
} from "./pipeline";

// Re-export the normalizers the lead actions reuse, so callers import one place.
export { normalizeText, normalizeDate };

// --- source display --------------------------------------------------------

export type LeadSourceDisplay = {
  /** Human label, e.g. "Kijiji", "Facebook Marketplace", "Public rental page". */
  label: string;
  /** The ad URL to open, when we have one. */
  url: string | null;
};

// Friendly display labels for the bare internal source tokens the app itself
// writes. The public intake RPC stamps every self-serve inquiry with the literal
// 'website' source; surfaced raw it reads like a generic website, so map it to
// the page renters actually used — the org's public rental page. Matched
// case-insensitively; unknown sources fall through to their own text.
const FRIENDLY_SOURCE_LABELS: Record<string, string> = {
  website: "Public rental page",
  vacantless_network: "Vacantless network",
};

type JoinedPost = {
  portal: string | null;
  label: string | null;
  url: string | null;
} | null;

/**
 * Resolve a lead's display source. Preference order:
 *   1. A joined listing_post (the S187 tracked attribution) — use its portal
 *      label (or its free-text label for "other") + its ad URL.
 *   2. The lead's own source / source_detail text. source_detail is often the
 *      ad URL captured at intake, so promote it to a link when it looks like one.
 * Returns null only when there is nothing at all to show.
 */
export function resolveLeadSource(input: {
  source: string | null;
  source_detail: string | null;
  post?: JoinedPost;
}): LeadSourceDisplay | null {
  const post = input.post ?? null;

  if (post && post.portal) {
    const label =
      post.portal === "other"
        ? normalizeText(post.label) ?? "Other portal"
        : portalLabel(post.portal);
    return { label, url: normalizeUrl(post.url) };
  }

  const label = normalizeText(input.source);
  const detail = normalizeText(input.source_detail);
  const detailUrl = detail ? normalizeUrl(detail) : null;
  const isUrl = detailUrl !== null && /^https?:\/\//i.test(detailUrl);

  if (label) {
    const friendly = FRIENDLY_SOURCE_LABELS[label.toLowerCase()] ?? label;
    return { label: friendly, url: isUrl ? detailUrl : null };
  }
  if (isUrl) {
    // No label but we have an ad URL — still useful.
    return { label: "Source link", url: detailUrl };
  }
  return null;
}

/** Operator badge for leads who tried to book but found no workable time. */
export function noSuitableTimeBadge(
  noSuitableTime: boolean | null | undefined,
): string | null {
  return noSuitableTime ? "Wanted to book — no suitable time" : null;
}

// --- follow-up / next action ----------------------------------------------

export type FollowUpStatus = "none" | "overdue" | "today" | "upcoming";

/** Parse a "YYYY-MM-DD" string to a UTC-midnight epoch day number, or null. */
function dayNumber(isoDate: string | null): number | null {
  const v = normalizeDate(isoDate);
  if (!v) return null;
  const ms = Date.parse(`${v}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / 86_400_000);
}

/**
 * Classify a follow-up date relative to `today` (also "YYYY-MM-DD").
 * Past = overdue, same day = today, future = upcoming, missing/invalid = none.
 */
export function followUpStatus(
  nextActionAt: string | null,
  today: string,
): FollowUpStatus {
  const due = dayNumber(nextActionAt);
  const now = dayNumber(today);
  if (due === null || now === null) return "none";
  if (due < now) return "overdue";
  if (due === now) return "today";
  return "upcoming";
}

/** Whole-day difference (due - today); null when either is missing/invalid. */
export function daysUntilFollowUp(
  nextActionAt: string | null,
  today: string,
): number | null {
  const due = dayNumber(nextActionAt);
  const now = dayNumber(today);
  if (due === null || now === null) return null;
  return due - now;
}

/**
 * Short human label for a follow-up date relative to today.
 * "Overdue by 2 days" / "Overdue by 1 day" / "Due today" / "Due tomorrow" /
 * "Due in 3 days" / "" when there is no follow-up.
 */
export function followUpLabel(
  nextActionAt: string | null,
  today: string,
): string {
  const diff = daysUntilFollowUp(nextActionAt, today);
  if (diff === null) return "";
  if (diff < 0) {
    const n = Math.abs(diff);
    return `Overdue by ${n} day${n === 1 ? "" : "s"}`;
  }
  if (diff === 0) return "Due today";
  if (diff === 1) return "Due tomorrow";
  return `Due in ${diff} days`;
}

// --- quick stage buttons ---------------------------------------------------

// For each stage, the small set of sensible one-click moves. Forward progress
// plus an always-available "lost"; terminal "leased" offers nothing; "lost"
// can be reopened to "new". Kept deliberately short so the buttons stay quick.
const NEXT_STAGES: Record<LeadStatus, LeadStatus[]> = {
  new: ["replied", "contacted", "lost"],
  replied: ["contacted", "booked", "lost"],
  contacted: ["booked", "lost"],
  booked: ["showed", "lost"],
  showed: ["applied", "lost"],
  applied: ["leased", "lost"],
  leased: [],
  lost: ["new"],
};

/** The suggested one-click stage moves from the current status. */
export function suggestedNextStages(current: string): LeadStatus[] {
  const key = (PIPELINE_STAGES as readonly string[]).includes(current)
    ? (current as LeadStatus)
    : null;
  return key ? NEXT_STAGES[key] : [];
}

/** Convenience: [{stage, label}] for rendering the quick-stage buttons. */
export function suggestedNextStageOptions(
  current: string,
): Array<{ stage: LeadStatus; label: string }> {
  return suggestedNextStages(current).map((stage) => ({
    stage,
    label: statusLabel(stage),
  }));
}

// --- early convert-to-tenancy affordance -----------------------------------

// Stages where a landlord might reasonably have signed (or decided on) a renter
// and want to create the tenancy right away — before manually walking the lead
// to Leased. These are the engaged, post-inquiry stages: a viewing is booked or
// done, or an application is in. Earlier stages (new/replied/contacted) are too
// speculative to offer a lease bridge, and "leased" already shows the full
// convert bridge, "lost" is dead.
const EARLY_TENANCY_STAGES = new Set<LeadStatus>(["booked", "showed", "applied"]);

/**
 * True when the lead is a viable open lead that should get a lighter-weight
 * "Ready to lease? Create tenancy" affordance, so the landlord doesn't have to
 * discover the stage dropdown and set Leased first (post-S402 pilot friction).
 * "leased" is handled by the primary convert bridge, so it's excluded here.
 */
export function canOfferEarlyTenancy(current: string): boolean {
  return (PIPELINE_STAGES as readonly string[]).includes(current)
    ? EARLY_TENANCY_STAGES.has(current as LeadStatus)
    : false;
}
