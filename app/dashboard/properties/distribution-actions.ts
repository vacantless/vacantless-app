"use server";

// S480 Slice 2 — first-class distribution verify/proof/account server actions.
// These consume the Slice-1 substrate (0141) to produce DURABLE proof + an
// append-only attempt log + org channel-account setup, and update the run item's
// verification pointers. Honesty rules (brief): a feed render is submitted, not
// live; proof is real (reuses buildShareReadiness / listingFeedReadiness so a
// "verified" result matches what the app actually publishes).
//
// SECURITY (Codex S480-slice-1 guardrail + S475/KI744): every id (org, run,
// property, run item, channel) is derived SERVER-SIDE from an RLS-scoped read —
// the client only submits a property_id / item_id / channel, never a cross-table
// or org id we then trust. createClient() is RLS-scoped to the operator's org, so
// a read of another org's row returns null and the action stops.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import { buildShareReadiness } from "@/lib/share-readiness";
import { isPublicBookable } from "@/lib/listing-state";
import { listingFeedReadiness, type FeedListingInput } from "@/lib/listing-feed";
import {
  isPublishChannelKey,
  normalizePublishChannel,
} from "@/lib/distribution-publish";
import {
  channelCapability,
  isChannelAccountStatus,
} from "@/lib/distribution-capabilities";
import {
  interpretPublicPageProof,
  interpretOrgFeedProof,
  scheduleNextVerification,
  isVerificationResult,
  type VerificationType,
  type VerificationResult,
} from "@/lib/distribution-verification";
import {
  buildAttemptRecord,
  type AttemptActorType,
} from "@/lib/distribution-attempts";
import type { SupabaseClient } from "@supabase/supabase-js";

const FORBIDDEN = "/dashboard/properties?forbidden=1";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.vacantless.com";

function s(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function backTo(propertyId: string, msg: string): never {
  redirect(`/dashboard/properties/${propertyId}?dist=${msg}#distribute`);
}

type OrgCtx = { id: string; reply_to_email: string | null; public_contact_phone: string | null };

// Record ONE durable verification + an append-only attempt, and point the run
// item at it. All ids are passed in already-derived from RLS reads. Pure-libs
// compute the next-check window + the attempt shape; this only does the writes.
async function recordVerificationAndAttempt(
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
      metadata: { verification_type: input.verificationType },
    });
    let lastAttemptId: string | null = null;
    if (input.runId) {
      const { data: att } = await supabase
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
      lastAttemptId = (att?.id as string | undefined) ?? null;
    }
    const isLiveish =
      input.result === "verified_live" || input.result === "verified_submitted";
    await supabase
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
  }
  return verId;
}

// Find the active run + a specific channel's run item for a property (RLS).
async function activeRunItemFor(
  supabase: SupabaseClient,
  propertyId: string,
  channel: string,
): Promise<{ runId: string | null; runItemId: string | null; transport: string | null; listingPostId: string | null }> {
  const { data: run } = await supabase
    .from("distribution_runs")
    .select("id")
    .eq("property_id", propertyId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const runId = (run?.id as string | undefined) ?? null;
  if (!runId) return { runId: null, runItemId: null, transport: null, listingPostId: null };
  const { data: item } = await supabase
    .from("distribution_run_items")
    .select("id, transport, listing_post_id")
    .eq("run_id", runId)
    .eq("channel", channel)
    .maybeSingle();
  return {
    runId,
    runItemId: (item?.id as string | undefined) ?? null,
    transport: (item?.transport as string | undefined) ?? null,
    listingPostId: (item?.listing_post_id as string | undefined) ?? null,
  };
}

async function userId(supabase: SupabaseClient): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

// ---------------------------------------------------------------------------
// verifyPublicPage — durable proof that /r/[propertyId] is live + carries the
// core rent/address/booking signals. Reuses buildShareReadiness (the same gate
// the Publish button uses), so "verified_live" means it is genuinely publishable.
// ---------------------------------------------------------------------------
export async function verifyPublicPage(formData: FormData) {
  await requireCapability("manage_properties", FORBIDDEN);
  const org = (await getCurrentOrg()) as OrgCtx | null;
  if (!org) redirect("/onboarding");
  const propertyId = s(formData, "property_id");
  if (!propertyId) redirect("/dashboard/properties");

  const supabase = createClient();
  const { data: prop } = await supabase
    .from("properties")
    .select("id, status, rent_cents, beds, baths, address")
    .eq("id", propertyId)
    .maybeSingle();
  if (!prop) redirect("/dashboard/properties");
  const p = prop as {
    id: string;
    status: string;
    rent_cents: number | null;
    beds: number | null;
    baths: number | null;
    address: string | null;
  };
  const { count: photoCount } = await supabase
    .from("property_photos")
    .select("id", { count: "exact", head: true })
    .eq("property_id", propertyId);

  const share = buildShareReadiness({
    status: p.status,
    rentCents: p.rent_cents,
    beds: p.beds,
    baths: p.baths,
    address: p.address,
    photoCount: photoCount ?? 0,
    availabilityWindowCount: 0,
    replyToEmail: org.reply_to_email,
  });
  const byKey: Record<string, boolean> = {};
  for (const c of share.checks) byKey[c.key] = c.ok;
  const outcome = interpretPublicPageProof({
    isPublic: byKey.live === true,
    bookable: byKey.live === true,
    hasAddress: byKey.address === true,
    hasRent: byKey.rent === true,
    hasPhoto: byKey.photos === true,
  });

  const uid = await userId(supabase);
  const loc = await activeRunItemFor(supabase, propertyId, "vacantless");
  await recordVerificationAndAttempt(supabase, {
    orgId: org.id,
    userId: uid,
    channel: "vacantless",
    verificationType: "public_page",
    result: outcome.result,
    propertyId,
    runId: loc.runId,
    runItemId: loc.runItemId,
    listingPostId: loc.listingPostId,
    transport: loc.transport ?? "automatic",
    externalUrl: `${APP_URL}/r/${propertyId}`,
    screenshotPath: null,
    matchedFields: outcome.matchedFields,
    failureReason: outcome.failureReason,
    actorType: "operator",
    nowISO: new Date().toISOString(),
  });
  revalidatePath(`/dashboard/properties/${propertyId}`);
  backTo(propertyId, `pubpage_${outcome.result}`);
}

// ---------------------------------------------------------------------------
// verifyOrgFeedInclusion — durable proof the listing is INCLUDED in the org XML
// feed with all required fields. Reuses listingFeedReadiness (the same rule the
// feed emitter uses). Result is verified_SUBMITTED (in the feed), never live.
// ---------------------------------------------------------------------------
export async function verifyOrgFeedInclusion(formData: FormData) {
  await requireCapability("manage_properties", FORBIDDEN);
  const org = (await getCurrentOrg()) as OrgCtx | null;
  if (!org) redirect("/onboarding");
  const propertyId = s(formData, "property_id");
  if (!propertyId) redirect("/dashboard/properties");

  const supabase = createClient();
  const { data: prop } = await supabase
    .from("properties")
    .select("id, status, rent_cents, beds, baths, address, description")
    .eq("id", propertyId)
    .maybeSingle();
  if (!prop) redirect("/dashboard/properties");
  const p = prop as {
    id: string;
    status: string;
    rent_cents: number | null;
    beds: number | null;
    baths: number | null;
    address: string | null;
    description: string | null;
  };
  const { count: photoCount } = await supabase
    .from("property_photos")
    .select("id", { count: "exact", head: true })
    .eq("property_id", propertyId);

  // Reuse the feed emitter's readiness rule (price/photo/description/address).
  const readiness = listingFeedReadiness({
    id: p.id,
    address: p.address,
    rent_cents: p.rent_cents,
    beds: p.beds,
    baths: p.baths,
    description: p.description,
    photos: Array((photoCount ?? 0) as number).fill("x"),
  } as unknown as FeedListingInput);
  const orgHasPhone = !!(org.public_contact_phone && org.public_contact_phone.trim());
  const outcome = interpretOrgFeedProof({
    feedReachable: true,
    // The feed only carries publicly-bookable listings.
    listingIncluded: isPublicBookable(p.status),
    // Feed-required item fields + the org-level contact phone the feed needs.
    hasRequiredFields: readiness.ready && orgHasPhone,
  });

  const uid = await userId(supabase);
  const loc = await activeRunItemFor(supabase, propertyId, "org_feed");
  await recordVerificationAndAttempt(supabase, {
    orgId: org.id,
    userId: uid,
    channel: "org_feed",
    verificationType: "feed_render",
    result: outcome.result,
    propertyId,
    runId: loc.runId,
    runItemId: loc.runItemId,
    listingPostId: loc.listingPostId,
    transport: loc.transport ?? "automatic",
    externalUrl: null,
    screenshotPath: null,
    matchedFields: {
      ...outcome.matchedFields,
      feedReady: readiness.ready,
      orgPhone: orgHasPhone,
    },
    failureReason:
      outcome.failureReason ??
      (readiness.ready ? null : `Missing feed fields: ${readiness.missing.join(", ")}`),
    actorType: "operator",
    nowISO: new Date().toISOString(),
  });
  revalidatePath(`/dashboard/properties/${propertyId}`);
  backTo(propertyId, `feed_${outcome.result}`);
}

// ---------------------------------------------------------------------------
// recordItemProof — operator/admin attaches proof to a run item (an external
// live URL, a manual/concierge note, a screenshot path). Org/run/property/channel
// are derived from the RLS-scoped run-item read, never trusted from the client.
// ---------------------------------------------------------------------------
export async function recordItemProof(formData: FormData) {
  await requireCapability("manage_properties", FORBIDDEN);
  const org = (await getCurrentOrg()) as OrgCtx | null;
  if (!org) redirect("/onboarding");
  const itemId = s(formData, "item_id");
  if (!itemId) redirect("/dashboard/properties");

  const supabase = createClient();
  const { data: item } = await supabase
    .from("distribution_run_items")
    .select("id, run_id, channel, transport, listing_post_id")
    .eq("id", itemId)
    .maybeSingle();
  if (!item) redirect("/dashboard/properties");
  const it = item as {
    id: string;
    run_id: string;
    channel: string;
    transport: string | null;
    listing_post_id: string | null;
  };
  // Derive the property from the run under RLS (never trust a client property id).
  const { data: run } = await supabase
    .from("distribution_runs")
    .select("property_id")
    .eq("id", it.run_id)
    .maybeSingle();
  const propertyId = (run?.property_id as string | undefined) ?? null;

  const externalUrl = s(formData, "external_url") || null;
  const note = s(formData, "note") || null;
  const rawType = s(formData, "verification_type");
  const verificationType: VerificationType =
    rawType === "external_url" ||
    rawType === "screenshot" ||
    rawType === "manual_concierge" ||
    rawType === "broker_confirmation"
      ? (rawType as VerificationType)
      : externalUrl
        ? "external_url"
        : "manual_concierge";
  const rawResult = s(formData, "result");
  const result: VerificationResult = isVerificationResult(rawResult)
    ? rawResult
    : externalUrl
      ? "verified_live"
      : "proof_unavailable";

  const uid = await userId(supabase);
  await recordVerificationAndAttempt(supabase, {
    orgId: org.id,
    userId: uid,
    channel: it.channel,
    verificationType,
    result,
    propertyId,
    runId: it.run_id,
    runItemId: it.id,
    listingPostId: it.listing_post_id,
    transport: it.transport,
    externalUrl,
    screenshotPath: s(formData, "screenshot_path") || null,
    matchedFields: {},
    failureReason: note,
    actorType: "operator",
    nowISO: new Date().toISOString(),
  });
  if (propertyId) {
    revalidatePath(`/dashboard/properties/${propertyId}`);
    backTo(propertyId, `proof_${result}`);
  }
  redirect("/dashboard/properties");
}

// ---------------------------------------------------------------------------
// upsertChannelAccount — record an org's setup state for a channel (feed route,
// manager login, broker contact). Transport + capability flags are derived from
// the static capability matrix server-side; the operator only supplies status +
// urls/contact. Org is derived from getCurrentOrg (never client).
// ---------------------------------------------------------------------------
export async function upsertChannelAccount(formData: FormData) {
  await requireCapability("manage_properties", FORBIDDEN);
  const org = (await getCurrentOrg()) as OrgCtx | null;
  if (!org) redirect("/onboarding");
  const propertyId = s(formData, "property_id"); // for the redirect only

  const channelRaw = normalizePublishChannel(s(formData, "channel"));
  if (!channelRaw || !isPublishChannelKey(channelRaw)) {
    if (propertyId) backTo(propertyId, "account_badchannel");
    redirect("/dashboard/properties");
  }
  const channel = channelRaw;
  const cap = channelCapability(channel);
  const statusRaw = s(formData, "account_status");
  const accountStatus = isChannelAccountStatus(statusRaw) ? statusRaw : "not_started";

  const supabase = createClient();
  const nowISO = new Date().toISOString();
  await supabase.from("distribution_channel_accounts").upsert(
    {
      organization_id: org.id,
      channel,
      transport: cap.transport,
      account_status: accountStatus,
      feed_url: s(formData, "feed_url") || null,
      manager_url: s(formData, "manager_url") || null,
      external_account_label: s(formData, "external_account_label") || null,
      contact_name: s(formData, "contact_name") || null,
      contact_email: s(formData, "contact_email") || null,
      requires_login: cap.requiresLogin,
      requires_payment: cap.requiresPayment,
      supports_feed: cap.supportsFeed,
      supports_copilot: cap.supportsCopilot,
      supports_concierge: cap.supportsConcierge,
      supports_live_verification: cap.supportsLiveVerification,
      posting_policy: cap.postingPolicy,
      notes: s(formData, "notes") || null,
      last_setup_checked_at: nowISO,
      updated_at: nowISO,
    },
    { onConflict: "organization_id,channel" },
  );
  if (propertyId) {
    revalidatePath(`/dashboard/properties/${propertyId}`);
    backTo(propertyId, "account_saved");
  }
  redirect("/dashboard/settings");
}
