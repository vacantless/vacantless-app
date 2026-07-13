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
  CONCIERGE_OPEN_STATUSES,
  CONCIERGE_CLAIMED_AUDIT,
  CONCIERGE_LIVE_AUDIT,
  CONCIERGE_REJECTED_AUDIT,
} from "@/lib/distribution-publish";
import { scheduleNextVerification } from "@/lib/distribution-verification";
import { buildAttemptRecord } from "@/lib/distribution-attempts";
import type { SupabaseClient } from "@supabase/supabase-js";

const DESK = "/dashboard/admin/concierge";

// A concierge claim left untouched past this window is treated as abandoned, so
// another staff member can take the item over instead of it locking forever.
const CONCIERGE_CLAIM_TAKEOVER_MS = 15 * 60 * 1000; // 15 minutes

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
  // Only an unclaimed, still-open concierge item can be claimed. The predicates
  // (mode + open status + claimed_by IS NULL) make this atomic: a second staff
  // click, or a claim on an item already marked live, matches 0 rows -> stale.
  const { data: claimed } = await ctx.admin
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
    .eq("id", itemId)
    .eq("mode", "concierge")
    .in("publish_status", CONCIERGE_OPEN_STATUSES as unknown as string[])
    .is("concierge_claimed_by", null)
    .select("id");
  if (!claimed || claimed.length === 0) redirect(`${DESK}?err=stale`);
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

  // Reserve exclusive ownership of THIS completion attempt BEFORE any external
  // side effect. This CAS atomically (a) confirms the item is still an OPEN
  // concierge item and (b) takes/holds the completion lock via
  // concierge_claimed_by: it claims an unclaimed item, lets the existing claimer
  // proceed, or takes over a claim left stale (abandoned) past the takeover
  // window. A concurrent completer by ANOTHER staff loses this CAS and stops at
  // ?err=stale BEFORE the listing_posts write, so two people can never both
  // overwrite the tracked post for one item (the old race: side effect ran first,
  // then the guarded final update rejected the loser AFTER it had written).
  const reservedAt = new Date().toISOString();
  const takeoverCutoff = new Date(Date.now() - CONCIERGE_CLAIM_TAKEOVER_MS)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
  const { data: item } = await admin
    .from("distribution_run_items")
    .update({
      concierge_claimed_by: ctx.userId,
      concierge_claimed_at: reservedAt,
      publish_status: "submitting",
      status: "in_progress",
      last_attempted_at: reservedAt,
      updated_at: reservedAt,
    })
    .eq("id", itemId)
    .eq("mode", "concierge")
    .in("publish_status", CONCIERGE_OPEN_STATUSES as unknown as string[])
    .or(
      `concierge_claimed_by.is.null,concierge_claimed_by.eq.${ctx.userId},concierge_claimed_at.lt.${takeoverCutoff}`,
    )
    .select("id, run_id, channel, listing_post_id")
    .maybeSingle();
  if (!item) redirect(`${DESK}?err=stale`);
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

  // Create or refresh the tracked post for this property+channel. This runs under
  // the SERVICE-ROLE client (no RLS), so every listing_posts touch is pinned to
  // the org+property+portal derived from the RUN — never trusted blindly from the
  // denormalized listing_post_id (a stale/corrupt FK must not let staff overwrite
  // another property's post), and every write is error-checked before we mark the
  // item live.
  let listingPostId = (item.listing_post_id as string | null) ?? null;
  if (url && isPortalKey(channel)) {
    const portal = normalizePortal(channel);
    // Trust the denormalized FK only if it still points at THIS org+property+
    // portal and isn't removed; otherwise discard it and re-resolve.
    if (listingPostId) {
      const { data: fk } = await admin
        .from("listing_posts")
        .select("id")
        .eq("id", listingPostId)
        .eq("organization_id", orgId)
        .eq("property_id", propertyId)
        .eq("portal", portal)
        .neq("status", "removed")
        .maybeSingle();
      if (!fk?.id) listingPostId = null;
    }
    if (!listingPostId) {
      const { data: existingPost } = await admin
        .from("listing_posts")
        .select("id")
        .eq("organization_id", orgId)
        .eq("property_id", propertyId)
        .eq("portal", portal)
        .neq("status", "removed")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existingPost?.id) listingPostId = existingPost.id as string;
    }
    if (listingPostId) {
      const { error: upErr } = await admin
        .from("listing_posts")
        .update({ url, status: "live" })
        .eq("id", listingPostId)
        .eq("organization_id", orgId)
        .eq("property_id", propertyId)
        .eq("portal", portal);
      if (upErr) redirect(`${DESK}?err=trackfail`);
    } else {
      const { data: post, error: insErr } = await admin
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
      if (insErr || !post?.id) redirect(`${DESK}?err=trackfail`);
      listingPostId = post.id as string;
    }
  }

  // A portal channel must have a live tracker before we can honestly mark it live.
  if (isPortalKey(channel) && !listingPostId) redirect(`${DESK}?err=trackfail`);

  const now = new Date().toISOString();
  // Atomic completion guard: only flip an item that is still an OPEN concierge
  // item AND still held by this staffer's reservation lock. If another staff
  // member completed/rejected it (or took over an abandoned claim), this matches
  // 0 rows and we stop before double-completing or re-tracking.
  const { data: completed } = await admin
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
    .eq("id", itemId)
    .eq("mode", "concierge")
    .eq("concierge_claimed_by", ctx.userId)
    .in("publish_status", CONCIERGE_OPEN_STATUSES as unknown as string[])
    .select("id, attempt_count");
  if (!completed || completed.length === 0) redirect(`${DESK}?err=stale`);

  // S480: durable proof + append-only attempt for this concierge-completed
  // channel, and point the run item at them. Reached ONLY by the winning
  // completer (after the S479 atomic flip), so the reservation/ownership
  // invariant is untouched; purely additive writes.
  const verifiedAt = new Date().toISOString();
  const nextCheck = scheduleNextVerification(channel, "verified_live", verifiedAt);
  const { data: proof } = await admin
    .from("distribution_verifications")
    .insert({
      organization_id: orgId,
      property_id: propertyId,
      run_id: item.run_id as string,
      run_item_id: itemId,
      listing_post_id: listingPostId,
      channel,
      verification_type: "manual_concierge",
      result: "verified_live",
      external_url: url,
      checked_by: ctx.userId,
      next_check_at: nextCheck,
      metadata: { source: "concierge_desk" },
    })
    .select("id")
    .single();
  const proofId = (proof?.id as string | undefined) ?? null;
  const priorAttempts = (completed[0]?.attempt_count as number | undefined) ?? 0;
  const attempt = buildAttemptRecord({
    organizationId: orgId,
    runId: item.run_id as string,
    runItemId: itemId,
    channel,
    transport: "concierge",
    currentAttemptCount: priorAttempts,
    actorType: "concierge",
    actorUserId: ctx.userId,
    statusBefore: "submitting",
    statusAfter: "verified_live",
    proofId,
    metadata: { source: "concierge_desk" },
  });
  const { data: att } = await admin
    .from("distribution_publish_attempts")
    .insert({
      organization_id: attempt.organization_id,
      run_id: attempt.run_id,
      run_item_id: attempt.run_item_id,
      channel: attempt.channel,
      transport: attempt.transport,
      attempt_no: attempt.attempt_no,
      actor_type: attempt.actor_type,
      actor_user_id: attempt.actor_user_id,
      status_before: attempt.status_before,
      status_after: attempt.status_after,
      proof_id: attempt.proof_id,
      metadata: attempt.metadata,
    })
    .select("id")
    .single();
  await admin
    .from("distribution_run_items")
    .update({
      verification_status: "verified_live",
      last_verification_id: proofId,
      last_attempt_id: (att?.id as string | undefined) ?? null,
      proof_url: url,
      attempt_count: priorAttempts + 1,
      stale_after: nextCheck,
      updated_at: verifiedAt,
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
  const takeoverCutoff = new Date(Date.now() - CONCIERGE_CLAIM_TAKEOVER_MS)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
  // Only an OPEN concierge item can be rejected; a stale form on an already
  // live/rejected item matches 0 rows -> stale (can't un-live a posted ad). The
  // ownership predicate (unclaimed / self / abandoned-past-takeover) MIRRORS the
  // completion reservation so a DIFFERENT staffer cannot reject an item a
  // completion has just reserved (publish_status='submitting', claimed_by=other)
  // out from under its in-flight listing_posts write -> no stale tracker side
  // effect. A concurrent reject by a non-owner matches 0 rows -> ?err=stale.
  const { data: rejected } = await ctx.admin
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
    .eq("id", itemId)
    .eq("mode", "concierge")
    .in("publish_status", CONCIERGE_OPEN_STATUSES as unknown as string[])
    .or(
      `concierge_claimed_by.is.null,concierge_claimed_by.eq.${ctx.userId},concierge_claimed_at.lt.${takeoverCutoff}`,
    )
    .select("id");
  if (!rejected || rejected.length === 0) redirect(`${DESK}?err=stale`);
  revalidatePath(DESK);
  redirect(`${DESK}?done=rejected`);
}
