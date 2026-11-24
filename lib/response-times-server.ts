// S838: read reply and viewing times for a set of renters (lib/response-times).
// Service-role reads, chunked by renter id.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TimedLead } from "@/lib/response-times";

export async function loadTimedLeads(
  db: SupabaseClient,
  leads: readonly { id: string; source: string | null; created_at: string }[],
): Promise<TimedLead[]> {
  const firstReply = new Map<string, string>();
  // The earliest-booked viewing, and the time that viewing was for.
  const firstShowing = new Map<string, { booked: string; for: string | null }>();
  const ids = leads.map((l) => l.id);
  const keepMin = (m: Map<string, string>, k: string | null, v: string | null) => {
    if (!k || !v) return;
    const cur = m.get(k);
    if (!cur || Date.parse(v) < Date.parse(cur)) m.set(k, v);
  };
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const [msg, show] = await Promise.all([
      db.from("messages").select("lead_id, created_at").eq("direction", "outbound").in("channel", ["email", "sms"]).in("lead_id", chunk),
      db.from("showings").select("lead_id, created_at, scheduled_at").in("lead_id", chunk),
    ]);
    for (const r of (msg.data ?? []) as { lead_id: string | null; created_at: string }[]) keepMin(firstReply, r.lead_id, r.created_at);
    for (const r of (show.data ?? []) as { lead_id: string | null; created_at: string; scheduled_at: string | null }[]) {
      if (!r.lead_id || !r.created_at) continue;
      const cur = firstShowing.get(r.lead_id);
      if (!cur || Date.parse(r.created_at) < Date.parse(cur.booked)) firstShowing.set(r.lead_id, { booked: r.created_at, for: r.scheduled_at });
    }
  }
  return leads.map((l) => ({
    source: l.source,
    createdAt: l.created_at,
    firstReplyAt: firstReply.get(l.id) ?? null,
    firstBookedAt: firstShowing.get(l.id)?.booked ?? null,
    firstViewingAt: firstShowing.get(l.id)?.for ?? null,
  }));
}
