"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { isLeadStatus } from "@/lib/pipeline";
import { normalizeDate, normalizeText } from "@/lib/lead-detail";

// Confirm a lead belongs to the caller's org before we write anything that
// carries its id (audit C6). The RLS select only returns leads in the caller's
// org, so a foreign / forged lead id resolves to "not found" and the action
// no-ops. This guards the messages insert in particular: messages' RLS WITH
// CHECK only validates organization_id, so without this a note could be written
// referencing another org's lead id.
async function leadInOrg(
  supabase: ReturnType<typeof createClient>,
  id: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("leads")
    .select("id")
    .eq("id", id)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

export async function updateLeadStatus(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !isLeadStatus(status)) return;

  const supabase = createClient();
  if (!(await leadInOrg(supabase, id))) return;
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
  if (!(await leadInOrg(supabase, id))) return;
  await supabase.from("messages").insert({
    organization_id: org.id,
    lead_id: id,
    channel: "note",
    direction: "outbound",
    body,
  });

  revalidatePath(`/dashboard/leads/${id}`);
}

// Set (or update) a follow-up reminder on a lead. A blank date clears it.
export async function setNextAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const date = normalizeDate(formData.get("next_action_at"));
  const note = normalizeText(formData.get("next_action_note"));

  const org = await getCurrentOrg();
  if (!org) return;

  const supabase = createClient();
  if (!(await leadInOrg(supabase, id))) return;
  // RLS scopes the update to the caller's org. A blank date clears the follow-up
  // (and its note, which is meaningless without a date).
  await supabase
    .from("leads")
    .update({
      next_action_at: date,
      next_action_note: date ? note : null,
    })
    .eq("id", id);

  // Log to the activity timeline so the change is visible in history.
  await supabase.from("messages").insert({
    organization_id: org.id,
    lead_id: id,
    channel: "note",
    direction: "outbound",
    body: date
      ? `Follow-up set for ${date}${note ? `: ${note}` : ""}.`
      : "Follow-up cleared.",
  });

  revalidatePath(`/dashboard/leads/${id}`);
  revalidatePath("/dashboard/leads");
}

// Clear a follow-up reminder (e.g. once it's been actioned).
export async function clearNextAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const org = await getCurrentOrg();
  if (!org) return;

  const supabase = createClient();
  if (!(await leadInOrg(supabase, id))) return;
  await supabase
    .from("leads")
    .update({ next_action_at: null, next_action_note: null })
    .eq("id", id);

  await supabase.from("messages").insert({
    organization_id: org.id,
    lead_id: id,
    channel: "note",
    direction: "outbound",
    body: "Follow-up marked done.",
  });

  revalidatePath(`/dashboard/leads/${id}`);
  revalidatePath("/dashboard/leads");
}
