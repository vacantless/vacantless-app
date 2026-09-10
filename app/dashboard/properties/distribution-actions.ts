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
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import { buildShareReadiness } from "@/lib/share-readiness";
import { isPublicBookable } from "@/lib/listing-state";
import { listingFeedReadiness, type FeedListingInput } from "@/lib/listing-feed";
import {
  isPublishChannelKey,
  normalizePublishChannel,
  isPublishStatus,
  isResolvedPublishStatus,
} from "@/lib/distribution-publish";
import {
  buildTrackedLink,
  normalizePortal,
  validateListingPost,
} from "@/lib/listing-distribution";
import { channelByKey } from "@/lib/distribution-channels";
import {
  channelCapability,
  isChannelAccountStatus,
} from "@/lib/distribution-capabilities";
import {
  interpretPublicPageProof,
  interpretOrgFeedProof,
  isVerificationResult,
  type VerificationType,
  type VerificationResult,
} from "@/lib/distribution-verification";
import { recordVerificationAndAttempt } from "@/lib/distribution-verification-write";
import { buildAttemptRecord } from "@/lib/distribution-attempts";
import {
  deleteChannelSession,
  readChannelSession,
} from "@/lib/distribution-session-crypto";
import {
  buildPageFeedMessage,
  postToFacebookPageFeed,
} from "@/lib/facebook-page-graph";
import {
  facebookOAuthConfigured,
  fbPageChannelEnabled,
  igChannelEnabled,
  igChannelEnabledForOrg,
  FACEBOOK_FEED_CHANNEL,
  INSTAGRAM_CHANNEL,
} from "@/lib/facebook-page-oauth";
import {
  buildInstagramCaption,
  postToInstagram,
} from "@/lib/instagram-graph";
import { confirmLeaseupTakedownRemoved } from "@/lib/leaseup-takedown-confirm";
import { buildRelistRadarClockUpdate } from "@/lib/relist-radar";
import { envFlagEnabled } from "@/lib/auto-listing-copy";
import {
  authorizedInstantPublishDestinations,
  type AutoDistributionAccountRow,
  type InstantPublishDestination,
} from "@/lib/auto-distribution";
import {
  propertyChannelAutomationRedirectPath,
  settingsChannelAutomationRedirectPath,
} from "@/lib/channel-automation-navigation";
import type { SupabaseClient } from "@supabase/supabase-js";

const FORBIDDEN = "/dashboard/properties?forbidden=1";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.vacantless.com";

function s(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function backTo(propertyId: string, msg: string, channel?: string): never {
  redirect(propertyChannelAutomationRedirectPath(propertyId, msg, channel));
}

type OrgCtx = { id: string; reply_to_email: string | null; public_contact_phone: string | null };

// S695: recordVerificationAndAttempt moved to lib/distribution-verification-write.ts
// so updateRunItem (actions.ts) can write the same proof row the co-pilot used to.

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

function channelAutomationBackTo(
  propertyId: string,
  msg: string,
  channel?: string,
): never {
  if (propertyId) backTo(propertyId, msg, channel);
  redirect(settingsChannelAutomationRedirectPath(msg, channel));
}

function apiAutomaticChannelFromForm(
  formData: FormData,
  propertyId: string,
): string {
  const channelRaw = normalizePublishChannel(s(formData, "channel"));
  if (!channelRaw || !isPublishChannelKey(channelRaw)) {
    channelAutomationBackTo(propertyId, "channel_auto_badchannel");
  }
  const channel = channelByKey(channelRaw);
  if (!channel || channel.mode !== "api_automatic") {
    channelAutomationBackTo(propertyId, "channel_auto_badchannel", channelRaw);
  }
  return channelRaw;
}

async function requireCurrentOrgProperty(
  supabase: SupabaseClient,
  propertyId: string,
  orgId: string,
): Promise<void> {
  if (!propertyId) return;
  const { data: property } = await supabase
    .from("properties")
    .select("id")
    .eq("id", propertyId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!property) redirect(FORBIDDEN);
}

export async function readInstantPublishDestinations(
  propertyId: string,
): Promise<InstantPublishDestination[]> {
  await requireCapability("manage_properties", FORBIDDEN);
  const id = String(propertyId ?? "").trim();
  if (!id) return [];

  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");
  const supabase = createClient();
  await requireCurrentOrgProperty(supabase, id, org.id);

  const { data: accountRows } = await supabase
    .from("distribution_channel_accounts")
    .select("channel, account_status, automation_authorized")
    .eq("organization_id", org.id);

  return authorizedInstantPublishDestinations({
    organizationId: org.id,
    accountRows: (accountRows ?? []) as AutoDistributionAccountRow[],
  });
}

async function recordChannelAutomationConsentAttempt(
  supabase: SupabaseClient,
  input: {
    orgId: string;
    propertyId: string;
    channel: string;
    userId: string;
    authorized: boolean;
  },
): Promise<void> {
  if (!input.propertyId) return;
  const loc = await activeRunItemFor(supabase, input.propertyId, input.channel);
  if (!loc.runId || !loc.runItemId) return;

  const { data: item } = await supabase
    .from("distribution_run_items")
    .select("attempt_count, publish_status, transport")
    .eq("id", loc.runItemId)
    .eq("organization_id", input.orgId)
    .maybeSingle();
  const row = item as
    | {
        attempt_count: number | null;
        publish_status: string | null;
        transport: string | null;
      }
    | null;
  if (!row) return;

  const publishStatus = row.publish_status ?? "queued";
  const attempt = buildAttemptRecord({
    organizationId: input.orgId,
    runId: loc.runId,
    runItemId: loc.runItemId,
    channel: input.channel,
    transport: row.transport ?? loc.transport ?? "automatic",
    currentAttemptCount: row.attempt_count,
    actorType: "operator",
    actorUserId: input.userId,
    statusBefore: publishStatus,
    statusAfter: publishStatus,
    proofId: null,
    metadata: {
      source: input.authorized
        ? "operator_authorized_channel_automation"
        : "operator_revoked_channel_automation",
      automation_authorized: input.authorized,
    },
  });
  await supabase.from("distribution_publish_attempts").insert({
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
  });
}

export async function authorizeChannelAutomation(formData: FormData) {
  await requireCapability("manage_properties", FORBIDDEN);
  const propertyId = s(formData, "property_id");
  const channel = apiAutomaticChannelFromForm(formData, propertyId);

  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");
  const supabase = createClient();
  await requireCurrentOrgProperty(supabase, propertyId, org.id);

  const uid = await userId(supabase);
  if (!uid) redirect(FORBIDDEN);

  const { data: account } = await supabase
    .from("distribution_channel_accounts")
    .select("account_status")
    .eq("organization_id", org.id)
    .eq("channel", channel)
    .maybeSingle();
  const acct = account as { account_status: string | null } | null;
  if (!acct || acct.account_status !== "connected") {
    channelAutomationBackTo(propertyId, "channel_auto_connectfirst", channel);
  }

  const nowISO = new Date().toISOString();
  const { data: saved, error } = await supabase
    .from("distribution_channel_accounts")
    .update({
      automation_authorized: true,
      automation_authorized_at: nowISO,
      automation_authorized_by: uid,
      updated_at: nowISO,
    })
    .eq("organization_id", org.id)
    .eq("channel", channel)
    .eq("account_status", "connected")
    .select("channel")
    .maybeSingle();
  if (error || !saved) {
    channelAutomationBackTo(propertyId, "channel_auto_error", channel);
  }

  await recordChannelAutomationConsentAttempt(supabase, {
    orgId: org.id,
    propertyId,
    channel,
    userId: uid,
    authorized: true,
  });

  if (propertyId) {
    revalidatePath(`/dashboard/properties/${propertyId}`);
    backTo(propertyId, "channel_auto_on", channel);
  }
  revalidatePath("/dashboard/settings");
  redirect(settingsChannelAutomationRedirectPath("channel_auto_on", channel));
}

export async function revokeChannelAutomation(formData: FormData) {
  await requireCapability("manage_properties", FORBIDDEN);
  const propertyId = s(formData, "property_id");
  const channel = apiAutomaticChannelFromForm(formData, propertyId);

  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");
  const supabase = createClient();
  await requireCurrentOrgProperty(supabase, propertyId, org.id);

  const uid = await userId(supabase);
  if (!uid) redirect(FORBIDDEN);

  const nowISO = new Date().toISOString();
  const { data: saved, error } = await supabase
    .from("distribution_channel_accounts")
    .update({
      automation_authorized: false,
      automation_authorized_at: null,
      automation_authorized_by: null,
      updated_at: nowISO,
    })
    .eq("organization_id", org.id)
    .eq("channel", channel)
    .select("channel")
    .maybeSingle();
  if (error || !saved) {
    channelAutomationBackTo(propertyId, "channel_auto_error", channel);
  }

  await recordChannelAutomationConsentAttempt(supabase, {
    orgId: org.id,
    propertyId,
    channel,
    userId: uid,
    authorized: false,
  });

  if (propertyId) {
    revalidatePath(`/dashboard/properties/${propertyId}`);
    backTo(propertyId, "channel_auto_off", channel);
  }
  revalidatePath("/dashboard/settings");
  redirect(settingsChannelAutomationRedirectPath("channel_auto_off", channel));
}

// S570: the operator authorizes autopilot to post a prepared concierge item
// from their own Distribute tab. This sets only the approval signal; the
// standalone worker's own gates still decide whether anything posts.
export async function authorizeAutopilotSubmit(formData: FormData) {
  await requireCapability("manage_properties", FORBIDDEN);
  const propertyId = String(formData.get("property_id") ?? "");
  const itemId = String(formData.get("item_id") ?? "");
  if (!itemId) {
    redirect(
      propertyId ? `/dashboard/properties/${propertyId}` : "/dashboard/properties",
    );
  }
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");
  const supabase = createClient();
  const uid = await userId(supabase);
  const now = new Date().toISOString();

  const { data: pending } = await supabase
    .from("distribution_run_items")
    .select("id, publish_status, channel")
    .eq("id", itemId)
    .eq("organization_id", org.id)
    .eq("mode", "concierge")
    .in("publish_status", ["needs_operator", "needs_payment"])
    .is("operator_submit_approved_at", null)
    .is("external_url", null)
    .maybeSingle();

  const pendingItem = pending as
    | { id: string; publish_status: string | null; channel: string | null }
    | null;
  if (pendingItem?.publish_status === "needs_payment") {
    const { data: spendAccount } = await supabase
      .from("distribution_channel_accounts")
      .select("spend_authorized, spend_max_cents, spend_revoked_at")
      .eq("organization_id", org.id)
      .eq("channel", pendingItem.channel)
      .maybeSingle();
    const acct = spendAccount as
      | {
          spend_authorized: boolean | null;
          spend_max_cents: number | null;
          spend_revoked_at: string | null;
        }
      | null;
    if (
      !acct ||
      acct.spend_authorized !== true ||
      acct.spend_revoked_at != null ||
      (acct.spend_max_cents ?? 0) <= 0
    ) {
      if (propertyId) backTo(propertyId, "autopilot_spend_auth", pendingItem.channel ?? undefined);
      redirect("/dashboard/properties");
    }
  }

  // Approve exactly once. Paid rows require standing spend authorization; this
  // tap only approves the prepared post, not a one-off blank-cheque fee consent.
  const { data: approved } = pendingItem
    ? await supabase
        .from("distribution_run_items")
        .update({
          operator_submit_approved_at: now,
          operator_submit_approved_by: uid,
          updated_at: now,
        })
        .eq("id", itemId)
        .eq("organization_id", org.id)
        .eq("mode", "concierge")
        .eq("publish_status", pendingItem.publish_status)
        .is("operator_submit_approved_at", null)
        .is("external_url", null)
        .select("id, run_id, organization_id, channel, attempt_count, publish_status")
        .maybeSingle()
    : { data: null };
  if (!approved) {
    const { data: alreadyPosted } = await supabase
      .from("distribution_run_items")
      .select("id")
      .eq("id", itemId)
      .eq("organization_id", org.id)
      .eq("mode", "concierge")
      .eq("publish_status", "needs_operator")
      .is("operator_submit_approved_at", null)
      .not("external_url", "is", null)
      .maybeSingle();
    if (alreadyPosted && propertyId) backTo(propertyId, "already_posted");
    if (propertyId) backTo(propertyId, "autopilot_stale");
    redirect("/dashboard/properties");
  }

  const priorAttempts = (approved.attempt_count as number | undefined) ?? 0;
  const attempt = buildAttemptRecord({
    organizationId: approved.organization_id as string,
    runId: approved.run_id as string,
    runItemId: itemId,
    channel: approved.channel as string,
    transport: "concierge",
    currentAttemptCount: priorAttempts,
    actorType: "operator",
    actorUserId: uid,
    statusBefore: (approved.publish_status as string) ?? "needs_operator",
    statusAfter: (approved.publish_status as string) ?? "needs_operator",
    proofId: null,
    metadata: { source: "operator_authorized_autopilot" },
  });
  await supabase.from("distribution_publish_attempts").insert({
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
  });

  revalidatePath(`/dashboard/properties/${propertyId}`);
  redirect(`/dashboard/properties/${propertyId}?autopilot=authorized#distribute-header`);
}

export async function setRelistRadarStandingAutoRefresh(formData: FormData) {
  await requireCapability("manage_properties", FORBIDDEN);
  const propertyId = s(formData, "property_id");
  const channel = s(formData, "channel");
  const enabled = s(formData, "enabled") === "1";
  if (!propertyId || !channel) redirect("/dashboard/properties");

  const channelMeta = channelByKey(channel);
  if (!channelMeta || channelMeta.key !== "kijiji" || channelMeta.paid) {
    backTo(propertyId, "radar_badchannel");
  }

  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");
  const supabase = createClient();
  const { data: property } = await supabase
    .from("properties")
    .select("id")
    .eq("id", propertyId)
    .eq("organization_id", org.id)
    .maybeSingle();
  if (!property) redirect(FORBIDDEN);

  const { data: account } = await supabase
    .from("distribution_channel_accounts")
    .select("account_status, automation_authorized")
    .eq("organization_id", org.id)
    .eq("channel", channel)
    .maybeSingle();
  const acct = account as
    | { account_status: string | null; automation_authorized: boolean | null }
    | null;
  if (
    !acct ||
    acct.account_status !== "connected" ||
    acct.automation_authorized !== true
  ) {
    backTo(propertyId, "radar_setup");
  }

  const { data: saved, error } = await supabase
    .from("distribution_channel_accounts")
    .update({
      auto_submit_allowed: enabled,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", org.id)
    .eq("channel", channel)
    .eq("automation_authorized", true)
    .select("channel")
    .maybeSingle();
  if (error || !saved) backTo(propertyId, "radar_toggle_error");

  revalidatePath(`/dashboard/properties/${propertyId}`);
  backTo(propertyId, enabled ? "radar_auto_on" : "radar_auto_off");
}

export async function confirmLeaseupTakedownRemovedAction(formData: FormData) {
  await requireCapability("manage_properties", FORBIDDEN);
  const propertyIdForm = s(formData, "property_id");
  const itemId = s(formData, "item_id");
  if (!itemId) redirect(propertyIdForm ? `/dashboard/properties/${propertyIdForm}` : "/dashboard/properties");

  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const supabase = createClient();
  const result = await confirmLeaseupTakedownRemoved({
    supabase,
    org,
    runItemId: itemId,
  });
  const propertyId = result.propertyId ?? propertyIdForm;
  if (propertyId) {
    revalidatePath(`/dashboard/properties/${propertyId}`);
    backTo(propertyId, result.ok ? "takedown_removed" : "takedown_failed");
  }
  redirect("/dashboard/properties");
}

// ---------------------------------------------------------------------------
// verifyPublicPage — durable proof that /r/[propertyId] is live + carries the
// core rent/address/booking signals. Reuses buildShareReadiness (the same gate
// the Publish button uses), so "verified_live" means it is genuinely publishable.
// ---------------------------------------------------------------------------
export async function verifyPublicPage(formData: FormData) {
  await requireCapability("manage_properties", FORBIDDEN);
  const propertyId = s(formData, "property_id");
  if (!propertyId) redirect("/dashboard/properties");

  const supabase = createClient();
  const { data: prop } = await supabase
    .from("properties")
    .select("id, organization_id, status, rent_cents, beds, baths, address")
    .eq("id", propertyId)
    .maybeSingle();
  if (!prop) redirect("/dashboard/properties");
  const p = prop as {
    id: string;
    organization_id: string;
    status: string;
    rent_cents: number | null;
    beds: number | null;
    baths: number | null;
    address: string | null;
  };
  // Authorize against the RESOURCE's org (KI744 / Codex S480-slice-2): stamp
  // proof rows with the PROPERTY's own org, not getCurrentOrg (which could differ
  // for a future multi-org/staff account while the property is still RLS-visible).
  const orgId = p.organization_id;
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
    replyToEmail: null,
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
    orgId,
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
  const propertyId = s(formData, "property_id");
  if (!propertyId) redirect("/dashboard/properties");

  const supabase = createClient();
  const { data: prop } = await supabase
    .from("properties")
    .select("id, organization_id, status, rent_cents, beds, baths, address, description")
    .eq("id", propertyId)
    .maybeSingle();
  if (!prop) redirect("/dashboard/properties");
  const p = prop as {
    id: string;
    organization_id: string;
    status: string;
    rent_cents: number | null;
    beds: number | null;
    baths: number | null;
    address: string | null;
    description: string | null;
  };
  const orgId = p.organization_id;
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
  // Read the RESOURCE org's contact phone (the feed the listing belongs to).
  const { data: orgRow } = await supabase
    .from("organizations")
    .select("public_contact_phone")
    .eq("id", orgId)
    .maybeSingle();
  const orgPhone = (orgRow?.public_contact_phone as string | null) ?? null;
  const orgHasPhone = !!(orgPhone && orgPhone.trim());
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
    orgId,
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
  const itemId = s(formData, "item_id");
  if (!itemId) redirect("/dashboard/properties");

  const supabase = createClient();
  const { data: item } = await supabase
    .from("distribution_run_items")
    .select("id, run_id, channel, transport, listing_post_id, organization_id")
    .eq("id", itemId)
    .maybeSingle();
  if (!item) redirect("/dashboard/properties");
  const it = item as unknown as {
    id: string;
    run_id: string;
    channel: string;
    transport: string | null;
    listing_post_id: string | null;
    organization_id: string;
  };
  // Stamp proof with the run item's OWN org (resource-derived, not getCurrentOrg).
  const orgId = it.organization_id;
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
    orgId,
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
  const propertyId = s(formData, "property_id");

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
  // Org = the org that owns the property this setup was launched from (read under
  // RLS), else the acting org. Never a client-supplied org id.
  let orgId: string | null = null;
  if (propertyId) {
    const { data: prop } = await supabase
      .from("properties")
      .select("organization_id")
      .eq("id", propertyId)
      .maybeSingle();
    orgId = (prop?.organization_id as string | undefined) ?? null;
    if (!orgId) backTo(propertyId, "account_badchannel");
  } else {
    const org = (await getCurrentOrg()) as OrgCtx | null;
    orgId = org?.id ?? null;
  }
  if (!orgId) redirect("/dashboard/settings");
  const nowISO = new Date().toISOString();
  await supabase.from("distribution_channel_accounts").upsert(
    {
      organization_id: orgId,
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

// ---------------------------------------------------------------------------
// disconnectFacebookPage — revoke the stored Facebook Page token for the
// Graph-backed facebook_feed channel. This never touches Marketplace (`facebook`)
// and never flips automation on; disconnecting also clears authorization so an
// approved item cannot keep offering autopilot with no token behind it.
// ---------------------------------------------------------------------------
export async function disconnectFacebookPage(formData: FormData) {
  await requireCapability("manage_properties", FORBIDDEN);
  const propertyId = s(formData, "property_id");
  const supabase = createClient();

  let orgId: string | null = null;
  if (propertyId) {
    const { data: prop } = await supabase
      .from("properties")
      .select("organization_id")
      .eq("id", propertyId)
      .maybeSingle();
    orgId = (prop?.organization_id as string | undefined) ?? null;
    if (!orgId) backTo(propertyId, "facebook_forbidden");
  } else {
    const org = await getCurrentOrg();
    orgId = org?.id ?? null;
  }
  if (!orgId) redirect("/dashboard/properties?forbidden=1");

  const admin = createAdminClient();
  if (!admin) {
    if (propertyId) {
      redirect(`/dashboard/properties/${propertyId}?fb=error&reason=config#distribute-header`);
    }
    redirect("/dashboard/properties?fb=error&reason=config");
  }

  await deleteChannelSession({
    organizationId: orgId,
    channel: "facebook_feed",
    admin,
  });
  if (igChannelEnabledForOrg(orgId)) {
    await deleteChannelSession({
      organizationId: orgId,
      channel: "instagram",
      admin,
    });
  }

  const nowISO = new Date().toISOString();
  await admin.from("distribution_channel_accounts").upsert(
    {
      organization_id: orgId,
      channel: "facebook_feed",
      transport: "automatic",
      account_status: "paused",
      external_account_label: null,
      requires_login: false,
      requires_payment: false,
      supports_feed: false,
      supports_copilot: false,
      supports_concierge: true,
      supports_live_verification: true,
      posting_policy: "human_confirmed",
      automation_authorized: false,
      automation_authorized_at: null,
      automation_authorized_by: null,
      last_setup_checked_at: nowISO,
      updated_at: nowISO,
    },
    { onConflict: "organization_id,channel" },
  );
  if (igChannelEnabledForOrg(orgId)) {
    await admin.from("distribution_channel_accounts").upsert(
      {
        organization_id: orgId,
        channel: "instagram",
        transport: "automatic",
        account_status: "paused",
        external_account_label: null,
        requires_login: false,
        requires_payment: false,
        supports_feed: false,
        supports_copilot: false,
        supports_concierge: true,
        supports_live_verification: true,
        posting_policy: "human_confirmed",
        automation_authorized: false,
        automation_authorized_at: null,
        automation_authorized_by: null,
        last_setup_checked_at: nowISO,
        updated_at: nowISO,
      },
      { onConflict: "organization_id,channel" },
    );
  }

  if (propertyId) {
    revalidatePath(`/dashboard/properties/${propertyId}`);
    redirect(`/dashboard/properties/${propertyId}?fb=disconnected#distribute-header`);
  }
  redirect("/dashboard/properties?fb=disconnected");
}

// ---------------------------------------------------------------------------
// postFacebookPageNow — one-tap, operator-triggered Facebook Page Graph POST.
// The account must already be connected + automation_authorized, but this does
// not auto-fire from Publish. The returned Graph post id is the proof source;
// without it, this action releases its reservation and never marks the item Live.
// ---------------------------------------------------------------------------
export async function postFacebookPageNow(formData: FormData) {
  await requireCapability("manage_properties", FORBIDDEN);
  const itemId = s(formData, "item_id");
  if (!itemId) redirect("/dashboard/properties");
  if (!facebookOAuthConfigured() || !fbPageChannelEnabled()) {
    redirect("/dashboard/properties?fb=error&reason=disabled");
  }

  const supabase = createClient();
  const radarClockEnabled = envFlagEnabled(process.env.RELIST_RADAR_CLOCK_ENABLED);
  const itemSelect: string = radarClockEnabled
    ? "id, run_id, channel, transport, listing_post_id, organization_id, publish_status, mode, external_url, external_posted_at"
    : "id, run_id, channel, transport, listing_post_id, organization_id, publish_status, mode";
  const { data: item } = await supabase
    .from("distribution_run_items")
    .select(itemSelect)
    .eq("id", itemId)
    .maybeSingle();
  if (!item) redirect("/dashboard/properties");
  const it = item as unknown as {
    id: string;
    run_id: string;
    channel: string;
    transport: string | null;
    listing_post_id: string | null;
    organization_id: string | null;
    publish_status: string | null;
    mode: string | null;
    external_url?: string | null;
    external_posted_at?: string | null;
  };

  const { data: run } = await supabase
    .from("distribution_runs")
    .select("property_id, organization_id, status")
    .eq("id", it.run_id)
    .maybeSingle();
  const propertyId = (run?.property_id as string | undefined) ?? null;
  const runOrgId = (run?.organization_id as string | undefined) ?? null;
  const runStatus = (run?.status as string | undefined) ?? null;
  const orgId = runOrgId ?? it.organization_id;

  if (it.channel !== FACEBOOK_FEED_CHANNEL) {
    if (propertyId) backTo(propertyId, "fb_badchannel");
    redirect("/dashboard/properties");
  }
  if (runStatus !== "active") {
    if (propertyId) backTo(propertyId, "fb_run_closed");
    redirect("/dashboard/properties");
  }
  if (it.mode === "concierge") {
    if (propertyId) backTo(propertyId, "fb_concierge");
    redirect("/dashboard/properties");
  }
  if (!propertyId || !orgId) redirect("/dashboard/properties?forbidden=1");

  const { data: account } = await supabase
    .from("distribution_channel_accounts")
    .select("account_status, automation_authorized")
    .eq("organization_id", orgId)
    .eq("channel", FACEBOOK_FEED_CHANNEL)
    .maybeSingle();
  const acct = account as
    | { account_status: string | null; automation_authorized: boolean | null }
    | null;
  if (!acct || acct.account_status !== "connected") {
    backTo(propertyId, "fb_connectfirst");
  }
  if (acct.automation_authorized !== true) {
    backTo(propertyId, "fb_authorizefirst");
  }

  const priorStatus = it.publish_status ?? "queued";
  const reserveISO = new Date().toISOString();
  const { data: reserved } = await supabase
    .from("distribution_run_items")
    .update({ publish_status: "submitting", updated_at: reserveISO })
    .eq("id", it.id)
    .eq("run_id", it.run_id)
    .eq("channel", FACEBOOK_FEED_CHANNEL)
    .neq("publish_status", "live")
    .neq("publish_status", "submitting")
    .select("id, listing_post_id");
  if (!reserved || reserved.length === 0) {
    backTo(propertyId, "fb_already");
  }

  async function releaseReservation(): Promise<void> {
    await supabase
      .from("distribution_run_items")
      .update({
        publish_status: priorStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", it.id)
      .eq("publish_status", "submitting");
  }

  const admin = createAdminClient();
  if (!admin) {
    await releaseReservation();
    backTo(propertyId, "fb_config");
  }

  type FacebookPageSession = {
    page_id?: unknown;
    page_access_token?: unknown;
  };
  let session: FacebookPageSession | null = null;
  try {
    session = await readChannelSession<FacebookPageSession>({
      organizationId: orgId,
      channel: FACEBOOK_FEED_CHANNEL,
      admin,
    });
  } catch {
    session = null;
  }
  const pageId = typeof session?.page_id === "string" ? session.page_id.trim() : "";
  const pageAccessToken =
    typeof session?.page_access_token === "string"
      ? session.page_access_token.trim()
      : "";
  if (!pageId || !pageAccessToken) {
    await releaseReservation();
    backTo(propertyId, "fb_reconnect");
  }

  const { data: property } = await supabase
    .from("properties")
    .select("id, address, beds, baths, rent_cents")
    .eq("id", propertyId)
    .maybeSingle();
  if (!property) {
    await releaseReservation();
    redirect("/dashboard/properties?forbidden=1");
  }
  const p = property as {
    address: string | null;
    beds: number | null;
    baths: number | null;
    rent_cents: number | null;
  };
  let listingPostId =
    (reserved[0]?.listing_post_id as string | null) ?? it.listing_post_id;
  const portal = normalizePortal(FACEBOOK_FEED_CHANNEL);
  if (!listingPostId) {
    const { data: existingPost } = await supabase
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
  const publicUrl = `${APP_URL.replace(/\/+$/, "")}/r/${propertyId}`;
  const trackedUrl = listingPostId
    ? buildTrackedLink(publicUrl, listingPostId)
    : publicUrl;
  const message = buildPageFeedMessage({
    address: p.address,
    beds: p.beds,
    baths: p.baths,
    rentCents: p.rent_cents,
    publicUrl: trackedUrl,
  });

  const graph = await postToFacebookPageFeed({
    pageId,
    pageAccessToken,
    message,
    link: trackedUrl,
  });
  if (!graph.ok) {
    await releaseReservation();
    if (graph.isAuthError) {
      const nowISO = new Date().toISOString();
      await admin
        .from("distribution_channel_accounts")
        .update({
          account_status: "needs_login",
          automation_authorized: false,
          automation_authorized_at: null,
          automation_authorized_by: null,
          last_setup_checked_at: nowISO,
          updated_at: nowISO,
        })
        .eq("organization_id", orgId)
        .eq("channel", FACEBOOK_FEED_CHANNEL);
      backTo(propertyId, "fb_reconnect");
    }
    backTo(propertyId, "fb_postfail");
  }

  const uid = await userId(supabase);
  const verId = await recordVerificationAndAttempt(supabase, {
    orgId,
    userId: uid,
    channel: FACEBOOK_FEED_CHANNEL,
    verificationType: "external_url",
    result: "verified_live",
    propertyId,
    runId: it.run_id,
    runItemId: it.id,
    listingPostId: it.listing_post_id,
    transport: it.transport ?? "automatic",
    externalUrl: graph.permalink,
    screenshotPath: null,
    matchedFields: {
      graphPostId: true,
      operatorAuthorized: true,
    },
    failureReason: null,
    actorType: "operator",
    metadata: {
      via: "graph_api_page",
      post_id: graph.postId,
    },
    nowISO: new Date().toISOString(),
  });
  if (!verId) {
    await releaseReservation();
    backTo(propertyId, "fb_prooffail");
  }

  const check = validateListingPost({
    portal,
    status: "live",
    url: graph.permalink,
  });
  if (!check.ok) {
    await releaseReservation();
    backTo(propertyId, "fb_trackerfail");
  }
  if (listingPostId) {
    const { error: upErr } = await supabase
      .from("listing_posts")
      .update({ url: graph.permalink, status: "live" })
      .eq("id", listingPostId);
    if (upErr) {
      await releaseReservation();
      backTo(propertyId, "fb_trackerfail");
    }
  } else {
    const { data: post, error: insErr } = await supabase
      .from("listing_posts")
      .insert({
        organization_id: orgId,
        property_id: propertyId,
        portal,
        url: graph.permalink,
        status: "live",
      })
      .select("id")
      .single();
    if (insErr || !post?.id) {
      await releaseReservation();
      backTo(propertyId, "fb_trackerfail");
    }
    listingPostId = post.id as string;
  }

  const flipISO = new Date().toISOString();
  const clockUpdate = buildRelistRadarClockUpdate({
    enabled: radarClockEnabled,
    organizationId: orgId,
    channel: it.channel,
    nowISO: flipISO,
    existingExternalPostedAt: it.external_posted_at,
    existingExternalUrl: it.external_url,
    nextExternalUrl: graph.permalink,
  });
  const { data: flipped } = await supabase
    .from("distribution_run_items")
    .update({
      status: "done",
      publish_status: "live",
      external_url: graph.permalink,
      ...clockUpdate,
      listing_post_id: listingPostId,
      proof_url: graph.permalink,
      last_verified_at: flipISO,
      updated_at: flipISO,
    })
    .eq("id", it.id)
    .eq("publish_status", "submitting")
    .select("id");
  if (!flipped || flipped.length === 0) {
    backTo(propertyId, "fb_already");
  }

  const { data: siblings } = await supabase
    .from("distribution_run_items")
    .select("publish_status")
    .eq("run_id", it.run_id);
  const rows = (siblings ?? []) as { publish_status: string | null }[];
  const allResolved =
    rows.length > 0 &&
    rows.every(
      (r) =>
        isPublishStatus(r.publish_status) &&
        isResolvedPublishStatus(r.publish_status),
    );
  await supabase
    .from("distribution_runs")
    .update({
      status: allResolved ? "completed" : "active",
      completed_at: allResolved ? flipISO : null,
    })
    .eq("id", it.run_id)
    .eq("status", "active");

  revalidatePath(`/dashboard/properties/${propertyId}`);
  redirect(`/dashboard/properties/${propertyId}?fb=posted#distribute-header`);
}

// ---------------------------------------------------------------------------
// postInstagramNow — one-tap, operator-triggered Instagram Graph publish (S624).
// Exact mirror of postFacebookPageNow's fail-closed spine, with three Instagram
// deltas: (1) a public cover image is REQUIRED (fail-closed ig_needsphoto),
// (2) postToInstagram is a two-step container->publish, (3) proof = the returned
// permalink. actorType stays "operator" + metadata.via="graph_api_instagram".
// ---------------------------------------------------------------------------
export async function postInstagramNow(formData: FormData) {
  await requireCapability("manage_properties", FORBIDDEN);
  const itemId = s(formData, "item_id");
  if (!itemId) redirect("/dashboard/properties");
  if (!facebookOAuthConfigured() || !igChannelEnabled()) {
    redirect("/dashboard/properties?ig=error&reason=disabled");
  }

  const supabase = createClient();
  const radarClockEnabled = envFlagEnabled(process.env.RELIST_RADAR_CLOCK_ENABLED);
  const itemSelect: string = radarClockEnabled
    ? "id, run_id, channel, transport, listing_post_id, organization_id, publish_status, mode, external_url, external_posted_at"
    : "id, run_id, channel, transport, listing_post_id, organization_id, publish_status, mode";
  const { data: item } = await supabase
    .from("distribution_run_items")
    .select(itemSelect)
    .eq("id", itemId)
    .maybeSingle();
  if (!item) redirect("/dashboard/properties");
  const it = item as unknown as {
    id: string;
    run_id: string;
    channel: string;
    transport: string | null;
    listing_post_id: string | null;
    organization_id: string | null;
    publish_status: string | null;
    mode: string | null;
    external_url?: string | null;
    external_posted_at?: string | null;
  };

  const { data: run } = await supabase
    .from("distribution_runs")
    .select("property_id, organization_id, status")
    .eq("id", it.run_id)
    .maybeSingle();
  const propertyId = (run?.property_id as string | undefined) ?? null;
  const runOrgId = (run?.organization_id as string | undefined) ?? null;
  const runStatus = (run?.status as string | undefined) ?? null;
  const orgId = runOrgId ?? it.organization_id;

  if (it.channel !== INSTAGRAM_CHANNEL) {
    if (propertyId) backTo(propertyId, "ig_badchannel");
    redirect("/dashboard/properties");
  }
  if (runStatus !== "active") {
    if (propertyId) backTo(propertyId, "ig_run_closed");
    redirect("/dashboard/properties");
  }
  if (it.mode === "concierge") {
    if (propertyId) backTo(propertyId, "ig_concierge");
    redirect("/dashboard/properties");
  }
  if (!propertyId || !orgId) redirect("/dashboard/properties?forbidden=1");
  if (!igChannelEnabledForOrg(orgId)) {
    backTo(propertyId, "ig_disabled");
  }

  const { data: account } = await supabase
    .from("distribution_channel_accounts")
    .select("account_status, automation_authorized")
    .eq("organization_id", orgId)
    .eq("channel", INSTAGRAM_CHANNEL)
    .maybeSingle();
  const acct = account as
    | { account_status: string | null; automation_authorized: boolean | null }
    | null;
  if (!acct || acct.account_status !== "connected") {
    backTo(propertyId, "ig_connectfirst");
  }
  if (acct.automation_authorized !== true) {
    backTo(propertyId, "ig_authorizefirst");
  }

  const priorStatus = it.publish_status ?? "queued";
  const reserveISO = new Date().toISOString();
  const { data: reserved } = await supabase
    .from("distribution_run_items")
    .update({ publish_status: "submitting", updated_at: reserveISO })
    .eq("id", it.id)
    .eq("run_id", it.run_id)
    .eq("channel", INSTAGRAM_CHANNEL)
    .neq("publish_status", "live")
    .neq("publish_status", "submitting")
    .select("id, listing_post_id");
  if (!reserved || reserved.length === 0) {
    backTo(propertyId, "ig_already");
  }

  async function releaseReservation(): Promise<void> {
    await supabase
      .from("distribution_run_items")
      .update({
        publish_status: priorStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", it.id)
      .eq("publish_status", "submitting");
  }

  const admin = createAdminClient();
  if (!admin) {
    await releaseReservation();
    backTo(propertyId, "ig_config");
  }

  type InstagramSession = {
    ig_user_id?: unknown;
    page_access_token?: unknown;
  };
  let session: InstagramSession | null = null;
  try {
    session = await readChannelSession<InstagramSession>({
      organizationId: orgId,
      channel: INSTAGRAM_CHANNEL,
      admin,
    });
  } catch {
    session = null;
  }
  const igUserId =
    typeof session?.ig_user_id === "string" ? session.ig_user_id.trim() : "";
  const pageAccessToken =
    typeof session?.page_access_token === "string"
      ? session.page_access_token.trim()
      : "";
  if (!igUserId || !pageAccessToken) {
    await releaseReservation();
    backTo(propertyId, "ig_reconnect");
  }

  const { data: property } = await supabase
    .from("properties")
    .select("id, address, beds, baths, rent_cents")
    .eq("id", propertyId)
    .maybeSingle();
  if (!property) {
    await releaseReservation();
    redirect("/dashboard/properties?forbidden=1");
  }
  const p = property as {
    address: string | null;
    beds: number | null;
    baths: number | null;
    rent_cents: number | null;
  };

  // Instagram REQUIRES a public image. Reuse the same canonical cover photo the
  // public /r page shows (get_public_listing returns photos public + cover-first).
  const { data: pub } = await supabase.rpc("get_public_listing", {
    p_property_id: propertyId,
  });
  const pubPhotos = (pub as { photos?: unknown } | null)?.photos;
  const imageUrl = Array.isArray(pubPhotos)
    ? (pubPhotos.find((x) => typeof x === "string" && x.trim()) as
        | string
        | undefined) ?? ""
    : "";
  if (!imageUrl) {
    await releaseReservation();
    backTo(propertyId, "ig_needsphoto");
  }

  let listingPostId =
    (reserved[0]?.listing_post_id as string | null) ?? it.listing_post_id;
  const portal = normalizePortal(INSTAGRAM_CHANNEL);
  if (!listingPostId) {
    const { data: existingPost } = await supabase
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
  const publicUrl = `${APP_URL.replace(/\/+$/, "")}/r/${propertyId}`;
  const trackedUrl = listingPostId
    ? buildTrackedLink(publicUrl, listingPostId)
    : publicUrl;
  const caption = buildInstagramCaption({
    address: p.address,
    beds: p.beds,
    baths: p.baths,
    rentCents: p.rent_cents,
    publicUrl: trackedUrl,
  });

  const graph = await postToInstagram({
    igUserId,
    pageAccessToken,
    imageUrl,
    caption,
  });
  if (!graph.ok) {
    await releaseReservation();
    if (graph.isAuthError) {
      const nowISO = new Date().toISOString();
      await admin
        .from("distribution_channel_accounts")
        .update({
          account_status: "needs_login",
          automation_authorized: false,
          automation_authorized_at: null,
          automation_authorized_by: null,
          last_setup_checked_at: nowISO,
          updated_at: nowISO,
        })
        .eq("organization_id", orgId)
        .eq("channel", INSTAGRAM_CHANNEL);
      backTo(propertyId, "ig_reconnect");
    }
    backTo(propertyId, "ig_postfail");
  }

  const uid = await userId(supabase);
  const verId = await recordVerificationAndAttempt(supabase, {
    orgId,
    userId: uid,
    channel: INSTAGRAM_CHANNEL,
    verificationType: "external_url",
    result: "verified_live",
    propertyId,
    runId: it.run_id,
    runItemId: it.id,
    listingPostId: it.listing_post_id,
    transport: it.transport ?? "automatic",
    externalUrl: graph.permalink,
    screenshotPath: null,
    matchedFields: {
      graphMediaId: true,
      operatorAuthorized: true,
    },
    failureReason: null,
    actorType: "operator",
    metadata: {
      via: "graph_api_instagram",
      media_id: graph.mediaId,
    },
    nowISO: new Date().toISOString(),
  });
  if (!verId) {
    await releaseReservation();
    backTo(propertyId, "ig_prooffail");
  }

  const check = validateListingPost({
    portal,
    status: "live",
    url: graph.permalink,
  });
  if (!check.ok) {
    await releaseReservation();
    backTo(propertyId, "ig_trackerfail");
  }
  if (listingPostId) {
    const { error: upErr } = await supabase
      .from("listing_posts")
      .update({ url: graph.permalink, status: "live" })
      .eq("id", listingPostId);
    if (upErr) {
      await releaseReservation();
      backTo(propertyId, "ig_trackerfail");
    }
  } else {
    const { data: post, error: insErr } = await supabase
      .from("listing_posts")
      .insert({
        organization_id: orgId,
        property_id: propertyId,
        portal,
        url: graph.permalink,
        status: "live",
      })
      .select("id")
      .single();
    if (insErr || !post?.id) {
      await releaseReservation();
      backTo(propertyId, "ig_trackerfail");
    }
    listingPostId = post.id as string;
  }

  const flipISO = new Date().toISOString();
  const clockUpdate = buildRelistRadarClockUpdate({
    enabled: radarClockEnabled,
    organizationId: orgId,
    channel: it.channel,
    nowISO: flipISO,
    existingExternalPostedAt: it.external_posted_at,
    existingExternalUrl: it.external_url,
    nextExternalUrl: graph.permalink,
  });
  const { data: flipped } = await supabase
    .from("distribution_run_items")
    .update({
      status: "done",
      publish_status: "live",
      external_url: graph.permalink,
      ...clockUpdate,
      listing_post_id: listingPostId,
      proof_url: graph.permalink,
      last_verified_at: flipISO,
      updated_at: flipISO,
    })
    .eq("id", it.id)
    .eq("publish_status", "submitting")
    .select("id");
  if (!flipped || flipped.length === 0) {
    backTo(propertyId, "ig_already");
  }

  const { data: siblings } = await supabase
    .from("distribution_run_items")
    .select("publish_status")
    .eq("run_id", it.run_id);
  const rows = (siblings ?? []) as { publish_status: string | null }[];
  const allResolved =
    rows.length > 0 &&
    rows.every(
      (r) =>
        isPublishStatus(r.publish_status) &&
        isResolvedPublishStatus(r.publish_status),
    );
  await supabase
    .from("distribution_runs")
    .update({
      status: allResolved ? "completed" : "active",
      completed_at: allResolved ? flipISO : null,
    })
    .eq("id", it.run_id)
    .eq("status", "active");

  revalidatePath(`/dashboard/properties/${propertyId}`);
  redirect(`/dashboard/properties/${propertyId}?ig=posted#distribute-header`);
}

// S695: completeCopilotPost (S482) was removed with the browser co-pilot
// (DECISION-S694). A Facebook / Kijiji / Viewit item now goes live through
// updateRunItem's per-portal URL gate, or through the concierge desk.
