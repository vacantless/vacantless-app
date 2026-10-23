// S734 (review item 3): which site brought each renter, shown on the rental
// itself. Before S734 the answer lived only on Reports ("Where renters come
// from"), so a landlord looking at a rental saw "11 inquiries" and no site.
// Pure: the same lead rows and the same grouping Reports uses, so the two
// never disagree.
import { buildChannelReport, UNKNOWN_SOURCE, type LeadLite } from "./reports";
import { buildPostingAdvice, groupBySite, type Advice, type SiteStats } from "./posting-advice";

export type RenterSourceRow = SiteStats & { share: number };

export type RenterSources = {
  total: number;
  rows: RenterSourceRow[];
  /** Renters whose site we cannot name ("website", email, direct). */
  unnamed: number;
  advice: Advice | null;
};

const UNNAMED_LABEL = "Your Vacantless page link";

function isUnnamedSite(site: string): boolean {
  const s = site.toLowerCase();
  return s === "website" || s === "email" || s === "direct" || s === "screenshot" || s === UNKNOWN_SOURCE.toLowerCase();
}

/**
 * Sites by renter count for one rental. Unnamed sources (the renter opened
 * the Vacantless page link itself) are folded into one row at the end, named
 * for what they are, never shown as a site.
 */
export function renterSourcesForRental(leads: readonly LeadLite[]): RenterSources {
  const total = leads.length;
  if (total === 0) return { total: 0, rows: [], unnamed: 0, advice: null };
  const sites = groupBySite(buildChannelReport([...leads]));
  const named = sites.filter((s) => !isUnnamedSite(s.site));
  const unnamed = total - named.reduce((n, s) => n + s.enquiries, 0);
  const rows: RenterSourceRow[] = named
    .sort((a, b) => b.enquiries - a.enquiries || b.booked - a.booked || a.site.localeCompare(b.site))
    .map((s) => ({ ...s, share: Math.round((s.enquiries / total) * 100) }));
  if (unnamed > 0) {
    rows.push({ site: UNNAMED_LABEL, enquiries: unnamed, booked: sites.filter((s) => isUnnamedSite(s.site)).reduce((n, s) => n + s.booked, 0), share: Math.round((unnamed / total) * 100) });
  }
  const advice = buildPostingAdvice(buildChannelReport([...leads]))[0] ?? null;
  return { total, rows, unnamed, advice };
}

/** "Facebook Marketplace 53 · Rentals.ca 9 · Kijiji 4" for a chip line. */
export function renterSourcesSummary(sources: RenterSources, max = 4): string {
  return sources.rows
    .slice(0, max)
    .map((r) => `${r.site} ${r.enquiries}`)
    .join(" · ");
}
