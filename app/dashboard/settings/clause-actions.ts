"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import {
  validateClauseInput,
  validateVersionInput,
  nextVersionNumber,
  planSetCurrent,
  type ClauseVersionLike,
} from "@/lib/clauses";

// Clause-library CRUD (lease vault #11, slice 2). The clause library is an
// org-level reusable asset — the same class of configuration as message
// templates and branding — so every action is guarded on manage_settings and is
// REDIRECT-based (the S170 edge-503 reasoning that governs the other settings
// saves). The per-clause versioning invariant (exactly one current version) is
// enforced by the clear-then-set rule planned in lib/clauses.planSetCurrent and
// the partial-unique index in migration 0039.

// IA Step 3 (S275): the clause library moved out of a Settings tab to its
// point-of-use under Tenants. The CRUD actions redirect back to that page;
// revalidate it (not Settings) so the list refreshes after a write. The actions
// otherwise stay identical (org-level asset, manage_settings-gated, redirect-
// based for the S170 edge-503 reason).
const CLAUSES_PAGE = "/dashboard/tenants/lease-clauses";
const CLAUSES_TAB = CLAUSES_PAGE;

function s(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

// Create a new clause (with its first version) OR edit an existing clause's
// metadata. On create, a body is required so a fresh clause always has one
// current version; the stable `key` is set once and never edited (renewal diffs
// and the assembler match on it). On edit, only title/category/applicable_to
// change.
export async function saveClause(formData: FormData) {
  await requireCapability("manage_settings", `${CLAUSES_TAB}?clause=forbidden`);
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const id = s(formData, "id"); // present = edit metadata, blank = create
  const check = validateClauseInput({
    key: s(formData, "key"),
    title: s(formData, "title"),
    category: s(formData, "category"),
    applicableTo: s(formData, "applicable_to"),
    riskLevel: s(formData, "risk_level"),
    jurisdiction: s(formData, "jurisdiction"),
    notesForLandlord: s(formData, "notes_for_landlord"),
  });
  if (!check.ok) redirect(`${CLAUSES_TAB}?clause=${check.code}`);

  const supabase = createClient();

  if (id) {
    // Edit metadata only — key is immutable once set.
    const { error } = await supabase
      .from("lease_clauses")
      .update({
        title: check.value.title,
        category: check.value.category,
        applicable_to: check.value.applicableTo,
        risk_level: check.value.riskLevel,
        jurisdiction: check.value.jurisdiction,
        notes_for_landlord: check.value.notesForLandlord,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) redirect(`${CLAUSES_TAB}?clause=error`);
    revalidatePath(CLAUSES_PAGE);
    redirect(`${CLAUSES_TAB}?clause=updated`);
  }

  // Create: a body is required so the new clause has a version-1 current.
  const body = validateVersionInput({ body: s(formData, "body") });
  if (!body.ok) redirect(`${CLAUSES_TAB}?clause=${body.code}`);

  const { data: created, error } = await supabase
    .from("lease_clauses")
    .insert({
      organization_id: org.id,
      key: check.value.key,
      title: check.value.title,
      category: check.value.category,
      applicable_to: check.value.applicableTo,
      risk_level: check.value.riskLevel,
      jurisdiction: check.value.jurisdiction,
      notes_for_landlord: check.value.notesForLandlord,
    })
    .select("id")
    .single();
  if (error || !created) {
    // The unique(org, key) index rejects a duplicate key with code 23505.
    redirect(
      `${CLAUSES_TAB}?clause=${error?.code === "23505" ? "key_taken" : "error"}`,
    );
  }

  const { error: vErr } = await supabase.from("lease_clause_versions").insert({
    organization_id: org.id,
    clause_id: (created as { id: string }).id,
    version: 1,
    body: body.value.body,
    note: body.value.note,
    is_current: true,
  });
  if (vErr) redirect(`${CLAUSES_TAB}?clause=error`);

  revalidatePath(CLAUSES_PAGE);
  redirect(`${CLAUSES_TAB}?clause=created&cn=${Date.now().toString(36)}`);
}

// Add a new version of an existing clause and make it current. The version
// number is max+1; the current flag flips via clear-then-set (never one UPDATE)
// so the partial-unique is_current index is never momentarily violated.
export async function saveClauseVersion(formData: FormData) {
  await requireCapability("manage_settings", `${CLAUSES_TAB}?clause=forbidden`);
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const clauseId = s(formData, "clause_id");
  if (!clauseId) redirect(`${CLAUSES_TAB}?clause=error`);

  const check = validateVersionInput({
    body: s(formData, "body"),
    note: s(formData, "note") || null,
  });
  if (!check.ok) redirect(`${CLAUSES_TAB}?clause=${check.code}`);

  const supabase = createClient();
  const { data: existing } = await supabase
    .from("lease_clause_versions")
    .select("id, version, is_current")
    .eq("clause_id", clauseId);
  const versions = (existing ?? []) as ClauseVersionLike[];

  // Clear the existing current first (clear-then-set), then insert the new
  // version already flagged current.
  const current = versions.find((v) => v.is_current);
  if (current) {
    const { error: clearErr } = await supabase
      .from("lease_clause_versions")
      .update({ is_current: false })
      .eq("id", current.id);
    if (clearErr) redirect(`${CLAUSES_TAB}?clause=error`);
  }

  const { error } = await supabase.from("lease_clause_versions").insert({
    organization_id: org.id,
    clause_id: clauseId,
    version: nextVersionNumber(versions),
    body: check.value.body,
    note: check.value.note,
    is_current: true,
  });
  if (error) redirect(`${CLAUSES_TAB}?clause=error`);

  revalidatePath(CLAUSES_PAGE);
  redirect(`${CLAUSES_TAB}?clause=version_added&cn=${Date.now().toString(36)}`);
}

// Re-activate an older version as the current one (e.g. roll back a change).
// Plans the clear-then-set with lib/clauses.planSetCurrent, then applies it.
export async function setCurrentClauseVersion(formData: FormData) {
  await requireCapability("manage_settings", `${CLAUSES_TAB}?clause=forbidden`);
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const clauseId = s(formData, "clause_id");
  const versionId = s(formData, "version_id");
  if (!clauseId || !versionId) redirect(`${CLAUSES_TAB}?clause=error`);

  const supabase = createClient();
  const { data: existing } = await supabase
    .from("lease_clause_versions")
    .select("id, version, is_current")
    .eq("clause_id", clauseId);
  const versions = (existing ?? []) as ClauseVersionLike[];

  const plan = planSetCurrent(versions, versionId);
  if (!plan.ok) redirect(`${CLAUSES_TAB}?clause=${plan.code}`);
  if (plan.noop) redirect(`${CLAUSES_TAB}?clause=version_current`);

  // Clear the others first, then set the target current (two writes).
  if (plan.clear.length > 0) {
    const { error: clearErr } = await supabase
      .from("lease_clause_versions")
      .update({ is_current: false })
      .in("id", plan.clear);
    if (clearErr) redirect(`${CLAUSES_TAB}?clause=error`);
  }
  const { error } = await supabase
    .from("lease_clause_versions")
    .update({ is_current: true })
    .eq("id", plan.set);
  if (error) redirect(`${CLAUSES_TAB}?clause=error`);

  revalidatePath(CLAUSES_PAGE);
  redirect(`${CLAUSES_TAB}?clause=version_current`);
}

// Delete a clause and its whole version history (the cascade). Executed leases
// keep their snapshot independently (lease_documents.executed_clause_versions is
// a jsonb copy), so deleting a clause never alters what a tenant already signed.
export async function deleteClause(formData: FormData) {
  await requireCapability("manage_settings", `${CLAUSES_TAB}?clause=forbidden`);
  const id = s(formData, "id");
  if (!id) redirect(CLAUSES_TAB);

  const supabase = createClient();
  const { error } = await supabase.from("lease_clauses").delete().eq("id", id);
  if (error) redirect(`${CLAUSES_TAB}?clause=error`);

  revalidatePath(CLAUSES_PAGE);
  redirect(`${CLAUSES_TAB}?clause=deleted`);
}
