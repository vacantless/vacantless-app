// ============================================================================
// Stranger funnel (S800, REVIEW-S799 item 8). Pure: how many people reached
// each step of the path from the homepage to a first renter, and how many
// were lost at each step. Read on the admin console before any ad money.
// Tested in scripts/test-stranger-funnel.ts.
// ============================================================================

import type { AccountCounts } from "@/lib/new-account-watch";

export const FUNNEL_DAYS = 30;

export type FunnelStep = {
  label: string;
  count: number;
  /** Share of the step above that reached this one, 0 to 100; null on the first step or when the step above is 0. */
  keptPct: number | null;
};

/** Distinct browsers per page over the window (one browser counts once however many days it came). */
export function distinctVisitors(
  rows: readonly { visitor: string; page: string }[],
  page: "home" | "signup",
): number {
  return new Set(rows.filter((r) => r.page === page).map((r) => r.visitor)).size;
}

/**
 * accounts: outside accounts made in the window (ours already left out).
 * A step counts accounts that reached at least that far, so the numbers
 * never go up as you read down.
 */
export function buildFunnel(input: {
  homeVisitors: number;
  signupVisitors: number;
  accounts: readonly AccountCounts[];
}): FunnelStep[] {
  const a = input.accounts.filter((x) => !x.closedAt);
  const made = input.accounts.length;
  const rental = a.filter((x) => x.rentals > 0).length;
  const live = a.filter((x) => x.liveRentals > 0 || !!x.firstLiveAt).length;
  const renter = a.filter(
    (x) => (x.liveRentals > 0 || !!x.firstLiveAt) && (x.enquiries > 0 || x.bookings > 0),
  ).length;
  const raw: [string, number][] = [
    ["Visited the homepage", input.homeVisitors],
    ["Opened the sign-up page", input.signupVisitors],
    ["Made an account", made],
    ["Added a rental", rental],
    ["Set a rental live", live],
    ["Got a first renter", renter],
  ];
  return raw.map(([label, count], i) => {
    const above = i === 0 ? null : raw[i - 1][1];
    const keptPct = above == null || above === 0 ? null : Math.round((count / above) * 100);
    return { label, count, keptPct };
  });
}

/** The biggest loss between two steps, for one line under the table. Null when nothing to say. */
export function biggestDrop(steps: readonly FunnelStep[]): string | null {
  let worst: { from: string; to: string; lost: number } | null = null;
  for (let i = 1; i < steps.length; i++) {
    const lost = steps[i - 1].count - steps[i].count;
    if (lost > 0 && (!worst || lost > worst.lost)) {
      worst = { from: steps[i - 1].label, to: steps[i].label, lost };
    }
  }
  return worst ? `Most people are lost between "${worst.from}" and "${worst.to}" (${worst.lost}).` : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A browser id we made ourselves, or null. */
export function cleanVisitor(v: string | null | undefined): string | null {
  const s = (v ?? "").trim().toLowerCase();
  return UUID_RE.test(s) ? s : null;
}

export function cleanPage(v: unknown): "home" | "signup" | null {
  return v === "home" || v === "signup" ? v : null;
}

/** Crawlers and link previews are not people. */
export function isBot(userAgent: string | null | undefined): boolean {
  const ua = (userAgent ?? "").toLowerCase();
  if (!ua) return true;
  return /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse|python|curl|wget/.test(ua);
}
