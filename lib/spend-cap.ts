// Monthly spend cap for paid posting sites (Kijiji today).
//
// distribution_channel_accounts.spend_period_max_cents is the landlord's
// "Most per month" limit (0217 column comment: per-calendar-month ceiling).
// "Month" here means the calendar month in America/Toronto: it resets at
// midnight Toronto time on the 1st.
//
// What counts as spend this month (sumPeriodSpendCents):
//   1. Every row in public.distribution_channel_spend (the 0217 charge ledger)
//      for this org + channel with charged_at in the month, at amount_cents.
//   2. PLUS one list price (CHANNEL_COST_CENTS, Kijiji $33.84) for every NEW
//      ad the robot put up this month that has no ledger row. A new ad is a
//      listing_posts row created this month (the worker makes a fresh row for
//      every new ad and reuses the live row for edits). Edits, takedowns and
//      re-checks of an ad first posted in an earlier month never count, and
//      several robot runs on the same ad count once (S784: three free edits
//      and a takedown were blocking a real repost). A robot-posted item with
//      no listing record still counts once, so this errs high, never low.
//      As of 2026-11-12 nothing writes the ledger yet.
//
// The pure check (periodSpendCheck) is what the posting worker cron and the
// approve paths call before a paid post can move toward the fee wall.

import type { SupabaseClient } from "@supabase/supabase-js";
import { CHANNEL_COST_CENTS, channelByKey, formatChannelMoney } from "./distribution-channels";

export const SPEND_CAP_TIME_ZONE = "America/Toronto";

export type SpendCapReason = "spend_per_ad_cap" | "spend_period_cap";

export type SpendCapResult = { ok: true } | { ok: false; reason: SpendCapReason };

function positiveInt(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : null;
}

/**
 * Pure: would the next charge break either limit? A null/zero limit means no
 * limit of that kind. Spending exactly up to the monthly limit is allowed.
 */
export function periodSpendCheck(input: {
  spentThisPeriodCents: number;
  nextChargeCents: number;
  periodMaxCents: number | null | undefined;
  perAdMaxCents: number | null | undefined;
}): SpendCapResult {
  const next = Math.max(0, Math.round(input.nextChargeCents || 0));
  const spent = Math.max(0, Math.round(input.spentThisPeriodCents || 0));
  if (next <= 0) return { ok: true };
  const perAd = positiveInt(input.perAdMaxCents);
  const period = positiveInt(input.periodMaxCents);
  if (perAd != null && next > perAd) return { ok: false, reason: "spend_per_ad_cap" };
  if (period != null && spent + next > period) return { ok: false, reason: "spend_period_cap" };
  return { ok: true };
}

/** The fee the next paid post will cost: the site's list price, else the per-ad limit. */
export function nextChargeCentsFor(channel: string, perAdMaxCents: number | null | undefined): number {
  const list = (CHANNEL_COST_CENTS as Record<string, number | undefined>)[channel];
  if (typeof list === "number" && list > 0) return list;
  return positiveInt(perAdMaxCents) ?? 0;
}

function torontoParts(d: Date): { y: number; m: number; day: number; h: number; min: number; s: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SPEND_CAP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return { y: get("year"), m: get("month"), day: get("day"), h: get("hour"), min: get("minute"), s: get("second") };
}

/** UTC instant of midnight on the 1st of the current Toronto calendar month. */
export function periodStartUtc(now: Date = new Date()): Date {
  const { y, m } = torontoParts(now);
  const guess = Date.UTC(y, m - 1, 1, 0, 0, 0);
  const p = torontoParts(new Date(guess));
  const asLocal = Date.UTC(p.y, p.m - 1, p.day, p.h, p.min, p.s);
  const offsetMs = asLocal - guess; // Toronto minus UTC (negative)
  return new Date(guess - offsetMs);
}

/** Plain text for a block. Money is always dollars. */
export function spendCapBlockMessage(input: {
  reason: SpendCapReason;
  channel: string;
  periodMaxCents?: number | null;
  perAdMaxCents?: number | null;
}): string {
  const label = channelByKey(input.channel)?.label ?? input.channel;
  if (input.reason === "spend_per_ad_cap") {
    const max = positiveInt(input.perAdMaxCents);
    return `This ad costs more than your limit of ${formatChannelMoney(max ?? 0)} per ad for ${label}. Raise it in Settings.`;
  }
  const max = positiveInt(input.periodMaxCents);
  return `This would go over your monthly limit of ${formatChannelMoney(max ?? 0)} for ${label}. Raise it in Settings.`;
}

export type RobotPostedItem = { id: string; listing_post_id: string | null };

/**
 * Pure: how many new paid ads the robot put up this month with no ledger row.
 * items are robot-posted run items this month; newPostIds are the listing
 * records created this month. One ad per new listing record, however many
 * runs touched it. Items on an older listing record (edits, takedowns) are
 * free. Items with no listing record count one each (errs high).
 */
export function countNewPaidAds(input: {
  items: RobotPostedItem[];
  newPostIds: Set<string>;
  ledgerItemIds: Set<string>;
  excludeItemId?: string | null;
}): number {
  const ads = new Set<string>();
  const ledgerPosts = new Set<string>();
  for (const r of input.items) {
    if (input.ledgerItemIds.has(r.id) && r.listing_post_id) ledgerPosts.add(r.listing_post_id);
  }
  let orphans = 0;
  for (const r of input.items) {
    if (r.id === input.excludeItemId) continue;
    if (input.ledgerItemIds.has(r.id)) continue;
    if (!r.listing_post_id) { orphans += 1; continue; }
    if (!input.newPostIds.has(r.listing_post_id)) continue;
    if (ledgerPosts.has(r.listing_post_id)) continue;
    ads.add(r.listing_post_id);
  }
  return ads.size + orphans;
}

/**
 * Server: paid spend for this org + channel since the start of the Toronto
 * calendar month. See the file header for exactly what is summed.
 * excludeItemId leaves out the post being checked so it is not counted twice.
 */
export async function sumPeriodSpendCents(
  client: SupabaseClient,
  input: { organizationId: string; channel: string; now?: Date; excludeItemId?: string | null },
): Promise<number> {
  const startISO = periodStartUtc(input.now ?? new Date()).toISOString();

  const { data: ledger } = await client
    .from("distribution_channel_spend")
    .select("amount_cents, distribution_run_item_id")
    .eq("organization_id", input.organizationId)
    .eq("channel", input.channel)
    .gte("charged_at", startISO);
  const ledgerRows = (ledger ?? []) as { amount_cents: number | null; distribution_run_item_id: string | null }[];
  let total = 0;
  const ledgerItemIds = new Set<string>();
  for (const r of ledgerRows) {
    total += Math.max(0, r.amount_cents ?? 0);
    if (r.distribution_run_item_id) ledgerItemIds.add(r.distribution_run_item_id);
  }

  const listPrice = (CHANNEL_COST_CENTS as Record<string, number | undefined>)[input.channel] ?? 0;
  if (listPrice > 0) {
    const { data: posted } = await client
      .from("distribution_run_items")
      .select("id, listing_post_id")
      .eq("organization_id", input.organizationId)
      .eq("channel", input.channel)
      .not("external_url", "is", null)
      .gte("last_attempted_at", startISO);
    const items = (posted ?? []) as RobotPostedItem[];
    const postIds = Array.from(new Set(items.map((r) => r.listing_post_id).filter((v): v is string => !!v)));
    const newThisMonth = new Set<string>();
    if (postIds.length > 0) {
      const { data: posts } = await client
        .from("listing_posts")
        .select("id")
        .in("id", postIds)
        .gte("created_at", startISO);
      for (const p of (posts ?? []) as { id: string }[]) newThisMonth.add(p.id);
    }
    total += countNewPaidAds({ items, newPostIds: newThisMonth, ledgerItemIds, excludeItemId: input.excludeItemId }) * listPrice;
  }
  return total;
}

/** Server: sum this month's spend and run the check in one call. */
export async function checkPeriodSpend(
  client: SupabaseClient,
  input: {
    organizationId: string;
    channel: string;
    periodMaxCents: number | null | undefined;
    perAdMaxCents: number | null | undefined;
    excludeItemId?: string | null;
    now?: Date;
  },
): Promise<SpendCapResult> {
  const nextChargeCents = nextChargeCentsFor(input.channel, input.perAdMaxCents);
  // Nothing to charge and no limit: skip the reads.
  if (nextChargeCents <= 0) return { ok: true };
  const spentThisPeriodCents = positiveInt(input.periodMaxCents)
    ? await sumPeriodSpendCents(client, input)
    : 0;
  return periodSpendCheck({
    spentThisPeriodCents,
    nextChargeCents,
    periodMaxCents: input.periodMaxCents,
    perAdMaxCents: input.perAdMaxCents,
  });
}
