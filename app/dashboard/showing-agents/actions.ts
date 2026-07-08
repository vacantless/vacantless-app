"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import { validateShowingAgent } from "@/lib/showing-agents";

const BASE = "/dashboard/showing-agents";

function s(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

// The product-type checkboxes post as repeated `product_types` values.
function productTypes(formData: FormData): string[] {
  return formData.getAll("product_types").map((v) => String(v));
}

// Configuring WHO your showing agents are is a team/settings action, so it
// requires manage_settings (owner_admin + operator; a showing_helper cannot edit
// the roster). Assigning a viewing to an agent is a separate, lighter gate on
// the showings surface.
export async function createShowingAgent(formData: FormData) {
  await requireCapability("manage_settings", `${BASE}?agent=forbidden`);
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const check = validateShowingAgent({
    name: s(formData, "name"),
    email: s(formData, "email") || null,
    phone: s(formData, "phone") || null,
    tier: s(formData, "tier") || null,
    service_area: s(formData, "service_area") || null,
    product_types: productTypes(formData),
    weekly_capacity: s(formData, "weekly_capacity") || null,
  });
  if (!check.ok) redirect(`${BASE}?agent=${check.code}`);

  const supabase = createClient();
  await supabase.from("showing_agents").insert({
    organization_id: org.id,
    name: check.value.name,
    email: check.value.email,
    phone: check.value.phone,
    tier: check.value.tier,
    service_area: check.value.service_area,
    product_types: check.value.product_types,
    weekly_capacity: check.value.weekly_capacity,
    note: s(formData, "note") || null,
  });

  revalidatePath(BASE);
  redirect(`${BASE}?agent=saved`);
}

export async function updateShowingAgent(formData: FormData) {
  await requireCapability("manage_settings", `${BASE}?agent=forbidden`);
  const id = s(formData, "id");
  if (!id) redirect(`${BASE}?agent=missing`);

  const check = validateShowingAgent({
    name: s(formData, "name"),
    email: s(formData, "email") || null,
    phone: s(formData, "phone") || null,
    tier: s(formData, "tier") || null,
    service_area: s(formData, "service_area") || null,
    product_types: productTypes(formData),
    weekly_capacity: s(formData, "weekly_capacity") || null,
  });
  if (!check.ok) redirect(`${BASE}?agent=${check.code}`);

  const supabase = createClient();
  // RLS scopes the update to the caller's org; no explicit org filter needed.
  await supabase
    .from("showing_agents")
    .update({
      name: check.value.name,
      email: check.value.email,
      phone: check.value.phone,
      tier: check.value.tier,
      service_area: check.value.service_area,
      product_types: check.value.product_types,
      weekly_capacity: check.value.weekly_capacity,
      note: s(formData, "note") || null,
    })
    .eq("id", id);

  revalidatePath(BASE);
  redirect(`${BASE}?agent=saved`);
}

// Soft-hide an agent so they drop out of the assignment picker without breaking
// the assignment history of past viewings (assigned_agent_id is on-delete-set-
// null, and archived agents are excluded from the picker in the UI).
export async function setShowingAgentArchived(formData: FormData) {
  await requireCapability("manage_settings", `${BASE}?agent=forbidden`);
  const id = s(formData, "id");
  const archived = s(formData, "archived") === "true";
  if (!id) redirect(`${BASE}?agent=missing`);

  const supabase = createClient();
  await supabase.from("showing_agents").update({ archived }).eq("id", id);

  revalidatePath(BASE);
  redirect(`${BASE}?agent=${archived ? "archived" : "restored"}`);
}
