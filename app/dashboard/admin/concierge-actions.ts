"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminEmail } from "@/lib/provisioning";
import { adminEmails } from "@/lib/provisioning-server";
import {
  isPortalKey,
  normalizePortal,
  normalizeUrl,
  normalizeText,
  validateListingPost,
} from "@/lib/listing-distribution";
import {
  isResolvedPublishStatus,
  normalizePublishStatus,
  CONCIERGE_CLAIMED_AUDIT,
  CONCIERGE_LIVE_AUDIT,
  CONCIERGE_REJECTED_AUDIT,
} from "@/lib/distribution-publish";
import type { SupabaseClient } from "@supabase/supabase-js";

const DESK = "/dashboard/admin/concierge";

// Gate every concierge-desk mutation on the superadmin allowlist (the page 404s
// for non-admins; this rechecks server-side before the service-role client, which
// bypasses RLS to work across orgs) — mirrors the guideline console (S465).
async function requireConciergeAdmin(): Promise<
  { admin: SupabaseClient; userId: string } | null
> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdminEmail(user?.email, adminEmails())) return null;
  const admin = createAdminClient();
  if (!admin || !user) return null;
  return { admin, userId: user.id };
}

// A staff member claims an item so two people don't post the same listing.
export async function claimConciergeItem(formData: FormData) {
  const itemId = String(formData.get("item_id") ?? "");
  const ctx = await requireConciergeAdmin();
  if (!ctx) redirect("/dashboard");
  if (!itemId) redirect(DESK);
  const now = new Date().toISOString();
  await ctx.admin
    .from("distribution_run_items")
    .update({
      concierge_claimed_by: ctx.userId,
      concierge_claimed_at: now,
      publish_status: "submitting",
      status: "in_progress",
      audit_message: CONCIERGE_CLAIMED_AUDIT,
      last_attempted_at: now,
      updated_at: now,
    })
    .eq("id", itemId);
  revalidatePath(DESK);
  redirect(`${DESK}?done=claimed`);
}

// Staff posted the ad and pastes its live URL. Produces/refreshes the tracked
// listing_posts row (so lead attribution works) exactly like the operator's
// updateRunItem path, then flips the item to Live.
export async function completeConciergeItem(formData: FormData) {
  const itemId = String(formData.get("item_id") ?? "");
  const ctx = await requireConciergeAdmin();
  if (!ctx) redirect("/dashboard");
  if (!itemId) redirect(DESK);
  const admin = ctx.admin;
  const url = normalizeUrl(formData.get("external_url"));

  const { data: item } = await admin
    .from("distribution_run_items")
    .select("id, run_id, channel, listing_post_id")
    .eq("id", itemId)
    .maybeSingle();
  if (!item) redirect(`${DESK}?err=notfound`);
  const { data: run } = await admin
    .from("distribution_runs")
    .select("property_id, organization_id")
    .eq("id", item.run_id as string)
    .maybeSingle();
  if (!run) redirect(`${DESK}?err=notfound`);
  const propertyId = run.property_id as string;
  const orgId = run.organization_id as string;
  const channel = item.channel as string;

  // A live external ad needs a real web link to be tracked/reopened.
  if (isPortalKey(channel)) {
    const portal = normalizePortal(channel);
    const check = validateListingPost({ portal, status: "live", url });
    if (!check.ok) redirect(`${DESK}?err=needurl`);
  } else if (!url) {
    redirect(`${DESK}?err=needurl`);
  }

  // Create or refresh the tracked post for this property+channel (reuse the most
  // recent non-removed row rather than inserting a duplicate).
  let listingPostId = (item.listing_post_id as string | null) ?? null;
  if (url && isPortalKey(channel)) {
    const portal = normalizePortal(channel);
    if (!listingPostId) {
      const { data: existingPost } = await admin
        .from("listing_posts")
        .select("id")
        .eq("property_id", propertyId)
        .eq("portal", portal)
        .neq("status", "removed")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existingPost?.id) listingPostId = existingPost.id as string;
    }
    if (listingPostId) {
      await admin
        .from("listing_posts")
        .update({ url, status: "live" })
        .eq("id", listingPostId);
    } else {
      const { data: post } = await admin
        .from("listing_posts")
        .insert({
          organization_id: orgId,
          property_id: propertyId,
          portal,
          url,
          status: "live",
        })
        .select("id")
        .single();
      listingPostId = (post?.id as string | undefined) ?? null;
    }
  }

  const now = new Date().toISOString();
  await admin
    .from("distribution_run_items")
    .update({
      publish_status: "live",
      status: "done",
      external_url: url,
      listing_post_id: listingPostId,
      audit_message: CONCIERGE_LIVE_AUDIT,
      error_code: null,
      error_message: null,
      last_verified_at: now,
      updated_at: now,
    })
    .eq("id", itemId);

  // Complete the run once every item is resolved (live/submitted/skipped).
  const { data: siblings } = await admin
    .from("distribution_run_items")
    .select("publish_status")
    .eq("run_id", item.run_id as string);
  const rows = (siblings ?? []) as { publish_status: string | null }[];
  const allResolved =
    rows.length > 0 &&
    rows.every((r) => isResolvedPublishStatus(normalizePublishStatus(r.publish_status)));
  await admin
    .from("distribution_runs")
    .update({
      status: allResolved ? "completed" : "active",
      completed_at: allResolved ? now : null,
    })
    .eq("id", item.run_id as string);

  revalidatePath(DESK);
  revalidatePath(`/dashboard/properties/${propertyId}`);
  redirect(`${DESK}?done=live`);
}

// Staff couldn't post it (channel blocked, listing pulled, etc.). Records the
// reason and flips to rejected so the operator sees it on their run timeline.
export async function rejectConciergeItem(formData: FormData) {
  const itemId = String(formData.get("item_id") ?? "");
  const ctx = await requireConciergeAdmin();
  if (!ctx) redirect("/dashboard");
  if (!itemId) redirect(DESK);
  const reason = normalizeText(formData.get("reason")) ?? "Could not post to this channel.";
  const now = new Date().toISOString();
  await ctx.admin
    .from("distribution_run_items")
    .update({
      publish_status: "rejected",
      status: "in_progress",
      error_code: "rejected",
      error_message: reason,
      audit_message: CONCIERGE_REJECTED_AUDIT,
      last_attempted_at: now,
      updated_at: now,
    })
    .eq("id", itemId);
  revalidatePath(DESK);
  redirect(`${DESK}?done=rejected`);
}
