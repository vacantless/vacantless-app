// ============================================================================
// The ONE durable verification write (S480), shared by the server actions.
// Records a distribution_verifications row, an append-only publish attempt, and
// points the run item at both. Lifted out of distribution-actions.ts in S695 so
// updateRunItem (actions.ts) writes the same proof the deleted completeCopilotPost
// wrote: without it a Facebook or Kijiji item flipped live through the generic
// form never counted as live on the send-live stage (lib/stage3-send-live.ts
// needs a verified_live row). No IO of its own beyond the supabase client
// passed in; the pure libs compute the next-check window and the attempt shape.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  scheduleNextVerification,
  type VerificationType,
  type VerificationResult,
} from "./distribution-verification";
import { buildAttemptRecord, type AttemptActorType } from "./distribution-attempts";

// Record ONE durable verification + an append-only attempt, and point the run
// item at it. All ids are passed in already-derived from RLS reads. Pure-libs
// compute the next-check window + the attempt shape; this only does the writes.
export async function recordVerificationAndAttempt(
  supabase: SupabaseClient,
  input: {
    orgId: string;
    userId: string | null;
    channel: string;
    verificationType: VerificationType;
    result: VerificationResult;
    propertyId: string | null;
    runId: string | null;
    runItemId: string | null;
    listingPostId: string | null;
    transport: string | null;
    externalUrl: string | null;
    screenshotPath: string | null;
    matchedFields: Record<string, boolean>;
    failureReason: string | null;
    actorType: AttemptActorType;
    metadata?: Record<string, unknown>;
    nowISO: string;
  },
): Promise<string | null> {
  const nextCheck = scheduleNextVerification(input.channel, input.result, input.nowISO);
  const { data: ver, error: verErr } = await supabase
    .from("distribution_verifications")
    .insert({
      organization_id: input.orgId,
      property_id: input.propertyId,
      run_id: input.runId,
      run_item_id: input.runItemId,
      listing_post_id: input.listingPostId,
      channel: input.channel,
      verification_type: input.verificationType,
      result: input.result,
      external_url: input.externalUrl,
      screenshot_path: input.screenshotPath,
      matched_fields: input.matchedFields,
      failure_reason: input.failureReason,
      checked_by: input.userId,
      next_check_at: nextCheck,
    })
    .select("id")
    .single();
  if (verErr || !ver?.id) return null;
  const verId = ver.id as string;

  if (input.runItemId) {
    // Re-read the run item under RLS for the current attempt count + status.
    const { data: item } = await supabase
      .from("distribution_run_items")
      .select("attempt_count, verification_status, transport")
      .eq("id", input.runItemId)
      .maybeSingle();
    const row = (item ?? null) as
      | { attempt_count: number | null; verification_status: string | null; transport: string | null }
      | null;
    const attempt = buildAttemptRecord({
      organizationId: input.orgId,
      runId: input.runId ?? "",
      runItemId: input.runItemId,
      channel: input.channel,
      transport: input.transport ?? row?.transport ?? null,
      currentAttemptCount: row?.attempt_count ?? 0,
      actorType: input.actorType,
      actorUserId: input.userId,
      statusBefore: row?.verification_status ?? null,
      statusAfter: input.result,
      proofId: verId,
      metadata: {
        verification_type: input.verificationType,
        ...(input.metadata ?? {}),
      },
    });
    let lastAttemptId: string | null = null;
    if (input.runId) {
      const { data: att, error: attErr } = await supabase
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
          error_code: attempt.error_code,
          error_message: attempt.error_message,
          proof_id: attempt.proof_id,
          metadata: attempt.metadata,
        })
        .select("id")
        .single();
      if (attErr) return null;
      lastAttemptId = (att?.id as string | undefined) ?? null;
    }
    const isLiveish =
      input.result === "verified_live" || input.result === "verified_submitted";
    const { error: updErr } = await supabase
      .from("distribution_run_items")
      .update({
        last_verification_id: verId,
        verification_status: input.result,
        proof_url: input.externalUrl,
        proof_screenshot_path: input.screenshotPath,
        last_attempt_id: lastAttemptId,
        attempt_count: (row?.attempt_count ?? 0) + 1,
        next_retry_at: nextCheck,
        stale_after: isLiveish ? nextCheck : null,
        updated_at: input.nowISO,
      })
      .eq("id", input.runItemId);
    if (updErr) return null;
  }
  return verId;
}

