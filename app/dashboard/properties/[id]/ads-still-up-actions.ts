"use server";

// S723: the landlord says they deleted an outside ad (lib/ads-still-up.ts).
// This is the landlord's own statement, recorded with who and when in the row's
// notes, the same way a pasted ad link marks a row live.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import { takenDownNote } from "@/lib/ads-still-up";
import { closeTakedownItems, resetLiveRunItemsForPost } from "@/lib/facebook-page-takedown";

export async function markAdTakenDown(formData: FormData) {
  const propertyId = String(formData.get("property_id") ?? "");
  const postId = String(formData.get("post_id") ?? "");
  const back = `/dashboard/properties/${encodeURIComponent(propertyId)}`;
  await requireCapability("manage_properties", `${back}?forbidden=1`);
  if (!propertyId || !postId) redirect(back);
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: post } = await supabase
    .from("listing_posts")
    .select("id, notes, status")
    .eq("id", postId)
    .eq("property_id", propertyId)
    .eq("organization_id", org.id)
    .maybeSingle();
  const row = post as { id: string; notes: string | null; status: string | null } | null;
  if (row && row.status === "live") {
    await supabase
      .from("listing_posts")
      .update({ status: "removed", notes: takenDownNote(row.notes, user?.email, new Date()) })
      .eq("id", row.id)
      .eq("organization_id", org.id);
    // S734: a queued takedown item for this post is finished now.
    await closeTakedownItems(supabase, org.id, row.id, "the landlord pressed I took it down");
    await resetLiveRunItemsForPost(supabase, org.id, row.id);
  }
  revalidatePath(back);
  redirect(`${back}?ad=down#ads-still-up`);
}
