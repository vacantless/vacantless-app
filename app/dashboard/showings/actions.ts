"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/membership";
import { isShowingOutcome, showingOutcomeLabel } from "@/lib/pipeline";

// Operator sets the outcome of a showing. RLS scopes everything to the org.
// attended -> advance the lead to 'showed'; the change is logged to the lead
// timeline so the pipeline history stays complete (the audit gap M3 closes).
export async function updateShowingOutcome(formData: FormData) {
  await requireCapability("manage_showings", "/dashboard/showings?forbidden=1");
  const id = String(formData.get("id") ?? "");
  const outcome = String(formData.get("outcome") ?? "");
  if (!id || !isShowingOutcome(outcome)) return;

  const supabase = createClient();
  const { data: showing } = await supabase
    .from("showings")
    .update({ outcome })
    .eq("id", id)
    .select("id, lead_id, organization_id, scheduled_at")
    .maybeSingle();

  if (!showing) return;
  const s = showing as {
    lead_id: string | null;
    organization_id: string;
    scheduled_at: string | null;
  };

  if (s.lead_id) {
    // Promote the lead to 'showed' when a showing is marked attended.
    if (outcome === "attended") {
      await supabase
        .from("leads")
        .update({ status: "showed" })
        .eq("id", s.lead_id)
        .in("status", ["new", "replied", "contacted", "booked"]);
    }

    await supabase.from("messages").insert({
      organization_id: s.organization_id,
      lead_id: s.lead_id,
      channel: "note",
      direction: "outbound",
      body: `Showing marked ${showingOutcomeLabel(outcome)}.`,
    });

    revalidatePath(`/dashboard/leads/${s.lead_id}`);
  }

  revalidatePath("/dashboard/showings");
  revalidatePath("/dashboard");
}
