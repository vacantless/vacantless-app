"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import { isNotificationEventKey, validateRecipientsInput } from "@/lib/notifications";

const BASE = "/dashboard/settings/notifications";

function s(fd: FormData, k: string): string {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
}

// Save one event's per-org override (0067). A blank subject/body means "use the
// built-in default" (stored as null), so an operator can revert just by clearing
// the box. Recipients are validated here so a typo is surfaced rather than
// silently dropped at send. Capability-gated like the rest of Settings.
export async function saveNotificationSetting(formData: FormData) {
  await requireCapability("manage_settings", `${BASE}?error=forbidden`);
  const org = await getCurrentOrg();
  if (!org) redirect("/login");

  const eventKey = s(formData, "event_key");
  if (!isNotificationEventKey(eventKey)) redirect(`${BASE}?error=unknown`);

  const enabled = formData.get("enabled") === "on";
  const subjectRaw = s(formData, "subject_template");
  const bodyRaw = s(formData, "body_template");
  const recipientsRaw = s(formData, "recipients");

  const rc = validateRecipientsInput(recipientsRaw);
  if (!rc.ok) {
    redirect(`${BASE}?error=${rc.code}&ev=${encodeURIComponent(eventKey)}`);
  }

  const supabase = createClient();
  const { error } = await supabase.from("notification_settings").upsert(
    {
      organization_id: org.id,
      event_key: eventKey,
      enabled,
      subject_template: subjectRaw === "" ? null : subjectRaw,
      body_template: bodyRaw === "" ? null : bodyRaw,
      recipients: rc.value,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,event_key" },
  );

  if (error) redirect(`${BASE}?error=save&ev=${encodeURIComponent(eventKey)}`);

  revalidatePath(BASE);
  redirect(`${BASE}?saved=${encodeURIComponent(eventKey)}`);
}
