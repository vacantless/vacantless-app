// S820e: mark the renter with the accepted offer Leased when their unit is marked Rented.
// Never throws: the unit's takedown must not fail because of this.
import type { SupabaseClient } from "@supabase/supabase-js";
import { LEASE_WINNER_NOTE, pickLeaseWinner, type LeaseCandidate } from "@/lib/lease-winner";

export async function markLeaseWinner(args: {
  client: SupabaseClient;
  organizationId: string;
  propertyId: string;
}): Promise<string | null> {
  const { client, organizationId, propertyId } = args;
  try {
    const { data: leadRows } = await client
      .from("leads")
      .select("id, status")
      .eq("organization_id", organizationId)
      .eq("property_id", propertyId)
      .not("status", "in", "(leased,lost)")
      .limit(500);
    const leads = (leadRows ?? []) as { id: string; status: string | null }[];
    if (leads.length === 0) return null;
    const ids = leads.map((l) => l.id);
    const { data: offers } = await client
      .from("application_offers")
      .select("lead_id")
      .eq("organization_id", organizationId)
      .eq("status", "accepted")
      .in("lead_id", ids);
    const offered = new Set(((offers ?? []) as { lead_id: string }[]).map((r) => r.lead_id));
    const candidates: LeaseCandidate[] = leads.map((l) => ({
      id: l.id,
      status: l.status,
      acceptedOffer: offered.has(l.id),
    }));
    const winner = pickLeaseWinner(candidates);
    if (!winner) return null;
    await client
      .from("leads")
      .update({ status: "leased", leased_date: new Date().toISOString().slice(0, 10) })
      .eq("id", winner)
      .eq("organization_id", organizationId);
    await client.from("messages").insert({
      organization_id: organizationId,
      lead_id: winner,
      channel: "note",
      direction: "outbound",
      body: LEASE_WINNER_NOTE,
    });
    return winner;
  } catch (err) {
    console.error("[lease-winner] failed", err instanceof Error ? err.message : String(err));
    return null;
  }
}
