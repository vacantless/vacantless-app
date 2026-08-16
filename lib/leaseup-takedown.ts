import type { SupabaseClient } from "@supabase/supabase-js";
import { canUseWaitlist } from "@/lib/billing";
import { channelByKey } from "@/lib/distribution-channels";
import { TAKEDOWN_TRANSPORT } from "@/lib/distribution-worker";
import { decideLeaseupAdLifecycle } from "@/lib/leaseup-decision";
import { resolveLeadNotifyEmailsPreferMemberFallback } from "@/lib/leads-notify";
import { sendOrgNotification } from "@/lib/notifications-server";
import type { Org } from "@/lib/org";

// S575b dispatch choice: v1 automated Graph deletion remains the standalone
// worker command (`npm run takedown:leaseup`) keyed by TAKEDOWN_ITEM_ID. App
// enqueue marks these rows transport='takedown' so the publish-prep cron never
// claims them as new-post jobs.
export const LEASEUP_TAKEDOWN_FEATURE_FLAG = "LEASEUP_TAKEDOWN_ENABLED";
const FB_PAGE_FEED = "facebook_feed";
const APP_URL = (
  process.env.NEXT_PUBLIC_APP_URL || "https://app.vacantless.com"
).replace(/\/+$/, "");

type PropertyRow = {
  id: string;
  organization_id: string;
  status: string | null;
  address: string | null;
  beds: number | null;
  unit_type: string | null;
};

type ListingPostRow = {
  id: string;
  portal: string;
  label: string | null;
  url: string | null;
  notes: string | null;
};

type AccountRow = {
  channel: string;
  automation_authorized: boolean | null;
  account_status: string | null;
};

type CompatibleSiblingRow = {
  id: string;
  beds: number | null;
  unit_type: string | null;
};

export function leaseupTakedownEnabled(): boolean {
  return process.env[LEASEUP_TAKEDOWN_FEATURE_FLAG] === "true";
}

function compatibleSiblingCount(
  property: PropertyRow,
  siblings: CompatibleSiblingRow[],
): number {
  return siblings.filter((s) => {
    if (property.beds != null && s.beds != null && property.beds !== s.beds) {
      return false;
    }
    if (
      property.unit_type &&
      s.unit_type &&
      property.unit_type !== s.unit_type
    ) {
      return false;
    }
    return true;
  }).length;
}

function listingPostIsPaid(post: ListingPostRow): boolean {
  const haystack = [post.label, post.notes, post.url]
    .filter((v): v is string => Boolean(v))
    .join(" ")
    .toLowerCase();
  return /\b(paid|boost|boosted|sponsored|promoted|premium|top ad|payment|invoice)\b/.test(
    haystack,
  );
}

function channelLabel(channel: string): string {
  return channelByKey(channel)?.label ?? channel.replace(/_/g, " ");
}

export function shouldNotifyLeaseupTakedown(args: {
  featureEnabled: boolean;
  automatedDelete: boolean;
  decisionAction: string;
}): boolean {
  return (
    args.featureEnabled &&
    args.decisionAction === "takedown" &&
    !args.automatedDelete
  );
}

export function leaseupTakedownDashboardUrl(propertyId: string): string {
  return `${APP_URL}/dashboard/properties/${encodeURIComponent(propertyId)}#distribute-header`;
}

async function sendLeaseupTakedownNeededNotification(
  supabase: SupabaseClient,
  args: {
    org: Org;
    property: PropertyRow;
    post: ListingPostRow;
    reason: string;
  },
): Promise<void> {
  try {
    const dashboardUrl = leaseupTakedownDashboardUrl(args.property.id);
    await sendOrgNotification({
      client: supabase,
      org: {
        id: args.org.id,
        name: args.org.name,
        brand_color: args.org.brand_color,
        logo_url: args.org.logo_url,
        reply_to_email: args.org.reply_to_email,
      },
      eventKey: "leasing.distribution_takedown_needed",
      vars: {
        org_name: args.org.name ?? "",
        property_address: args.property.address ?? "",
        channel_label: channelLabel(args.post.portal),
        external_url: args.post.url ?? "",
        reason: args.reason,
        dashboard_url: dashboardUrl,
      },
      operatorFallback: resolveLeadNotifyEmailsPreferMemberFallback([], [
        args.org.reply_to_email,
        args.org.public_contact_email,
      ]),
      action: { label: "Open Distribute", url: dashboardUrl },
    });
  } catch {
    // The leased transition and take-down task are already recorded. Operator
    // notification is best-effort and must never roll back the lifecycle change.
  }
}

async function logLeaseupDecision(
  supabase: SupabaseClient,
  args: {
    organizationId: string;
    propertyId: string;
    post: ListingPostRow;
    action: string;
    reason: string;
    siblingAvailableCount: number;
    waitlistEnabled: boolean;
    automationAuthorized: boolean;
    runId?: string | null;
    runItemId?: string | null;
  },
): Promise<void> {
  await supabase.from("distribution_verifications").insert({
    organization_id: args.organizationId,
    property_id: args.propertyId,
    run_id: args.runId ?? null,
    run_item_id: args.runItemId ?? null,
    listing_post_id: args.post.id,
    channel: args.post.portal,
    verification_type: "external_url",
    result: "proof_unavailable",
    external_url: args.post.url,
    failure_reason: args.reason,
    metadata: {
      source: "leaseup_lifecycle",
      action: args.action,
      reason: args.reason,
      feature_flag: LEASEUP_TAKEDOWN_FEATURE_FLAG,
      leaseup_takedown_enabled: true,
      sibling_available_count: args.siblingAvailableCount,
      waitlist_enabled: args.waitlistEnabled,
      automation_authorized: args.automationAuthorized,
    },
  });
}

async function ensureLeaseupRun(
  supabase: SupabaseClient,
  args: { organizationId: string; propertyId: string },
): Promise<string | null> {
  const { data: existing } = await supabase
    .from("distribution_runs")
    .select("id")
    .eq("organization_id", args.organizationId)
    .eq("property_id", args.propertyId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (existing?.id) return existing.id as string;

  const { data: inserted } = await supabase
    .from("distribution_runs")
    .insert({
      organization_id: args.organizationId,
      property_id: args.propertyId,
      status: "active",
    })
    .select("id")
    .maybeSingle();
  return (inserted?.id as string | undefined) ?? null;
}

async function enqueueLeaseupTakedownItem(
  supabase: SupabaseClient,
  args: {
    organizationId: string;
    propertyId: string;
    runId: string;
    post: ListingPostRow;
    automatedDelete: boolean;
    reason: string;
  },
): Promise<string | null> {
  const now = new Date().toISOString();
  const label = channelLabel(args.post.portal);
  const publishStatus = args.automatedDelete ? "queued" : "needs_operator";
  const audit = args.automatedDelete
    ? `Lease-up takedown queued for ${label}: ${args.reason}`
    : `Lease-up takedown needs operator for ${label}: ${args.reason}`;
  const blockers = args.automatedDelete
    ? []
    : [`Take down the leased unit's ${label} ad, then record removal proof.`];

  const { data } = await supabase
    .from("distribution_run_items")
    .upsert(
      {
        organization_id: args.organizationId,
        run_id: args.runId,
        channel: args.post.portal,
        status: args.automatedDelete ? "pending" : "in_progress",
        publish_status: publishStatus,
        mode: "concierge",
        transport: TAKEDOWN_TRANSPORT,
        blockers,
        external_url: args.post.url,
        listing_post_id: args.post.id,
        operator_action_url: args.post.url,
        audit_message: audit,
        error_code: null,
        error_message: null,
        last_attempted_at: now,
        updated_at: now,
      },
      { onConflict: "run_id,channel" },
    )
    .select("id")
    .maybeSingle();

  return (data?.id as string | undefined) ?? null;
}

export async function handleLeaseupAdLifecycle(args: {
  supabase: SupabaseClient;
  org: Org;
  propertyId: string;
}): Promise<void> {
  if (!leaseupTakedownEnabled()) return;

  const { supabase, org, propertyId } = args;
  const { data: propertyData } = await supabase
    .from("properties")
    .select("id, organization_id, status, address, beds, unit_type")
    .eq("id", propertyId)
    .eq("organization_id", org.id)
    .maybeSingle();
  const property = propertyData as PropertyRow | null;
  if (!property || property.status !== "leased") return;

  const { data: postData } = await supabase
    .from("listing_posts")
    .select("id, portal, label, url, notes")
    .eq("organization_id", org.id)
    .eq("property_id", propertyId)
    .eq("status", "live");
  const posts = (postData ?? []) as ListingPostRow[];
  if (posts.length === 0) return;

  const [{ data: siblingData }, { data: accountData }] = await Promise.all([
    supabase
      .from("properties")
      .select("id, beds, unit_type")
      .eq("organization_id", org.id)
      .eq("status", "available")
      .is("archived_at", null)
      .neq("id", propertyId),
    supabase
      .from("distribution_channel_accounts")
      .select("channel, automation_authorized, account_status")
      .eq("organization_id", org.id),
  ]);
  const siblingAvailableCount = compatibleSiblingCount(
    property,
    (siblingData ?? []) as CompatibleSiblingRow[],
  );
  const accounts = new Map(
    ((accountData ?? []) as AccountRow[]).map((a) => [a.channel, a]),
  );
  const waitlistEnabled = canUseWaitlist(org.plan);

  let runId: string | null = null;
  for (const post of posts) {
    const account = accounts.get(post.portal) ?? null;
    const automationAuthorized = account?.automation_authorized === true;
    const decision = decideLeaseupAdLifecycle({
      propertyStatus: "leased",
      channel: post.portal,
      isPaid: listingPostIsPaid(post),
      siblingAvailableCount,
      waitlistEnabled,
    });

    if (decision.action !== "takedown") {
      await logLeaseupDecision(supabase, {
        organizationId: org.id,
        propertyId,
        post,
        action: decision.action,
        reason: decision.reason,
        siblingAvailableCount,
        waitlistEnabled,
        automationAuthorized,
      });
      continue;
    }

    runId ??= await ensureLeaseupRun(supabase, {
      organizationId: org.id,
      propertyId,
    });
    if (!runId) continue;

    const automatedDelete =
      post.portal === FB_PAGE_FEED &&
      automationAuthorized &&
      account?.account_status === "connected";
    const runItemId = await enqueueLeaseupTakedownItem(supabase, {
      organizationId: org.id,
      propertyId,
      runId,
      post,
      automatedDelete,
      reason: decision.reason,
    });
    if (
      shouldNotifyLeaseupTakedown({
        featureEnabled: leaseupTakedownEnabled(),
        automatedDelete,
        decisionAction: decision.action,
      })
    ) {
      await sendLeaseupTakedownNeededNotification(supabase, {
        org,
        property,
        post,
        reason: decision.reason,
      });
    }
    await logLeaseupDecision(supabase, {
      organizationId: org.id,
      propertyId,
      post,
      action: automatedDelete ? "takedown_queued" : "takedown_operator_task",
      reason: decision.reason,
      siblingAvailableCount,
      waitlistEnabled,
      automationAuthorized,
      runId,
      runItemId,
    });
  }
}
