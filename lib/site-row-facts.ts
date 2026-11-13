// S786c: one line under each live site on the Get online tab: the renters
// that site brought, days left on the ad, and when we last saw it live.
// Before this a live row said only "On" and "View live ad"; renters sat in a
// separate card above and expiry and checks were not shown at all. Pure.

const SITE_PATTERN: Record<string, RegExp> = {
  kijiji: /kijiji/i,
  facebook: /marketplace/i,
  rentals_ca: /rentals\.ca/i,
  zumper: /zumper|padmapper/i,
  facebook_feed: /facebook page/i,
  instagram: /instagram/i,
  rentfaster: /rentfaster/i,
  viewit: /viewit/i,
};

/** Renters and viewings booked from one site, from the rental's renter-source rows. */
export function siteRenters(
  rows: readonly { site: string; enquiries: number; booked: number }[],
  channel: string,
): { renters: number; booked: number } {
  const re = SITE_PATTERN[channel];
  if (!re) return { renters: 0, booked: 0 };
  let renters = 0;
  let booked = 0;
  for (const r of rows) {
    if (!re.test(r.site)) continue;
    renters += r.enquiries;
    booked += r.booked;
  }
  return { renters, booked };
}

const DAY = 86400000;

export function daysLeftLine(expiresISO: string | null | undefined, now: Date): string | null {
  if (!expiresISO) return null;
  const t = new Date(expiresISO).getTime();
  if (Number.isNaN(t)) return null;
  const days = Math.ceil((t - now.getTime()) / DAY);
  if (days < 0) return null;
  if (days === 0) return "ends today";
  return days === 1 ? "1 day left" : `${days} days left`;
}

export function checkedLine(verifiedISO: string | null | undefined, now: Date): string | null {
  if (!verifiedISO) return null;
  const t = new Date(verifiedISO).getTime();
  if (Number.isNaN(t)) return null;
  const mins = Math.max(0, Math.round((now.getTime() - t) / 60000));
  if (mins < 60) return "seen live in the last hour";
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours === 1 ? "seen live 1 hour ago" : `seen live ${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "seen live yesterday" : `seen live ${days} days ago`;
}

/** "4 renters, 1 booked · 30 days left · seen live 2 hours ago", or null when there is nothing to say. */
export function siteRowFacts(input: {
  renters: number;
  booked: number;
  expiresAt?: string | null;
  verifiedAt?: string | null;
  now: Date;
}): string | null {
  const parts: string[] = [];
  const who =
    input.renters === 0
      ? "No renters yet"
      : `${input.renters === 1 ? "1 renter" : `${input.renters} renters`}${input.booked > 0 ? `, ${input.booked} booked` : ""}`;
  parts.push(who);
  const left = daysLeftLine(input.expiresAt, input.now);
  if (left) parts.push(left);
  const seen = checkedLine(input.verifiedAt, input.now);
  if (seen) parts.push(seen);
  return parts.join(" · ");
}

/** Small lettered mark per site, in place of emoji. */
export const SITE_MARK: Record<string, { text: string; cls: string }> = {
  facebook: { text: "M", cls: "bg-blue-600 text-white" },
  facebook_feed: { text: "f", cls: "bg-blue-700 text-white" },
  kijiji: { text: "K", cls: "bg-indigo-700 text-white" },
  rentals_ca: { text: "R", cls: "bg-rose-600 text-white" },
  zumper: { text: "Z", cls: "bg-sky-500 text-white" },
  instagram: { text: "IG", cls: "bg-pink-600 text-white" },
  realtor_ca: { text: "R", cls: "bg-red-700 text-white" },
  rentfaster: { text: "RF", cls: "bg-orange-500 text-white" },
  viewit: { text: "V", cls: "bg-teal-600 text-white" },
  linkedin: { text: "in", cls: "bg-sky-700 text-white" },
  whatsapp: { text: "W", cls: "bg-emerald-600 text-white" },
  snapchat: { text: "S", cls: "bg-yellow-400 text-gray-900" },
};

export function siteMark(key: string, label?: string): { text: string; cls: string } {
  return SITE_MARK[key] ?? { text: (label ?? key).trim().charAt(0).toUpperCase() || "•", cls: "bg-gray-200 text-gray-700" };
}
