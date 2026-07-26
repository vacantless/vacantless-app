import type { SupabaseClient } from "@supabase/supabase-js";
import { TAKEDOWN_TRANSPORT } from "@/lib/distribution-worker";
import { leaseupTakedownEnabled } from "@/lib/leaseup-takedown";
import type { Org } from "@/lib/org";

type RunItemRow = {
  id: string;
  organization_id: string;
  run_id: string;
  channel: string;
  transport: string | null;
  publish_status: string | null;
  status: string | null;
  external_url: string | null;
  operator_action_url: string | null;
  listing_post_id: string | null;
};

type RunRow = {
  id: string;
  organization_id: string;
  property_id: string | null;
};

type ListingPostRow = {
  id: string;
  organization_id: string;
  property_id: string | null;
  portal: string;
  status: string | null;
  url: string | null;
};

export type ConfirmLeaseupTakedownRemovedResult =
  | {
      ok: true;
      runItemId: string;
      runId: string;
      propertyId: string;
      listingPostId: string;
      verificationId: string | null;
      idempotent: boolean;
      runCompleted: boolean;
    }
  | {
      ok: false;
      runItemId: string;
      propertyId: string | null;
      reason: string;
    };

const OPEN_TAKEDOWN_STATUSES = new Set(["needs_operator", "queued"]);

function failure(
  runItemId: string,
  reason: string,
  propertyId: string | null = null,
): ConfirmLeaseupTakedownRemovedResult {
  return { ok: false, runItemId, propertyId, reason };
}

function externalUrlFor(item: RunItemRow, post: ListingPostRow): string | null {
  return item.operator_action_url ?? item.external_url ?? post.url ?? null;
}

async function currentUserId(supabase: SupabaseClient): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

async function existingRemovalVerificationId(
  supabase: SupabaseClient,
  args: {
    orgId: string;
    runItemId: string;
    listingPostId: string;
  },
): Promise<string | null> {
  const { data } = await supabase
    .from("distribution_verifications")
    .select("id")
    .eq("organization_id", args.orgId)
    .eq("run_item_id", args.runItemId)
    .eq("listing_post_id", args.listingPostId)
    .eq("result", "removed")
    .limit(1)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

async function completeRunIfResolved(
  supabase: SupabaseClient,
  args: { runId: string; nowISO: string },
): Promise<boolean> {
  const { data } = await supabase
    .from("distribution_run_items")
    .select("publish_status")
    .eq("run_id", args.runId);
  const rows = (data ?? []) as Array<{ publish_status: string | null }>;
  const allResolved =
    rows.length > 0 &&
    rows.every(
      (row) => row.publish_status === "live" || row.publish_status === "skipped",
    );
  if (!allResolved) return false;
  await supabase
    .from("distribution_runs")
    .update({ status: "completed", completed_at: args.nowISO })
    .eq("id", args.runId);
  return true;
}

export async function confirmLeaseupTakedownRemoved({
  supabase,
  org,
  runItemId,
}: {
  supabase: SupabaseClient;
  org: Pick<Org, "id">;
  runItemId: string;
}): Promise<ConfirmLeaseupTakedownRemovedResult> {
  const itemId = runItemId.trim();
  if (!itemId) return failure(itemId, "missing_run_item");
  if (!leaseupTakedownEnabled()) return failure(itemId, "disabled");

  const confirmedBy = await currentUserId(supabase);
  if (!confirmedBy) return failure(itemId, "not_authenticated");

  const { data: itemData, error: itemError } = await supabase
    .from("distribution_run_items")
    .select(
      "id, organization_id, run_id, channel, transport, publish_status, status, external_url, operator_action_url, listing_post_id",
    )
    .eq("id", itemId)
    .eq("organization_id", org.id)
    .maybeSingle();
  if (itemError) return failure(itemId, `item_read_failed: ${itemError.message}`);
  const item = itemData as RunItemRow | null;
  if (!item) return failure(itemId, "not_found");
  if (item.transport !== TAKEDOWN_TRANSPORT) {
    return failure(itemId, "not_takedown");
  }
  if (!item.listing_post_id) {
    return failure(itemId, "no_listing_post");
  }

  const { data: runData, error: runError } = await supabase
    .from("distribution_runs")
    .select("id, organization_id, property_id")
    .eq("id", item.run_id)
    .eq("organization_id", org.id)
    .maybeSingle();
  if (runError) return failure(itemId, `run_read_failed: ${runError.message}`);
  const run = runData as RunRow | null;
  const propertyId = run?.property_id ?? null;
  if (!run || !propertyId) return failure(itemId, "run_not_found");

  const { data: postData, error: postError } = await supabase
    .from("listing_posts")
    .select("id, organization_id, property_id, portal, status, url")
    .eq("id", item.listing_post_id)
    .eq("organization_id", org.id)
    .eq("property_id", propertyId)
    .eq("portal", item.channel)
    .maybeSingle();
  if (postError) {
    return failure(itemId, `listing_post_read_failed: ${postError.message}`, propertyId);
  }
  const post = postData as ListingPostRow | null;
  if (!post) return failure(itemId, "listing_post_not_found", propertyId);

  const externalUrl = externalUrlFor(item, post);
  const existingVerification = await existingRemovalVerificationId(supabase, {
    orgId: org.id,
    runItemId: item.id,
    listingPostId: post.id,
  });
  const wasAlreadyRemoved = post.status === "removed";

  if (!wasAlreadyRemoved) {
    if (!OPEN_TAKEDOWN_STATUSES.has(item.publish_status ?? "")) {
      return failure(itemId, "not_open_takedown", propertyId);
    }
    const { data: removedRows, error: removeError } = await supabase
      .from("listing_posts")
      .update({ status: "removed" })
      .eq("id", post.id)
      .eq("organization_id", org.id)
      .eq("property_id", propertyId)
      .eq("portal", item.channel)
      .eq("status", "live")
      .select("id");
    const removed =
      Array.isArray(removedRows) && removedRows.some((row) => row.id === post.id);
    if (removeError || !removed) {
      return failure(
        itemId,
        `tracker_remove_failed: ${removeError?.message ?? "no_live_row_matched"}`,
        propertyId,
      );
    }
  }

  let verificationId = existingVerification;
  if (!verificationId) {
    const { data: proofRow, error: proofError } = await supabase
      .from("distribution_verifications")
      .insert({
        organization_id: org.id,
        property_id: propertyId,
        run_id: item.run_id,
        run_item_id: item.id,
        listing_post_id: post.id,
        channel: item.channel,
        verification_type: "external_url",
        result: "removed",
        external_url: externalUrl,
        checked_by: confirmedBy,
        metadata: {
          source: "operator_takedown_confirm",
          confirmed_by: confirmedBy,
          listing_post_id: post.id,
          channel: item.channel,
        },
      })
      .select("id")
      .maybeSingle();
    if (proofError || !proofRow?.id) {
      return failure(
        itemId,
        `verification_write_failed: ${proofError?.message ?? "no_row"}`,
        propertyId,
      );
    }
    verificationId = proofRow.id as string;
  }

  const nowISO = new Date().toISOString();
  const { data: completed, error: completeError } = await supabase
    .from("distribution_run_items")
    .update({
      publish_status: "skipped",
      status: "done",
      external_url: externalUrl,
      listing_post_id: post.id,
      audit_message: `Operator confirmed ${item.channel} ad removed after lease-up.`,
      error_code: null,
      error_message: null,
      last_verified_at: nowISO,
      verification_status: "not_found",
      proof_url: externalUrl,
      concierge_claimed_by: null,
      concierge_claimed_at: null,
      operator_submit_approved_at: null,
      operator_submit_approved_by: null,
      last_verification_id: verificationId,
      updated_at: nowISO,
    })
    .eq("id", item.id)
    .eq("organization_id", org.id)
    .select("id");
  const updated =
    Array.isArray(completed) && completed.some((row) => row.id === item.id);
  if (completeError || !updated) {
    return failure(
      itemId,
      `item_update_failed: ${completeError?.message ?? "no_row_matched"}`,
      propertyId,
    );
  }

  const runCompleted = await completeRunIfResolved(supabase, {
    runId: item.run_id,
    nowISO,
  });

  return {
    ok: true,
    runItemId: item.id,
    runId: item.run_id,
    propertyId,
    listingPostId: post.id,
    verificationId,
    idempotent: wasAlreadyRemoved && Boolean(existingVerification),
    runCompleted,
  };
}
