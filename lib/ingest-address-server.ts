// S806: the account's Vacantless email address (org_ingest_addresses), made on
// first need. One active email address per org (0086 partial-unique index), so
// a race makes one row and the loser re-reads it.

import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_INGEST_DOMAIN, generateIngestToken, ingestAddressFromToken } from "./email-ingest";

export async function readIngestAddress(supabase: SupabaseClient, orgId: string): Promise<string | null> {
  const { data } = await supabase
    .from("org_ingest_addresses")
    .select("token")
    .eq("organization_id", orgId)
    .eq("channel", "email")
    .eq("active", true)
    .maybeSingle();
  const domain = process.env.INGEST_EMAIL_DOMAIN || DEFAULT_INGEST_DOMAIN;
  return data?.token ? ingestAddressFromToken(data.token as string, domain) : null;
}

export async function ensureIngestAddress(supabase: SupabaseClient, orgId: string): Promise<string | null> {
  const existing = await readIngestAddress(supabase, orgId);
  if (existing) return existing;
  const { error } = await supabase.from("org_ingest_addresses").insert({
    organization_id: orgId,
    channel: "email",
    token: generateIngestToken(),
    active: true,
  });
  if (error) console.warn("ingest-address: not created", { message: error.message });
  return readIngestAddress(supabase, orgId);
}
