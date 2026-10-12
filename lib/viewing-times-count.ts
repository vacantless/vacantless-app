import type { createClient } from "@/lib/supabase/server";

type ServerClient = ReturnType<typeof createClient>;

// S710 audit (Agile view): every live Agile rental read "Needs viewings" with
// "Set viewings" as its main button, although Agile had viewing hours on
// Wednesday, Thursday and Friday. The readiness checks counted only weekly
// windows (availability_rules), and Agile opens one date at a time
// (availability_overrides). A rental has viewing times when the org has a
// weekly window OR custom hours on a date that has not passed. One count, used
// by every readiness check, so they cannot drift apart again.
export async function countViewingTimes(
  supabase: ServerClient,
  orgId: string,
  timeZone = "America/Toronto",
): Promise<number> {
  const today = new Date().toLocaleDateString("en-CA", { timeZone });
  const [{ count: rules }, { count: dated }] = await Promise.all([
    supabase
      .from("availability_rules")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId),
    supabase
      .from("availability_overrides")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .gte("day", today)
      .gt("end_minute", 0),
  ]);
  return (rules ?? 0) + (dated ?? 0);
}
