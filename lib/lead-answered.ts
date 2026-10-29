// S740 (review item 2): which renters already got something from us.
//
// A renter stays status "new" until they write back or book, even after the
// auto-reply and the nurture emails went out. Today said "9 inquiries need a
// reply. Renters waiting to hear back." when each of the nine had an
// "Auto-reply sent" message two seconds after asking (walked 2026-10-29).
// A renter counts as answered once any outbound email or text to them is
// logged in messages; only the rest still need a first reply.

type Reader = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, v: string) => {
        eq: (col: string, v: string) => {
          in: (col: string, v: string[]) => {
            in: (col: string, v: string[]) => PromiseLike<{ data: unknown; error: unknown }>;
          };
        };
      };
    };
  };
};

/** Lead ids (from `leadIds`) with at least one outbound email or text logged. */
export async function answeredLeadIds(
  supabase: unknown,
  orgId: string,
  leadIds: string[],
): Promise<Set<string>> {
  const out = new Set<string>();
  const db = supabase as Reader;
  for (let i = 0; i < leadIds.length; i += 200) {
    const chunk = leadIds.slice(i, i + 200);
    try {
      const { data } = await db
        .from("messages")
        .select("lead_id")
        .eq("organization_id", orgId)
        .eq("direction", "outbound")
        .in("channel", ["email", "sms"])
        .in("lead_id", chunk);
      for (const r of (data ?? []) as { lead_id: string | null }[]) if (r.lead_id) out.add(r.lead_id);
    } catch {
      /* no answered set: the cards fall back to status alone */
    }
  }
  return out;
}
