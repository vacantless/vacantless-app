"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import { validateTemplateInput } from "@/lib/tenant-comms";

// Org-level message-template CRUD (the "saved templates" half of tenant comms).
// Templates are reusable org assets — branding/settings configuration — so they
// are guarded on manage_settings (owner_admin + operator), the same capability
// that owns branding, reply-to, and feature toggles. The send action itself is
// guarded on manage_tenancies (it acts on a specific tenancy). REDIRECT-based.

const SETTINGS = "/dashboard/settings";

function s(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

export async function saveMessageTemplate(formData: FormData) {
  await requireCapability("manage_settings", `${SETTINGS}?tpl=forbidden`);

  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const id = s(formData, "id"); // present = edit, blank = create
  const check = validateTemplateInput({
    name: s(formData, "name"),
    channel: s(formData, "channel"),
    subject: s(formData, "subject") || null,
    body: s(formData, "body"),
  });
  if (!check.ok) redirect(`${SETTINGS}?tpl=${check.code}#templates`);

  const supabase = createClient();
  const fields = {
    name: check.value.name,
    channel: check.value.channel,
    subject: check.value.subject,
    body: check.value.body,
  };

  if (id) {
    // RLS scopes the update to this org; .eq("id") targets the one row.
    await supabase
      .from("tenant_message_templates")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", id);
  } else {
    await supabase
      .from("tenant_message_templates")
      .insert({ organization_id: org.id, ...fields });
  }

  revalidatePath(SETTINGS);
  // `tn` is a fresh nonce so the create-template form REMOUNTS and its
  // uncontrolled inputs clear on a soft-nav redirect — otherwise a just-created
  // template's values linger and invite a duplicate (S226 QA-audit form-reset).
  redirect(
    `${SETTINGS}?tpl=${id ? "updated" : "created"}&tn=${Date.now().toString(36)}#templates`,
  );
}

export async function deleteMessageTemplate(formData: FormData) {
  await requireCapability("manage_settings", `${SETTINGS}?tpl=forbidden`);

  const id = s(formData, "id");
  if (!id) redirect(`${SETTINGS}#templates`);

  const supabase = createClient();
  await supabase.from("tenant_message_templates").delete().eq("id", id);

  revalidatePath(SETTINGS);
  redirect(`${SETTINGS}?tpl=deleted#templates`);
}
