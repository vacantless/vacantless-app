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

const TEMPLATE_PAGE = "/dashboard/tenancies/message-templates";

function s(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

export async function saveMessageTemplate(formData: FormData) {
  await requireCapability("manage_settings", `${TEMPLATE_PAGE}?tpl=forbidden`);

  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const id = s(formData, "id"); // present = edit, blank = create
  const check = validateTemplateInput({
    name: s(formData, "name"),
    channel: s(formData, "channel"),
    subject: s(formData, "subject") || null,
    body: s(formData, "body"),
  });
  if (!check.ok) redirect(`${TEMPLATE_PAGE}?tpl=${check.code}`);

  const supabase = createClient();
  const fields = {
    name: check.value.name,
    channel: check.value.channel,
    subject: check.value.subject,
    body: check.value.body,
  };

  // Surface a DB failure instead of swallowing it. Without this, a failed
  // insert/update (RLS, grant, or constraint) would still fall through to the
  // "created"/"updated" success redirect below — a false success with no saved
  // row, exactly the confusing silent failure the QA review flagged. On error
  // we redirect with a visible message and the form keeps its typed values.
  const { error } = id
    ? // RLS scopes the update to this org; .eq("id") targets the one row.
      await supabase
        .from("tenant_message_templates")
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq("id", id)
    : await supabase
        .from("tenant_message_templates")
        .insert({ organization_id: org.id, ...fields });

  if (error) redirect(`${TEMPLATE_PAGE}?tpl=savefailed`);

  revalidatePath(TEMPLATE_PAGE);
  // `tn` is a fresh nonce so the create-template form REMOUNTS and its
  // uncontrolled inputs clear on a soft-nav redirect — otherwise a just-created
  // template's values linger and invite a duplicate (S226 QA-audit form-reset).
  redirect(
    `${TEMPLATE_PAGE}?tpl=${id ? "updated" : "created"}&tn=${Date.now().toString(36)}`,
  );
}

export async function deleteMessageTemplate(formData: FormData) {
  await requireCapability("manage_settings", `${TEMPLATE_PAGE}?tpl=forbidden`);

  const id = s(formData, "id");
  if (!id) redirect(TEMPLATE_PAGE);

  const supabase = createClient();
  await supabase.from("tenant_message_templates").delete().eq("id", id);

  revalidatePath(TEMPLATE_PAGE);
  redirect(`${TEMPLATE_PAGE}?tpl=deleted`);
}
