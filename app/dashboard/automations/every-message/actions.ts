"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentOrg } from "@/lib/org";
import { currentUserCan } from "@/lib/membership";
import { createClient } from "@/lib/supabase/server";
import { MESSAGE_ORG_SWITCHES, type MessageOrgSwitch } from "@/lib/message-catalog";

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
