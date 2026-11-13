// S785: the Rentals.ca "free ads full" stop as a one-click choice.
//
// A free Rentals.ca account shows a few ads at a time. When it is full the
// robot stops the new ad with error_code free_limit_reached. Instead of
// "turn one off on Rentals.ca", the row now lists this account's other live
// Rentals.ca ads with the renters each one brought in 30 days, weakest first,
// and offers "Switch <address> off and post this one". That queues the
// robot's takedown for the weak ad and parks this item at
// waiting_for_free_slot with a note naming the takedown; the worker approves
// it once the takedown is done (vacantless-worker tracker.ts).
import type { SupabaseClient } from "@supabase/supabase-js";

export const SLOT_WAIT_CODE = "waiting_for_free_slot";

export type RentalsSlotAd = {
  listingPostId: string;
  propertyId: string;
  address: string;
  renters30: number;
};

export type RentalsSlotChoice = {
  ads: RentalsSlotAd[]; // weakest first
  /** Free slots in use on the account that are not this account's rentals (another account on the same login). */
  otherUsed: number;
};

/** Pure: weakest first (fewest Rentals.ca renters in 30 days), then by address. */
export function sortWeakestFirst(ads: readonly RentalsSlotAd[]): RentalsSlotAd[] {
  return [...ads].sort((a, b) => a.renters30 - b.renters30 || a.address.localeCompare(b.address));
}

/** Pure: "1551 Assumption St, Unit 9, Windsor, ON N9A 3E2" -> "1551 Assumption St, Unit 9". */
export function shortAddress(address: string): string {
  const parts = (address ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2 && /^(unit|apt|suite|#)/i.test(parts[1])) return `${parts[0]}, ${parts[1]}`;
  return parts[0] ?? address;
}

export function rentersWord(n: number): string {
  return n === 0 ? "no renters" : n === 1 ? "1 renter" : `${n} renters`;
}

/** Pure: the note the worker reads. One line, appended to the item's notes. */
export function slotWaitNote(takedownItemId: string, userId: string | null): string {
  return `slot_after:${takedownItemId}${userId ? ` slot_by:${userId}` : ""}`;
}

export function slotWaitMessage(weakAddress: string): string {
  return `Switching ${shortAddress(weakAddress)} off Rentals.ca first to free a slot. This ad posts by itself once that one is off, usually within a few minutes.`;
}

/** Pure: the summary line at the top of the rental page. */
export function slotsFullBody(): string {
  return "Rentals.ca's free ads are all in use. Pick an ad to switch off below. This one goes up in its place.";
}

/** Loader: this org's other live Rentals.ca ads and their Rentals.ca renters in 30 days. Never throws. */
export async function loadRentalsSlotChoice(
  supabase: SupabaseClient,
  organizationId: string,
  propertyId: string,
  now: Date = new Date(),
): Promise<RentalsSlotChoice> {
  try {
    const { data: posts } = await supabase
      .from("listing_posts")
      .select("id, property_id, url, properties!inner(address)")
      .eq("organization_id", organizationId)
      .eq("portal", "rentals_ca")
      .eq("status", "live")
      .neq("property_id", propertyId);
    const rows = ((posts ?? []) as Record<string, any>[]).filter((r) => r.url);
    const since = new Date(now.getTime() - 30 * 86400000).toISOString();
    const ids = rows.map((r) => r.property_id as string);
    const counts = new Map<string, number>();
    if (ids.length > 0) {
      const { data: leads } = await supabase
        .from("leads")
        .select("property_id")
        .eq("organization_id", organizationId)
        .eq("source", "Rentals.ca")
        .in("property_id", ids)
        .gte("created_at", since);
      for (const l of (leads ?? []) as { property_id: string }[]) counts.set(l.property_id, (counts.get(l.property_id) ?? 0) + 1);
    }
    const ads = sortWeakestFirst(
      rows.map((r) => {
        const prop = Array.isArray(r.properties) ? r.properties[0] : r.properties;
        return {
          listingPostId: r.id as string,
          propertyId: r.property_id as string,
          address: (prop?.address as string) ?? "",
          renters30: counts.get(r.property_id as string) ?? 0,
        };
      }),
    );
    const { data: session } = await supabase
      .from("distribution_channel_session_status")
      .select("cap_used")
      .eq("organization_id", organizationId)
      .eq("channel", "rentals_ca")
      .maybeSingle();
    const used = (session?.cap_used as number | null | undefined) ?? null;
    return { ads, otherUsed: used != null ? Math.max(0, used - ads.length) : 0 };
  } catch {
    return { ads: [], otherUsed: 0 };
  }
}

/** Matches the worker's SLOT_STUCK_PREFIX (tracker.ts): the switch's takedown failed. */
export const SLOT_STUCK_PREFIX = "The switch stopped:";

export function slotIsStuck(errorMessage: string | null | undefined): boolean {
  return (errorMessage ?? "").trim().startsWith(SLOT_STUCK_PREFIX);
}

/** Pure: the takedown item a waiting rental is tied to. */
export function slotTakedownId(notes: string | null | undefined): string | null {
  const m = (notes ?? "").match(/slot_after:([0-9a-f-]{36})/i);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// S786: the rental that made room. After a switch, the weak rental's
// Rentals.ca ad is off, so the Rentals list called it "missing" and offered
// "Post to Rentals.ca", which led straight back to the full account and an
// offer to switch the new one off (a loop). While the rental it made room for
// is still waiting or live on Rentals.ca, the weak rental is not missing
// Rentals.ca: it gave its slot away by the landlord's choice.
// ---------------------------------------------------------------------------

export type SlotWaiterRow = {
  /** The rental that took the slot. */
  beneficiaryPropertyId: string;
  beneficiaryAddress: string;
  /** Still at waiting_for_free_slot (the switch is under way or stopped). */
  waiting: boolean;
  /** The takedown it waited on. */
  takedownItemId: string;
};

/** Pure: weak rental id -> the short address of the rental it made room for. */
export function madeRoomPairs(args: {
  waiters: readonly SlotWaiterRow[];
  /** takedown item id -> the property whose ad it took down */
  takedownProperty: ReadonlyMap<string, string>;
  /** properties with a live Rentals.ca ad now */
  liveOnRentals: ReadonlySet<string>;
}): Map<string, string> {
  const out = new Map<string, string>();
  for (const w of args.waiters) {
    const weak = args.takedownProperty.get(w.takedownItemId);
    if (!weak || weak === w.beneficiaryPropertyId) continue;
    if (args.liveOnRentals.has(weak)) continue;
    if (!w.waiting && !args.liveOnRentals.has(w.beneficiaryPropertyId)) continue;
    out.set(weak, shortAddress(w.beneficiaryAddress));
  }
  return out;
}

/** Loader for madeRoomPairs. Never throws; an error means no pairs. */
export async function loadMadeRoom(supabase: SupabaseClient, organizationId: string): Promise<Map<string, string>> {
  try {
    const { data: rows } = await supabase
      .from("distribution_run_items")
      .select("id, notes, error_code, distribution_runs!inner(property_id, properties!inner(address))")
      .eq("organization_id", organizationId)
      .eq("channel", "rentals_ca")
      .ilike("notes", "%slot_after:%");
    const waiters: SlotWaiterRow[] = [];
    for (const r of (rows ?? []) as Record<string, any>[]) {
      const run = Array.isArray(r.distribution_runs) ? r.distribution_runs[0] : r.distribution_runs;
      const prop = run && (Array.isArray(run.properties) ? run.properties[0] : run.properties);
      const takedownItemId = slotTakedownId(r.notes);
      if (!run?.property_id || !takedownItemId) continue;
      waiters.push({
        beneficiaryPropertyId: run.property_id,
        beneficiaryAddress: prop?.address ?? "",
        waiting: r.error_code === SLOT_WAIT_CODE,
        takedownItemId,
      });
    }
    if (waiters.length === 0) return new Map();
    const { data: takedowns } = await supabase
      .from("distribution_run_items")
      .select("id, listing_post_id")
      .eq("organization_id", organizationId)
      .in("id", waiters.map((w) => w.takedownItemId));
    const postIds = ((takedowns ?? []) as { listing_post_id: string | null }[])
      .map((t) => t.listing_post_id)
      .filter((x): x is string => Boolean(x));
    const { data: posts } = postIds.length
      ? await supabase.from("listing_posts").select("id, property_id").eq("organization_id", organizationId).in("id", postIds)
      : { data: [] };
    const postProperty = new Map(((posts ?? []) as { id: string; property_id: string }[]).map((p) => [p.id, p.property_id]));
    const takedownProperty = new Map<string, string>();
    for (const t of (takedowns ?? []) as { id: string; listing_post_id: string | null }[]) {
      const prop = t.listing_post_id ? postProperty.get(t.listing_post_id) : undefined;
      if (prop) takedownProperty.set(t.id, prop);
    }
    const { data: live } = await supabase
      .from("listing_posts")
      .select("property_id")
      .eq("organization_id", organizationId)
      .eq("portal", "rentals_ca")
      .eq("status", "live");
    const liveOnRentals = new Set(((live ?? []) as { property_id: string }[]).map((p) => p.property_id));
    return madeRoomPairs({ waiters, takedownProperty, liveOnRentals });
  } catch {
    return new Map();
  }
}

/** Pure: the line on the rental that made room. */
export function madeRoomLine(forAddress: string): string {
  return `Switched off Rentals.ca to make room for ${forAddress}. Posting here again needs a free Rentals.ca slot back.`;
}
