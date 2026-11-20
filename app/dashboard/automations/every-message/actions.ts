"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentOrg } from "@/lib/org";
import { currentUserCan } from "@/lib/membership";
import { createClient } from "@/lib/supabase/server";
import { EXTRA_RECIPIENT_MESSAGE_IDS, MESSAGE_ORG_SWITCHES, type MessageOrgSwitch } from "@/lib/message-catalog";
import { validateRecipientsInput } from "@/lib/notifications";

// S824e: turn one of the plain message switches on or off from "Every message
// we send". Only the columns in MESSAGE_ORG_SWITCHES; nothing else is written.
export async function saveMessageSwitch(formData: FormData) {
  const org = await getCurrentOrg();
  if (!org) redirect("/login?next=/dashboard/automations/every-message");
  if (!(await currentUserCan("manage_settings"))) redirect("/dashboard/automations/every-message?error=forbidden");
  const column = String(formData.get("column") ?? "");
  if (!(MESSAGE_ORG_SWITCHES as readonly string[]).includes(column)) {
    redirect("/dashboard/automations/every-message?error=unknown");
  }
  const on = formData.get("on") === "yes";
  const supabase = createClient();
  const { error } = await supabase
    .from("organizations")
    .update({ [column as MessageOrgSwitch]: on })
    .eq("id", org.id);
  if (error) redirect("/dashboard/automations/every-message?error=save");
  revalidatePath("/dashboard/automations/every-message");
  redirect(`/dashboard/automations/every-message?saved=${encodeURIComponent(column)}#${encodeURIComponent(column)}`);
}

// S824j: "Also send to" on the alerts that go to the account owners. The
// owners still get them; these addresses are added. Empty box removes the row.
export async function saveExtraRecipients(formData: FormData) {
  const org = await getCurrentOrg();
  if (!org) redirect("/login?next=/dashboard/automations/every-message");
  if (!(await currentUserCan("manage_settings"))) redirect("/dashboard/automations/every-message?error=forbidden");
  const messageId = String(formData.get("message_id") ?? "");
  if (!(EXTRA_RECIPIENT_MESSAGE_IDS as readonly string[]).includes(messageId)) {
    redirect("/dashboard/automations/every-message?error=unknown");
  }
  const parsed = validateRecipientsInput(String(formData.get("emails") ?? ""));
  const anchor = `#${encodeURIComponent(messageId)}`;
  if (!parsed.ok) {
    const code = parsed.code === "too_many" ? "too_many" : "bad_email";
    redirect(`/dashboard/automations/every-message?error=${code}&row=${encodeURIComponent(messageId)}${anchor}`);
  }
  const supabase = createClient();
  const { error } = parsed.value.length === 0
    ? await supabase
        .from("message_extra_recipients")
        .delete()
        .eq("organization_id", org.id)
        .eq("message_id", messageId)
    : await supabase
        .from("message_extra_recipients")
        .upsert(
          { organization_id: org.id, message_id: messageId, emails: parsed.value, updated_at: new Date().toISOString() },
          { onConflict: "organization_id,message_id" },
        );
  if (error) redirect(`/dashboard/automations/every-message?error=save${anchor}`);
  revalidatePath("/dashboard/automations/every-message");
  redirect(`/dashboard/automations/every-message?saved=${encodeURIComponent(messageId)}${anchor}`);
}
