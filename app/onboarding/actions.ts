"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  normalizeHexColor,
  DEFAULT_BRAND_COLOR,
  DEFAULT_BRAND_SECONDARY,
} from "@/lib/branding";
import { RESIDENTIAL_CLAUSE_SEED } from "@/lib/clauses";

// Seed the org's starter clause library (lease vault #11, slice 1). Each seed
// clause becomes a lease_clauses row + a single version-1 lease_clause_versions
// row flagged current. Best-effort: a seed failure must NOT block onboarding —
// the org is already created, and the operator can add clauses by hand in
// Settings. RLS passes because the just-created user is owner_admin of the org.
async function seedClauseLibrary(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
) {
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

  // Map each inserted clause id back to its seed body, then insert version 1
  // (current) for each. One bulk insert; the partial-unique is_current index is
  // satisfied because each clause gets exactly one current version.
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

function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "org"
  );
}

export async function createOrganization(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const brandColor =
    normalizeHexColor(String(formData.get("brand_color") ?? "")) ?? DEFAULT_BRAND_COLOR;
  // Ombre second stop. A brand-new org defaults to the homepage ombre teal, so a
  // valid distinct second stop wins; an entirely ABSENT field (e.g. a no-JS
  // direct post) falls back to the teal default; a present-but-blank field means
  // the tenant deliberately chose a Solid brand (no second stop).
  const secondaryField = formData.get("brand_color_secondary");
  const rawSecondary = normalizeHexColor(String(secondaryField ?? ""));
  const fallbackSecondary =
    secondaryField === null && DEFAULT_BRAND_SECONDARY !== brandColor
      ? DEFAULT_BRAND_SECONDARY
      : null;
  const brandColorSecondary =
    rawSecondary && rawSecondary !== brandColor ? rawSecondary : fallbackSecondary;

  if (!name) {
    redirect("/onboarding?error=Name+is+required");
  }

  const supabase = createClient();
  const slug = `${slugify(name)}-${Math.random().toString(36).slice(2, 6)}`;

  const { data: org, error } = await supabase
    .rpc("create_organization", { p_name: name, p_slug: slug })
    .single();

  if (error || !org) {
    redirect(`/onboarding?error=${encodeURIComponent(error?.message ?? "Failed")}`);
  }

  const orgId = (org as { id: string }).id;

  // Set the brand colour (RLS allows the owner to update their own org).
  await supabase
    .from("organizations")
    .update({ brand_color: brandColor, brand_color_secondary: brandColorSecondary })
    .eq("id", orgId);

  // Seed the starter clause library (best-effort; never blocks onboarding).
  await seedClauseLibrary(supabase, orgId);

  redirect("/dashboard");
}
