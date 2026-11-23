// S818c: what each rental site costs you. Noam 2026-11-18: "for a landlord we
// need to understand where to spend our marketing dollars ... which to boost or
// spend money on between our channels". Pure: the same channel rows Reports
// shows, plus what the landlord paid each site in the window, gives cost per
// renter and per booked viewing, and one plain line of advice per site that
// cost money. Nothing is guessed: no cost entered means no cost shown.
import { sourceLabelForPost, PORTALS, isPortalKey, type PortalKey } from "./listing-distribution";
import { siteOf } from "./posting-advice";
import type { ChannelRow } from "./reports";

/** Sites a landlord pays for, in the order the "Add what you paid" list shows. */
export const COST_SITE_KEYS: PortalKey[] = ["kijiji", "facebook", "rentals_ca", "zumper", "viewit", "rentfaster", "other"];

export const COST_SITE_OPTIONS = COST_SITE_KEYS.map((key) => ({
  key,
  label: key === "facebook" ? "Facebook (Marketplace or boost)" : (PORTALS.find((p) => p.key === key)?.label ?? key),
}));

export type CostLite = { portal: string; amount_cents: number; spent_on: string; label?: string | null };

/** The site a cost belongs to, named the way renters' sources are. */
export function costSite(c: { portal: string; label?: string | null }): string {
  if (!isPortalKey(c.portal)) return "Other";
  if (c.portal === "other") return (c.label ?? "").trim() || "Other";
  return sourceLabelForPost({ portal: c.portal });
}

export type SiteCostRow = {
  site: string;
  renters: number;
  booked: number;
  showed: number;
  leased: number;
  spentCents: number;
  perRenterCents: number | null;
  perBookedCents: number | null;
};

const UNNAMED = new Set(["website", "email", "direct", "direct / unknown", "screenshot"]);

/** One row per site: renters and viewings from the leads, money from the costs. */
export function buildSiteCosts(channels: readonly ChannelRow[], costs: readonly CostLite[]): SiteCostRow[] {
  const map = new Map<string, SiteCostRow>();
  const row = (site: string) => {
    let r = map.get(site);
    if (!r) {
      r = { site, renters: 0, booked: 0, showed: 0, leased: 0, spentCents: 0, perRenterCents: null, perBookedCents: null };
      map.set(site, r);
    }
    return r;
  };
  for (const c of channels) {
    const site = siteOf(c.source);
    if (UNNAMED.has(site.toLowerCase())) continue;
    const r = row(site);
    r.renters += c.leads;
    r.booked += c.booked;
    r.showed += c.showed;
    r.leased += c.leased;
  }
  for (const c of costs) {
    const cents = Math.max(0, Math.round(c.amount_cents || 0));
    if (!cents) continue;
    row(costSite(c)).spentCents += cents;
  }
  const rows = [...map.values()];
  for (const r of rows) {
    if (r.spentCents > 0) {
      r.perRenterCents = r.renters > 0 ? Math.round(r.spentCents / r.renters) : null;
      r.perBookedCents = r.booked > 0 ? Math.round(r.spentCents / r.booked) : null;
    }
  }
  return rows.sort((a, b) => b.booked - a.booked || b.renters - a.renters || b.spentCents - a.spentCents || a.site.localeCompare(b.site));
}

export function dollars(cents: number): string {
  const whole = Math.floor(cents / 100);
  const rest = cents % 100;
  const withCommas = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return rest ? `$${withCommas}.${String(rest).padStart(2, "0")}` : `$${withCommas}`;
}

export type CostAdvice = { tone: "good" | "fix"; text: string };

/** The first day each site was paid in these costs, by site name. Pure. */
export function firstPaidBySite(costs: readonly CostLite[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of costs) {
    if (!(c.amount_cents > 0)) continue;
    const site = costSite(c);
    if (!out[site] || c.spent_on < out[site]) out[site] = c.spent_on;
  }
  return out;
}

/** A paid site younger than this is not judged yet. */
export const TOO_EARLY_DAYS = 14;

export type CostAdviceOptions = {
  /** S836b: the landlord books each viewing (no booked viewings in the app), so judge by renters. */
  viewingsByRequest?: boolean;
  /** S836b: with today, a site first paid under TOO_EARLY_DAYS ago is "too early to judge". */
  firstPaid?: Record<string, string>;
  today?: string;
};

function daysSince(day: string, today: string): number {
  return Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86400000));
}
const renterWord = (n: number) => (n === 1 ? "1 renter" : `${n} renters`);

/**
 * Plain lines: a paid site with no viewings, and the cheapest viewing. When the
 * landlord books viewings themselves the same lines use renters instead, and a
 * site paid in the last two weeks is called too early to judge.
 */
export function buildCostAdvice(rows: readonly SiteCostRow[], opts: CostAdviceOptions = {}): CostAdvice[] {
  const out: CostAdvice[] = [];
  const byRenter = opts.viewingsByRequest === true;
  const early = new Set<string>();
  for (const r of rows) {
    if (!(r.spentCents > 0)) continue;
    const first = opts.firstPaid?.[r.site];
    if (first && opts.today) {
      const d = daysSince(first, opts.today);
      if (d < TOO_EARLY_DAYS) {
        early.add(r.site);
        out.push({
          tone: "good",
          text: `You paid ${dollars(r.spentCents)} to ${r.site} ${d === 0 ? "today" : d === 1 ? "1 day ago" : `${d} days ago`}. Too early to judge; ${renterWord(r.renters)} so far.`,
        });
        continue;
      }
    }
    if (byRenter ? r.renters === 0 : r.booked === 0) {
      out.push({
        tone: "fix",
        text: byRenter
          ? `You paid ${dollars(r.spentCents)} to ${r.site} and got no renters. Try it free, or stop paying for it, before the next rental.`
          : `You paid ${dollars(r.spentCents)} to ${r.site} and got ${renterWord(r.renters)} and no booked viewings. Try it free, or stop paying for it, before the next rental.`,
      });
    }
  }
  if (byRenter) {
    const free = rows.filter((r) => r.spentCents === 0 && r.renters > 0).sort((a, b) => b.renters - a.renters)[0];
    const paid = rows
      .filter((r) => r.perRenterCents != null && !early.has(r.site))
      .sort((a, b) => (a.perRenterCents ?? 0) - (b.perRenterCents ?? 0))[0];
    if (free) out.push({ tone: "good", text: `${free.site} cost you nothing and brought ${renterWord(free.renters)}.` });
    if (paid) out.push({ tone: "good", text: `Your cheapest paid renter: ${paid.site}, ${dollars(paid.perRenterCents ?? 0)} per renter.` });
    return out;
  }
  const booked = rows.filter((r) => r.booked > 0);
  const free = booked.filter((r) => r.spentCents === 0).sort((a, b) => b.booked - a.booked)[0];
  const paid = booked.filter((r) => r.perBookedCents != null && !early.has(r.site)).sort((a, b) => (a.perBookedCents ?? 0) - (b.perBookedCents ?? 0))[0];
  if (free) {
    out.push({ tone: "good", text: `${free.site} cost you nothing and brought ${free.booked === 1 ? "1 booked viewing" : `${free.booked} booked viewings`}.` });
  }
  if (paid) {
    out.push({ tone: "good", text: `Your cheapest paid viewing: ${paid.site}, ${dollars(paid.perBookedCents ?? 0)} per booked viewing.` });
  }
  return out;
}

/** "$33.84" or "33.84" or "33" to cents; null when it is not money. */
export function parseDollarsToCents(raw: string): number | null {
  const s = (raw ?? "").replace(/[$,\s]/g, "");
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  return cents > 0 ? cents : null;
}
