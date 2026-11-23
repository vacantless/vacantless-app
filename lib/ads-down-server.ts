// S836d: read one account's records for "for rent, no ads up" (lib/ads-down.ts).
// Works with a signed-in client (Leasing page) and the service-role client
// (the monthly summary sweep); every read is scoped to the one account. Signs
// that a unit rented only count from the day it last came on the market, so an
// old tenant's tenancy or application never reads as this vacancy renting.
import type { SupabaseClient } from "@supabase/supabase-js";
import { adsDownUnit, type AdPost, type AdsDownUnit, type RentedEvidence } from "@/lib/ads-down";
import { shortAddr } from "@/lib/rental-report";

const RECENT_DAYS_WHEN_UNKNOWN = 90;

export async function loadAdsDown(db: SupabaseClient, orgId: string, nowMs = Date.now()): Promise<AdsDownUnit[]> {
  const { data: propRows } = await db
    .from("properties")
    .select("id, address, status, available_since, archived_at")
    .eq("organization_id", orgId)
    .eq("status", "available");
  const props = ((propRows ?? []) as { id: string; address: string | null; status: string | null; available_since: string | null; archived_at: string | null }[]).filter(
    (p) => !p.archived_at,
  );
  if (props.length === 0) return [];
  const ids = props.map((p) => p.id);

  const [postsRes, tenRes, offerRes, appRes, leadRes] = await Promise.all([
    db.from("listing_posts").select("property_id, portal, status, notes, down_at").eq("organization_id", orgId).in("property_id", ids),
    db.from("tenancies").select("property_id, start_date, status, created_at").eq("organization_id", orgId).in("property_id", ids).neq("status", "ended"),
    db.from("application_offers").select("property_id, accepted_at").eq("organization_id", orgId).in("property_id", ids).not("accepted_at", "is", null),
    db
      .from("rental_applications")
      .select("property_id, submitted_at, status")
      .eq("organization_id", orgId)
      .in("property_id", ids)
      .not("submitted_at", "is", null)
      .neq("status", "declined"),
    db.from("leads").select("property_id, status, created_at").eq("organization_id", orgId).in("property_id", ids).in("status", ["applied", "leased"]),
  ]);

  type Post = { property_id: string; portal: string | null; status: string | null; notes: string | null; down_at: string | null };
  const posts = (postsRes.data ?? []) as Post[];
  const tenancies = (tenRes.data ?? []) as { property_id: string; start_date: string | null; created_at: string }[];
  const offers = (offerRes.data ?? []) as { property_id: string; accepted_at: string }[];
  const apps = (appRes.data ?? []) as { property_id: string; submitted_at: string }[];
  const leads = (leadRes.data ?? []) as { property_id: string; status: string; created_at: string }[];

  const out: AdsDownUnit[] = [];
  for (const p of props) {
    const since = p.available_since ?? new Date(nowMs - RECENT_DAYS_WHEN_UNKNOWN * 86400000).toISOString();
    const after = (iso: string | null | undefined) => !!iso && iso >= since;
    const tenancy = tenancies.filter((t) => t.property_id === p.id && after(t.created_at)).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    const offer = offers.filter((o) => o.property_id === p.id && after(o.accepted_at)).sort((a, b) => b.accepted_at.localeCompare(a.accepted_at))[0];
    const app = apps.filter((a) => a.property_id === p.id && after(a.submitted_at)).sort((a, b) => b.submitted_at.localeCompare(a.submitted_at))[0];
    const ls = leads.filter((l) => l.property_id === p.id && after(l.created_at));
    const evidence: RentedEvidence = {
      hasTenancy: !!tenancy,
      tenancyStart: tenancy?.start_date ?? null,
      offerAcceptedAt: offer?.accepted_at ?? null,
      applicationSubmittedAt: app?.submitted_at ?? null,
      renterLeased: ls.some((l) => l.status === "leased"),
      renterAtApplied: ls.some((l) => l.status === "applied"),
    };
    const unitPosts: AdPost[] = posts
      .filter((x) => x.property_id === p.id)
      .map((x) => ({ portal: x.portal, status: x.status, notes: x.notes, downAt: x.down_at }));
    const u = adsDownUnit({ propertyId: p.id, address: shortAddr(p.address), status: p.status }, unitPosts, evidence);
    if (u) out.push(u);
  }
  // Probably rented first, then the rest.
  const rank = { probably_rented: 0, ads_expired: 1, taken_down: 2, unknown: 3 } as const;
  return out.sort((a, b) => rank[a.verdict] - rank[b.verdict] || a.address.localeCompare(b.address));
}
