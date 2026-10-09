// posting-advice.ts (S702). Plain advice on where to post, from where this
// landlord's own renters came from and which of them booked a viewing.
// Pure and rule based, so every line can be checked against the numbers on
// the Reports page. Nothing is guessed: with too little data, no advice.
import { UNKNOWN_SOURCE, type ChannelRow } from "./reports";

export const ADVICE_MIN_ENQUIRIES = 5;

/** Sites a landlord in Canada can post on for free. */
const FREE_SITES = ["Kijiji", "Facebook Marketplace"] as const;

/** Sources that do not name a site the renter came from. */
const UNNAMED = new Set(["website", "email", "direct", UNKNOWN_SOURCE.toLowerCase(), "screenshot"]);

/** "Kijiji (email)" and "Kijiji" count as one site. */
export function siteOf(source: string): string {
  return source.replace(/\s*\((email|screenshot)\)\s*$/i, "").trim() || UNKNOWN_SOURCE;
}

function isNamed(site: string): boolean {
  return !UNNAMED.has(site.toLowerCase());
}

export type SiteStats = { site: string; enquiries: number; booked: number };

export function groupBySite(rows: ChannelRow[]): SiteStats[] {
  const map = new Map<string, SiteStats>();
  for (const r of rows) {
    const site = siteOf(r.source);
    const cur = map.get(site) ?? { site, enquiries: 0, booked: 0 };
    cur.enquiries += r.leads;
    cur.booked += r.booked;
    map.set(site, cur);
  }
  return [...map.values()].sort((a, b) => b.booked - a.booked || b.enquiries - a.enquiries);
}

export type Advice = { tone: "good" | "fix" | "try"; text: string };

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function buildPostingAdvice(rows: ChannelRow[]): Advice[] {
  const sites = groupBySite(rows);
  const total = sites.reduce((n, s) => n + s.enquiries, 0);
  if (total < ADVICE_MIN_ENQUIRIES) return [];
  const named = sites.filter((s) => isNamed(s.site));
  const unnamedCount = total - named.reduce((n, s) => n + s.enquiries, 0);
  const out: Advice[] = [];

  const best = named.find((s) => s.booked >= 2);
  if (best) {
    out.push({
      tone: "good",
      text: `${best.site} brings you the most booked viewings: ${best.booked} from ${plural(best.enquiries, "enquiry", "enquiries")}. Keep that ad fresh.`,
    });
  }

  const dud = named
    .filter((s) => s.enquiries >= 5 && s.booked === 0 && s !== best)
    .sort((a, b) => b.enquiries - a.enquiries)[0];
  if (dud) {
    out.push({
      tone: "fix",
      text: `${dud.site} sent ${plural(dud.enquiries, "enquiry", "enquiries")} but no bookings. Check the price and photos on that ad. Make sure your ad links to your booking page.`,
    });
  }

  if (unnamedCount / total >= 0.5) {
    out.push({
      tone: "fix",
      text: `For ${Math.round((unnamedCount / total) * 100)}% of your renters we cannot tell which site sent them. When you post an ad, paste the link we give you for that site. Then we can tell you which site works.`,
    });
  }

  const missing = FREE_SITES.filter((f) => !named.some((s) => s.site.toLowerCase().startsWith(f.toLowerCase())));
  if (missing.length > 0) {
    out.push({
      tone: "try",
      text: `No renters came from ${missing.join(" or ")} yet. ${missing.length === 1 ? "It is" : "They are"} free, and many renters in Canada look there.`,
    });
  }

  return out.slice(0, 3);
}
