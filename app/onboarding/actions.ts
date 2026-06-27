"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  normalizeHexColor,
  DEFAULT_BRAND_COLOR,
  DEFAULT_BRAND_SECONDARY,
} from "@/lib/branding";
import {
  seedClauseLibrary,
  seedTenantMessageTemplates,
} from "@/lib/org-seeds-server";
import { acceptReferral } from "@/lib/referrals-server";

// Org-seeding helpers (clause library + tenant-message templates) now live in
// lib/org-seeds-server.ts so the provisioning primitive can reuse them with the
// service-role client. Imported above.

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

  // Set the brand colour + default the new org to the free funnel tier (S299:
  // the create_organization RPC inserts with the DB default 'trial'; Package B
  // makes 'free' the permanent no-card starting tier — 1 listing + the
  // standalone tools — so a fresh org lands on 'free', not the legacy 'trial').
  // RLS allows the owner to update their own org; best-effort like the brand set.
  await supabase
    .from("organizations")
    .update({
      brand_color: brandColor,
      brand_color_secondary: brandColorSecondary,
      plan: "free",
    })
    .eq("id", orgId);

  // Seed the starter clause library (best-effort; never blocks onboarding).
  await seedClauseLibrary(supabase, orgId);

  // Seed the starter tenant-message templates (best-effort; never blocks).
  await seedTenantMessageTemplates(supabase, orgId);

  // Referral attribution (best-effort; never blocks onboarding). If this signup
  // arrived via a referral link (/signup?ref=... -> hidden field), flip the
  // referrer's pending invite to accepted with this new org. The flip needs the
  // service-role client (the friend can't update the referrer's row under RLS),
  // which acceptReferral handles; a missing/invalid/used token is a silent skip.
  const ref = String(formData.get("ref") ?? "").trim();
  if (ref) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      await acceptReferral(ref, orgId, user.id).catch(() => {});
    }
  }

  redirect("/dashboard");
}
