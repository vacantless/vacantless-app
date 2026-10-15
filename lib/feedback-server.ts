import { createAdminClient } from "@/lib/supabase/admin";
import { viewingNotYet } from "@/lib/feedback";

/** S719/S720: true only when the showing is found and starts after now. */
export async function viewingIsInFuture(showingId: string): Promise<boolean> {
  try {
    const admin = createAdminClient();
    if (!admin) return false;
    const { data } = await admin
      .from("showings")
      .select("scheduled_at")
      .eq("id", showingId)
      .maybeSingle();
    const at = (data as { scheduled_at?: string | null } | null)?.scheduled_at;
    return viewingNotYet(at, Date.now());
  } catch {
    return false;
  }
}
