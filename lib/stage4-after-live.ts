import type { AfterLiveSummary } from "./after-live-summary";

// ============================================================================
// Stage 4 "After it is live" — pure view logic (S585).
// No DOM / IO — unit-testable (scripts/test-stage4-after-live.ts).
// Reads the S581 AfterLiveSummary read-model; adds only presentation mapping.
// ============================================================================

export type Stage4BadgeKey = "badgeLive" | "badgeRemoving" | "badgeRemoved";

// Map a channel's take-down state to its badge catalog key. Only LIVE / REMOVED
// come from real listing_posts data today (takenDown = status "removed", rule 16).
// REMOVING is reserved for a future in-flight take-down state and is never
// fabricated here.
export function stage4BadgeKey(takenDown: boolean): Stage4BadgeKey {
  return takenDown ? "badgeRemoved" : "badgeLive";
}

// True when there is real after-live activity to show (any lead or any tracked
// channel). Null / empty -> the screen leans on its explainer copy.
export function afterLiveHasActivity(summary: AfterLiveSummary | null): boolean {
  return Boolean(
    summary && (summary.leads.length > 0 || summary.channels.length > 0),
  );
}
