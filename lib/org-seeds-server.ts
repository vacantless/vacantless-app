// Shared org-seeding helpers (clause library + tenant-message templates).
//
// Extracted from app/onboarding/actions.ts so BOTH paths that stand up a new
// org can seed it identically:
//   - self-serve onboarding (the signed-in owner_admin's user client; RLS passes
//     because they own the org)
//   - the provisioning primitive (lib/provisioning-server.ts, the service-role
//     admin client; bypasses RLS — required because the operator is NOT a member
//     of the landlord's new org)
//
// Both are best-effort: a seed failure must NEVER block org creation — the org
// already exists and the operator can add clauses/templates by hand later.

import type { SupabaseClient } from "@supabase/supabase-js";
import { RESIDENTIAL_CLAUSE_SEED } from "./clauses";
import { TENANT_MESSAGE_TEMPLATE_SEED } from "./tenant-comms";

/**
 * Seed the org's starter clause library (lease vault #11). Each seed clause
 * becomes a lease_clauses row + a single version-1 lease_clause_versions row
 * flagged current. Best-effort.
 */
export async function seedClauseLibrary(
  supabase: SupabaseClient,
  orgId: string,
): Promise<void> {
  const { data: inserted, error } = await supabase
    .from("lease_clauses")
    .insert(
      RESIDENTIAL_CLAUSE_SEED.map((c) => ({
        organization_id: orgId,
        key: c.key,
        title: c.title,
        category: c.category,
        applicable_to: c.applicableTo,
        risk_level: c.riskLevel,
        jurisdiction: c.jurisdiction,
        notes_for_landlord: c.notesForLandlord,
      })),
    )
    .select("id, key");

  if (error || !inserted) {
    console.error("seedClauseLibrary: clause insert failed", {
      orgId,
      error: error?.message,
    });
    return;
  }

  const byKey = new Map(RESIDENTIAL_CLAUSE_SEED.map((c) => [c.key, c]));
  const versions = (inserted as { id: string; key: string }[])
    .map((row) => {
      const seed = byKey.get(row.key);
      if (!seed) return null;
      return {
        organization_id: orgId,
        clause_id: row.id,
        version: 1,
        body: seed.body,
        is_current: true,
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  const { error: vErr } = await supabase
    .from("lease_clause_versions")
    .insert(versions);
  if (vErr) {
    console.error("seedClauseLibrary: version insert failed", {
      orgId,
      error: vErr.message,
    });
  }
}

/**
 * Seed the org's starter tenant-message templates (tenant comms). Each seed
 * becomes one tenant_message_templates row. Best-effort.
 */
export async function seedTenantMessageTemplates(
  supabase: SupabaseClient,
  orgId: string,
): Promise<void> {
  const { error } = await supabase.from("tenant_message_templates").insert(
    TENANT_MESSAGE_TEMPLATE_SEED.map((t) => ({
      organization_id: orgId,
      name: t.name,
      channel: t.channel,
      subject: t.subject,
      body: t.body,
    })),
  );
  if (error) {
    console.error("seedTenantMessageTemplates: insert failed", {
      orgId,
      error: error.message,
    });
  }
}
