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

// ----------------------------------------------------------------------------
// S835i: how far down the homepage people get (Noam 2026-11-23, after the page
// was shortened: measure before changing the layout again). The homepage tells
// the server each section a browser brought into view; the admin console shows
// how many browsers reached each one. Order here is the order on the page.
// ----------------------------------------------------------------------------

export const HOME_SECTIONS: readonly { id: string; label: string }[] = [
  { id: "top", label: "Top of the page" },
  { id: "stop-doing", label: "What you stop doing" },
  { id: "what-it-replaces", label: "What it replaces" },
  { id: "video", label: "See it work" },
  { id: "leasing", label: "It already runs on our own rentals" },
  { id: "automations", label: "Then it runs the rest" },
  { id: "less-typing", label: "Less typing. Brighter photos." },
  { id: "how", label: "Set up in one sitting" },
  { id: "little-things", label: "Little things" },
  { id: "pricing", label: "Pricing" },
  { id: "about", label: "Why we built it" },
  { id: "questions", label: "Questions" },
  { id: "closing", label: "The last button" },
];

/** The first day section counting ran, for the note on the admin console. */
export const SECTION_COUNT_STARTED = "2026-11-23";

const HOME_SECTION_IDS = new Set(HOME_SECTIONS.map((s) => s.id));

/** The section ids we know, from a comma list sent by the page; unknown ones dropped, no repeats. */
export function cleanSections(v: string | null | undefined): string[] {
  const out: string[] = [];
  for (const part of (v ?? "").split(",")) {
    const id = part.trim();
    if (HOME_SECTION_IDS.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

export type SectionReach = {
  id: string;
  label: string;
  /** Browsers that got this far. */
  count: number;
  /** Share of the browsers that loaded the page, 0 to 100; null when nobody did. */
  pct: number | null;
};

/**
 * A browser that saw a later section got past the earlier ones, even when a
 * fast scroll or a jump link skipped their beacons. So a browser's reach is
 * its furthest section, and every section up to it counts.
 */
export function sectionReach(rows: readonly { visitor: string; section: string }[]): SectionReach[] {
  const furthest = new Map<string, number>();
  for (const r of rows) {
    const i = HOME_SECTIONS.findIndex((s) => s.id === r.section);
    if (i < 0) continue;
    furthest.set(r.visitor, Math.max(furthest.get(r.visitor) ?? 0, i));
  }
  const total = furthest.size;
  return HOME_SECTIONS.map((s, i) => {
    let count = 0;
    for (const f of furthest.values()) if (f >= i) count++;
    return { id: s.id, label: s.label, count, pct: total ? Math.round((count / total) * 100) : null };
  });
}

/** One plain line: the section where half the visitors are gone. Null with too few visitors to say. */
export function halfwayLine(reach: readonly SectionReach[]): string | null {
  const total = reach[0]?.count ?? 0;
  if (total < 20) return null;
  const lost = reach.find((r) => (r.pct ?? 100) < 50);
  return lost
    ? `Half of visitors are gone before "${lost.label}".`
    : "More than half of visitors reach the bottom of the page.";
}
