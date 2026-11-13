"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import { cleanNote, isCrewRole, isStage } from "@/lib/unit-progress";

// S788b: the landlord's side of unit progress links (PLAN-S788-UNIT-PROGRESS).
const BASE = "/dashboard/crew";

function s(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function addCrewMember(formData: FormData) {
  await requireCapability("manage_settings", `${BASE}?crew=forbidden`);
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");
  const name = s(formData, "name").slice(0, 120);
  const role = s(formData, "role");
  if (!name) redirect(`${BASE}?crew=name_required`);
  if (!isCrewRole(role)) redirect(`${BASE}?crew=role_required`);
  const supabase = createClient();
  const { error } = await supabase.from("crew_members").insert({
    organization_id: org.id,
    name,
    role,
    contact: s(formData, "contact").slice(0, 200) || null,
  });
  if (error) redirect(`${BASE}?crew=error`);
  revalidatePath(BASE);
  redirect(`${BASE}?crew=added`);
}

export async function setCrewMemberActive(formData: FormData) {
  await requireCapability("manage_settings", `${BASE}?crew=forbidden`);
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");
  const id = s(formData, "id");
  const active = s(formData, "active") === "1";
  const supabase = createClient();
  await supabase
    .from("crew_members")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", org.id);
  revalidatePath(BASE);
  redirect(`${BASE}?crew=${active ? "on" : "off"}`);
}

/** A fresh link for one person; the old one stops working. */
export async function newCrewLink(formData: FormData) {
  await requireCapability("manage_settings", `${BASE}?crew=forbidden`);
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");
  const supabase = createClient();
  await supabase
    .from("crew_members")
    .update({ link_token: crypto.randomUUID(), updated_at: new Date().toISOString() })
    .eq("id", s(formData, "id"))
    .eq("organization_id", org.id);
  revalidatePath(BASE);
  redirect(`${BASE}?crew=new_link`);
}

/** The landlord sets a stage. Rented is set on the rental page (Leased), which takes the ads down. */
export async function setUnitStage(formData: FormData) {
  await requireCapability("manage_properties", `${BASE}?crew=forbidden`);
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");
  const stage = s(formData, "stage");
  const propertyId = s(formData, "property_id");
  if (!isStage(stage) || stage === "rented" || stage === "touch_up" || stage === "live") redirect(`${BASE}?crew=stage_invalid`);
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from("unit_progress_events").insert({
    organization_id: org.id,
    property_id: propertyId,
    stage,
    actor_user_id: user?.id ?? null,
    note: cleanNote(formData.get("note")),
  });
  if (error) redirect(`${BASE}?crew=error`);
  revalidatePath(BASE);
  redirect(`${BASE}?crew=stage_saved#u-${propertyId}`);
}
