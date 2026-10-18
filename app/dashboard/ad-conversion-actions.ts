"use server";

// S723: record that a conversion was reported, so it fires once (lib/ad-conversions.ts).
// The org comes from getCurrentOrg (the caller's own membership); the write uses
// the service client so a team member whose role cannot edit the organization
// still stamps it (otherwise the conversion would fire on every page load).
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentOrg } from "@/lib/org";
import { CONVERSION_EVENTS, markSent, type ConversionEvent } from "@/lib/ad-conversions";

export async function recordAdConversions(events: ConversionEvent[]): Promise<void> {
  const clean = (Array.isArray(events) ? events : []).filter((e) =>
    (CONVERSION_EVENTS as readonly string[]).includes(e),
  );
  if (clean.length === 0) return;
  const org = await getCurrentOrg();
  if (!org) return;
  const admin = createAdminClient();
  if (!admin) return;
  const { data } = await admin
    .from("organizations")
    .select("ad_conversions")
    .eq("id", org.id)
    .maybeSingle();
  const next = markSent((data as { ad_conversions?: unknown } | null)?.ad_conversions, clean, new Date());
  await admin.from("organizations").update({ ad_conversions: next }).eq("id", org.id);
}
