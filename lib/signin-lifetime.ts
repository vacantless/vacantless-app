// S838 (REVIEW-S837 1.2a): how long a robot-site sign-in lasts, from
// site_signin_events (written by the 0331 trigger). Pure; the admin console
// renders it. A lifetime is a "signed_in" followed by the next "lost" for the
// same account and site. Recording started 2026-11-23, so early numbers are thin.

export type SigninEvent = {
  organization_id: string;
  channel: string;
  event: "signed_in" | "lost";
  at: string;
};

export type SiteLifetime = {
  channel: string;
  /** Sign-ins that have ended, with how long each lasted. */
  ended: number;
  medianHours: number | null;
  shortestHours: number | null;
  longestHours: number | null;
  /** Losses with no recorded sign-in before them (signed in before recording began). */
  lostUnknownStart: number;
  /** Accounts whose latest event is a sign-in. */
  signedInNow: number;
};

export const SIGNIN_RECORDING_STARTED = "2026-11-23";

export const SIGNIN_SITE_ORDER = ["kijiji", "rentals_ca", "zumper"] as const;

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const round1 = (n: number | null) => (n == null ? null : Math.round(n * 10) / 10);

export function signinLifetimes(events: readonly SigninEvent[]): SiteLifetime[] {
  const byKey = new Map<string, SigninEvent[]>();
  for (const e of events) {
    if (e.event !== "signed_in" && e.event !== "lost") continue;
    if (Number.isNaN(Date.parse(e.at))) continue;
    const k = `${e.channel}::${e.organization_id}`;
    const list = byKey.get(k) ?? [];
    list.push(e);
    byKey.set(k, list);
  }
  const perSite = new Map<string, { hours: number[]; unknown: number; now: number }>();
  for (const [k, list] of byKey) {
    const channel = k.split("::")[0];
    const site = perSite.get(channel) ?? { hours: [], unknown: 0, now: 0 };
    list.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    let openAt: number | null = null;
    for (const e of list) {
      if (e.event === "signed_in") openAt = openAt ?? Date.parse(e.at);
      else {
        if (openAt == null) site.unknown++;
        else site.hours.push((Date.parse(e.at) - openAt) / 3_600_000);
        openAt = null;
      }
    }
    if (list[list.length - 1]?.event === "signed_in") site.now++;
    perSite.set(channel, site);
  }
  const channels = [
    ...SIGNIN_SITE_ORDER.filter((c) => perSite.has(c)),
    ...[...perSite.keys()].filter((c) => !(SIGNIN_SITE_ORDER as readonly string[]).includes(c)).sort(),
  ];
  return channels.map((channel) => {
    const s = perSite.get(channel)!;
    return {
      channel,
      ended: s.hours.length,
      medianHours: round1(median(s.hours)),
      shortestHours: round1(s.hours.length ? Math.min(...s.hours) : null),
      longestHours: round1(s.hours.length ? Math.max(...s.hours) : null),
      lostUnknownStart: s.unknown,
      signedInNow: s.now,
    };
  });
}

/** "about 2.5 days" for 60 h; hours under two days. */
export function lifetimeLabel(hours: number | null): string {
  if (hours == null) return "-";
  if (hours < 48) return `${Math.round(hours)} h`;
  return `${Math.round((hours / 24) * 10) / 10} days`;
}
