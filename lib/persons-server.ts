// ============================================================================
// lib/persons-server — the I/O half of the per-person vault (lease vault #11).
//
// The pure identity rule lives in lib/persons (planResolvePerson, testable +
// byte-aligned with the 0042 SQL backfill). This is the thin DB wrapper the
// server actions call to turn a tenant/signer candidate into a person id:
// fetch the small set of candidate persons by org + the two match keys, apply
// the pure plan, and either link to the existing person or insert a new one.
//
// Not "use server" — it's a helper imported BY server actions, not an action.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeEmail, planResolvePerson, type PersonMatchRow } from "@/lib/persons";

type Client = SupabaseClient;

export type PersonInput = {
  name: string | null;
  email: string | null;
  phone: string | null;
  /** already normalized by the caller via lib/sms.normalizePhoneE164 */
  phone_e164: string | null;
};

/**
 * Resolve a tenant/signer candidate to a person id within an org, creating the
 * person if none matches. RLS scopes every query to the caller's org; the
 * explicit organization_id is the backstop. Returns null only if the insert
 * itself fails (the caller then leaves person_id null — a missing link is
 * harmless, the vault just won't group that row).
 */
export async function resolvePersonId(
  supabase: Client,
  orgId: string,
  input: PersonInput,
): Promise<string | null> {
  const email_norm = normalizeEmail(input.email);
  const phone_e164 = input.phone_e164;

  // No reliable key at all -> always a fresh person (can't be merged later
  // without an explicit operator action, which is a future slice).
  if (email_norm || phone_e164) {
    // Pull only the candidates that could match either key.
    const ors: string[] = [];
    if (email_norm) ors.push(`email_norm.eq.${email_norm}`);
    if (phone_e164) ors.push(`phone_e164.eq.${phone_e164}`);

    const { data } = await supabase
      .from("persons")
      .select("id, email_norm, phone_e164")
      .eq("organization_id", orgId)
      .or(ors.join(","));

    const plan = planResolvePerson((data ?? []) as PersonMatchRow[], { email_norm, phone_e164 });
    if (plan.kind === "existing") return plan.id;
  }

  const { data: inserted } = await supabase
    .from("persons")
    .insert({
      organization_id: orgId,
      full_name: input.name,
      email: input.email,
      phone: input.phone,
      email_norm,
      phone_e164,
    })
    .select("id")
    .maybeSingle();

  return (inserted as { id: string } | null)?.id ?? null;
}
