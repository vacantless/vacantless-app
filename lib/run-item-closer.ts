// S728: bookkeeping for distribution_run_items that can never finish.
//
// Two kinds sat open for months and the freshness sweep re-flagged them every
// fifteen minutes (833 Pillette Unit 20, leased in September, still "live"
// on two sites in the app; Unit 30's August sign-in items):
//   1. an item still "live" or "submitted" on a unit that is no longer on the
//      market, whose own listing post is already expired or removed (the ad
//      is gone; the item just never heard). An available unit is left alone:
//      its live check decides, and a Rentals.ca re-post can outlive an old
//      expired record (Pillette 3 and 33, 2026-10-20);
//   2. an item waiting on a person (needs_login, needs_payment, needs_operator,
//      queued, submitting) for more than 30 days.
// Both are closed as "skipped" with an audit line. This touches no ad and no
// listing_posts row: paid ads stay up by Noam's rule, and the ad's own
// record is listing_posts, not the run item.

export const STALE_WAIT_DAYS = 30;
export const WAITING_STATUSES = ["needs_login", "needs_payment", "needs_operator", "queued", "submitting"] as const;
export const GONE_POST_STATUSES = ["expired", "removed"] as const;

type PropRel = { status: string | null } | Array<{ status: string | null }> | null;
type RunRel = { property: PropRel } | Array<{ property: PropRel }> | null;

export type RunItemRow = {
  id: string;
  publish_status: string | null;
  updated_at: string | null;
  listing_post: { status: string | null } | Array<{ status: string | null }> | null;
  run?: RunRel;
};

function postStatus(row: RunItemRow): string | null {
  const lp = Array.isArray(row.listing_post) ? row.listing_post[0] : row.listing_post;
  return lp?.status ?? null;
}

function propertyStatus(row: RunItemRow): string | null {
  const run = Array.isArray(row.run) ? row.run[0] : row.run;
  const prop = run ? (Array.isArray(run.property) ? run.property[0] : run.property) : null;
  return prop?.status ?? null;
}

/** Which rows to close and why. Pure. */
export function runItemsToClose(rows: RunItemRow[], nowMs: number): Array<{ id: string; reason: string }> {
  const out: Array<{ id: string; reason: string }> = [];
  const cutoff = nowMs - STALE_WAIT_DAYS * 24 * 60 * 60 * 1000;
  for (const r of rows) {
    const st = r.publish_status ?? "";
    if (
      (st === "live" || st === "submitted") &&
      propertyStatus(r) !== "available" &&
      (GONE_POST_STATUSES as readonly string[]).includes(postStatus(r) ?? "")
    ) {
      out.push({ id: r.id, reason: `closed: the unit is ${propertyStatus(r) ?? "off the market"} and the ad's record is ${postStatus(r)}` });
      continue;
    }
    if ((WAITING_STATUSES as readonly string[]).includes(st)) {
      const t = Date.parse(r.updated_at ?? "");
      if (Number.isFinite(t) && t < cutoff) out.push({ id: r.id, reason: `closed: waited ${STALE_WAIT_DAYS} days for ${st.replace("needs_", "")}` });
    }
  }
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

/** Close what can never finish. Never throws; returns how many it closed. */
export async function closeStaleRunItems(admin: Admin, nowISO: string): Promise<number> {
  try {
    const { data, error } = await admin
      .from("distribution_run_items")
      .select("id, publish_status, updated_at, listing_post:listing_posts(status), run:distribution_runs(property:properties(status))")
      .in("publish_status", ["live", "submitted", ...WAITING_STATUSES])
      .order("updated_at", { ascending: true })
      .limit(300);
    if (error || !data) return 0;
    const toClose = runItemsToClose(data as RunItemRow[], Date.parse(nowISO));
    let n = 0;
    for (const c of toClose) {
      const { error: upErr } = await admin
        .from("distribution_run_items")
        .update({ publish_status: "skipped", error_code: "closed_stale", audit_message: c.reason, updated_at: nowISO })
        .eq("id", c.id);
      if (!upErr) n++;
    }
    return n;
  } catch {
    return 0;
  }
}
