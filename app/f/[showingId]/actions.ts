"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Public, unauthenticated feedback submission. Calls a SECURITY DEFINER RPC
// that resolves the org from the showing, inserts one feedback row, and logs
// the lead timeline — the renter can leave feedback for their own showing but
// can never read or target another tenant's data. The RPC rejects an
// out-of-range rating and a duplicate submission.
export async function submitFeedback(formData: FormData) {
  const showingId = String(formData.get("showing_id") ?? "");
  if (!showingId) return;

  const ratingRaw = String(formData.get("rating") ?? "").trim();
  const rating = Number.parseInt(ratingRaw, 10);
  const comments = String(formData.get("comments") ?? "").trim();

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    redirect(`/f/${showingId}?error=rating`);
  }

  const supabase = createClient();
  const { error } = await supabase.rpc("submit_public_feedback", {
    p_showing_id: showingId,
    p_rating: rating,
    p_comments: comments || null,
  });

  if (error) {
    // Duplicate submission or any other RPC error → friendly state on the page.
    redirect(`/f/${showingId}?error=1`);
  }

  redirect(`/f/${showingId}?submitted=1`);
}
