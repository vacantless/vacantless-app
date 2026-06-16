"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  normalizeHexColor,
  DEFAULT_BRAND_COLOR,
  DEFAULT_BRAND_SECONDARY,
} from "@/lib/branding";

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

  // Set the brand colour (RLS allows the owner to update their own org).
  await supabase
    .from("organizations")
    .update({ brand_color: brandColor, brand_color_secondary: brandColorSecondary })
    .eq("id", (org as { id: string }).id);

  redirect("/dashboard");
}
