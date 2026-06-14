"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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
  const brandColor = String(formData.get("brand_color") ?? "#4f46e5");

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
    .update({ brand_color: brandColor })
    .eq("id", (org as { id: string }).id);

  redirect("/dashboard");
}
