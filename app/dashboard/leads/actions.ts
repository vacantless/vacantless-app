"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { isLeadStatus } from "@/lib/pipeline";

export async function updateLeadStatus(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !isLeadStatus(status)) return;

  const supabase = createClient();
  // RLS scopes the update to the caller's org; status check is also enforced
  // by the table's CHECK constraint.
  await supabase
    .from("leads")
    .update({
      status,
      ...(status === "leased"
        ? { leased_date: new Date().toISOString().slice(0, 10) }
        : {}),
    })
    .eq("id", id);

  // Log the stage change to the activity timeline.
  const org = await getCurrentOrg();
  if (org) {
    await supabase.from("messages").insert({
      organization_id: org.id,
      lead_id: id,
      channel: "note",
      direction: "outbound",
      body: `Stage changed to ${status}.`,
    });
  }

  revalidatePath(`/dashboard/leads/${id}`);
  revalidatePath("/dashboard/leads");
  revalidatePath("/dashboard");
}

export async function addNote(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!id || !body) return;

  const org = await getCurrentOrg();
  if (!org) return;

  const supabase = createClient();
  await supabase.from("messages").insert({
    organization_id: org.id,
    lead_id: id,
    channel: "note",
    direction: "outbound",
    body,
  });

  revalidatePath(`/dashboard/leads/${id}`);
}
