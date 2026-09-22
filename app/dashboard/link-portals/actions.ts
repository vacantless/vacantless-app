"use server";

import { getLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import { KIJIJI_TIERS, type KijijiTier } from "@/lib/distribution-channels";
import { generateIngestToken } from "@/lib/email-ingest";
import { buildLinkPortalsViewModel, type LinkPortalsVM } from "./view-model";

const FORBIDDEN = "/dashboard/properties?forbidden=1";

// Poll target for the client tile (SPEC-S688 3.4): a thin read, no route. The
// client calls it every 5 s for up to 90 s after requesting a check.
export async function readLinkPortalTiles(): Promise<LinkPortalsVM | null> {
  const org = await getCurrentOrg();
  if (!org) return null;
  const locale = await getLocale();
  return buildLinkPortalsViewModel(org.id, locale);
}

// Kijiji tier question (SPEC-S688 3.4): jsonb merge of { kijiji_tier } into
// distribution_channel_accounts.capabilities, no migration. RLS client, org
// scoped by the row's organization_id.
export async function setKijijiTier(
  tier: string,
): Promise<{ ok: true; tier: KijijiTier } | { ok: false; error: string }> {
  await requireCapability("manage_properties", FORBIDDEN);
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  if (!(KIJIJI_TIERS as readonly string[]).includes(tier)) {
    return { ok: false, error: "bad_tier" };
  }
  const supabase = createClient();
  const { data: row } = await supabase
    .from("distribution_channel_accounts")
    .select("capabilities")
    .eq("organization_id", org.id)
    .eq("channel", "kijiji")
    .maybeSingle();
  if (!row) return { ok: false, error: "no_account" };

  const current =
    row.capabilities && typeof row.capabilities === "object" && !Array.isArray(row.capabilities)
      ? (row.capabilities as Record<string, unknown>)
      : {};
  const nowISO = new Date().toISOString();
  const { error } = await supabase
    .from("distribution_channel_accounts")
    .update({
      capabilities: { ...current, kijiji_tier: tier },
      updated_at: nowISO,
    })
    .eq("organization_id", org.id)
    .eq("channel", "kijiji");
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/link-portals");
  return { ok: true, tier: tier as KijijiTier };
}

// S697c. Mint the org's inquiry address from the "Get your inquiries here" card.
// Deliberately NOT gated on the capture email-in plan: that gate belongs to the
// Premium document capture feature, and inquiries are the core funnel (the same
// reasoning the lead webhook gives). Idempotent: the 0086 partial-unique index
// allows one active email address per org, so a double submit is a no-op.
export async function provisionInquiryAddress(): Promise<void> {
  await requireCapability("manage_settings", FORBIDDEN);
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");
  const supabase = createClient();
  const { data: existing } = await supabase
    .from("org_ingest_addresses")
    .select("id")
    .eq("organization_id", org.id)
    .eq("channel", "email")
    .eq("active", true)
    .maybeSingle();
  if (!existing?.id) {
    const { error } = await supabase.from("org_ingest_addresses").insert({
      organization_id: org.id,
      channel: "email",
      token: generateIngestToken(),
      active: true,
    });
    if (error) console.warn("link-portals: inquiry address not created", { message: error.message });
  }
  revalidatePath("/dashboard/link-portals");
  redirect("/dashboard/link-portals#inquiries");
}
