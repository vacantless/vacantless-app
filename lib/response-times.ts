// S838: how fast renters heard back and how soon they got a viewing, for the
// monthly rental report and the account summary (Noam's ask, 2026-11-23).
// Pure; scripts/test-s838-response-times.ts.
//
// A reply counts only when Vacantless sent it (the first outbound email or
// text in messages). Marketplace chats are answered in Messenger, which
// Vacantless never sees, so those renters are reported as "not timed", never
// folded into an average. For a renter saved from a Marketplace screenshot the
// clock starts when the chat was saved, not when they first wrote; the
// viewing line says so whenever such a renter is in it.

export type TimedLead = {
  source: string | null;
  createdAt: string;
  /** First outbound email or text Vacantless sent this renter. */
  firstReplyAt: string | null;
  /** When their first viewing was booked (showings.created_at). */
  firstBookedAt: string | null;
  /** When their first viewing was for (showings.scheduled_at). */
  firstViewingAt: string | null;
};

export type ResponseFacts = {
  renters: number;
  replied: number;
  withinMinute: number;
  medianReplySeconds: number | null;
  notTimed: number;
  notTimedMarketplace: number;
  booked: number;
  medianToBookHours: number | null;
  medianToViewingHours: number | null;
  bookedIncludesMarketplace: boolean;
};

export function isMarketplaceSource(source: string | null | undefined): boolean {
  return /marketplace|messenger/i.test(source ?? "");
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function gapSeconds(from: string, to: string | null): number | null {
  if (!to) return null;
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, (b - a) / 1000);
}

export function responseFacts(leads: readonly TimedLead[]): ResponseFacts {
  const replies: number[] = [];
  let notTimed = 0;
  let notTimedMarketplace = 0;
  const toBook: number[] = [];
  const toView: number[] = [];
  let bookedIncludesMarketplace = false;
  for (const l of leads) {
    const r = gapSeconds(l.createdAt, l.firstReplyAt);
    if (r == null) {
      notTimed++;
      if (isMarketplaceSource(l.source)) notTimedMarketplace++;
    } else replies.push(r);
    const b = gapSeconds(l.createdAt, l.firstBookedAt);
    if (b != null) {
      toBook.push(b / 3600);
      const v = gapSeconds(l.createdAt, l.firstViewingAt);
      if (v != null) toView.push(v / 3600);
      if (isMarketplaceSource(l.source)) bookedIncludesMarketplace = true;
    }
  }
  return {
    renters: leads.length,
    replied: replies.length,
    withinMinute: replies.filter((s) => s <= 60).length,
    medianReplySeconds: median(replies),
    notTimed,
    notTimedMarketplace,
    booked: toBook.length,
    medianToBookHours: median(toBook),
    medianToViewingHours: median(toView),
    bookedIncludesMarketplace,
  };
}

/** "3 seconds", "4 minutes", "5 hours", "2 days". */
export function durationWords(seconds: number): string {
  const n = (v: number, unit: string) => `${v} ${unit}${v === 1 ? "" : "s"}`;
  if (seconds < 90) return n(Math.max(1, Math.round(seconds)), "second");
  if (seconds < 59.5 * 60) return n(Math.round(seconds / 60), "minute");
  if (seconds < 48 * 3600) return n(Math.round(seconds / 3600), "hour");
  return n(Math.round(seconds / 86400), "day");
}

/** Plain sentences; empty when there is nothing to time. */
export function responseLines(f: ResponseFacts): string[] {
  const out: string[] = [];
  if (f.renters === 0) return out;
  if (f.replied > 0) {
    const all = f.replied === f.renters;
    const who = all ? (f.renters === 1 ? "The renter" : `All ${f.renters} renters`) : `${f.replied} of ${f.renters} renters`;
    const fast =
      f.withinMinute === f.replied
        ? `within a minute (typically ${durationWords(f.medianReplySeconds ?? 0)})`
        : `, ${f.withinMinute} of them within a minute (typically ${durationWords(f.medianReplySeconds ?? 0)})`;
    out.push(`Response time: ${who} got a reply from Vacantless${fast.startsWith(",") ? "" : " "}${fast}.`);
  }
  if (f.notTimed > 0) {
    const n = f.notTimed;
    const pre = f.replied > 0 ? `The other ${n}` : `${n === 1 ? "This renter" : `These ${n} renters`}`;
    out.push(
      f.notTimedMarketplace === n
        ? `${pre} ${n === 1 ? "is a Marketplace chat" : "are Marketplace chats"}, answered in Messenger, which Vacantless cannot time.`
        : `${pre} had no reply sent through Vacantless. Marketplace chats are answered in Messenger and are not timed.`,
    );
  }
  if (f.booked > 0 && f.medianToBookHours != null) {
    let line = `${f.booked} ${f.booked === 1 ? "renter" : "renters"} booked a viewing, typically ${durationWords(f.medianToBookHours * 3600)} after first asking`;
    if (f.medianToViewingHours != null) line += `, for a viewing ${durationWords(f.medianToViewingHours * 3600)} after asking`;
    line += ".";
    if (f.bookedIncludesMarketplace) line += " For Marketplace renters the clock starts when the chat was saved to Vacantless.";
    out.push(line);
  }
  return out;
}
