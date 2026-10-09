// page-weekly-posts.ts (S702i). Which rentals get a fresh post on the
// landlord's Facebook Page this run.
//
// Facebook lets an app post to a Page the landlord connected, but not renew a
// Marketplace ad. So the fully automatic option is a weekly Page post for each
// open rental. A rental is due when its newest Page post is 7 or more days old,
// or it has none. Pure so it can be unit tested.

export const PAGE_REPOST_DAYS = 7;
/** A cap per org per run, so a big portfolio does not flood its own Page. */
export const PAGE_REPOST_MAX_PER_RUN = 10;

export type PageRepostProperty = {
  id: string;
  status: string | null;
  archivedAt: string | null;
};

export type PageRepostPost = {
  propertyId: string;
  status: string | null;
  postedOn: string | null; // YYYY-MM-DD
  createdAt: string | null; // ISO
};

function dayOf(p: PageRepostPost): string | null {
  if (p.postedOn) return p.postedOn.slice(0, 10);
  if (p.createdAt) return p.createdAt.slice(0, 10);
  return null;
}

function daysBetween(fromYmd: string, toYmd: string): number {
  const a = Date.parse(`${fromYmd}T12:00:00Z`);
  const b = Date.parse(`${toYmd}T12:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function duePageReposts(args: {
  properties: PageRepostProperty[];
  posts: PageRepostPost[];
  today: string; // YYYY-MM-DD in the org's timezone
  intervalDays?: number;
  max?: number;
}): string[] {
  const interval = args.intervalDays ?? PAGE_REPOST_DAYS;
  const max = args.max ?? PAGE_REPOST_MAX_PER_RUN;
  const newest = new Map<string, string>();
  for (const post of args.posts) {
    if (post.status === "removed") continue;
    const d = dayOf(post);
    if (!d) continue;
    const prev = newest.get(post.propertyId);
    if (!prev || d > prev) newest.set(post.propertyId, d);
  }
  const due: { id: string; last: string | null }[] = [];
  for (const p of args.properties) {
    if (p.status !== "available" || p.archivedAt) continue;
    const last = newest.get(p.id) ?? null;
    if (last && daysBetween(last, args.today) < interval) continue;
    due.push({ id: p.id, last });
  }
  // Never-posted first, then the oldest post first.
  due.sort((a, b) => {
    if (a.last === b.last) return 0;
    if (a.last === null) return -1;
    if (b.last === null) return 1;
    return a.last < b.last ? -1 : 1;
  });
  return due.slice(0, max).map((d) => d.id);
}
