import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { envFlagEnabled } from "@/lib/auto-listing-copy";
import { sendOrgNotification } from "@/lib/notifications-server";
import {
  getNotificationEvent,
  isDripEnqueueEnabled,
  type NotificationSettingRow,
} from "@/lib/notifications";
import { resolveLeadNotifyEmails } from "@/lib/leads-notify";
import type { NotifyMember } from "@/lib/incident-reports";
import { buildShareReadiness } from "@/lib/share-readiness";
import { isPublicBookable } from "@/lib/listing-state";
import {
  listingFeedReadiness,
  type FeedListingInput,
} from "@/lib/listing-feed";
import {
  interpretOrgFeedProof,
  interpretPublicPageProof,
  type VerificationResult,
  type VerificationType,
} from "@/lib/distribution-verification";
import { buildAttemptRecord } from "@/lib/distribution-attempts";
import {
  freshnessDue,
  freshnessUpdateForVerification,
  isFreshnessPortalChannel,
  isFreshnessVerifiableChannel,
  portalFreshnessDecision,
} from "@/lib/distribution-freshness";
import {
  isListingPostStatus,
  type ListingPostStatus,
} from "@/lib/listing-distribution";
import {
  LISTING_HEALTH_EVENT_KEY,
  alertableListingHealthChannels,
  buildListingHealthDigest,
  listingHealthChannels,
  type ListingHealthPost,
} from "@/lib/listing-health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const APP_URL = (
  process.env.NEXT_PUBLIC_APP_URL || "https://app.vacantless.com"
).replace(/\/+$/, "");
const MAX_ITEMS_PER_SWEEP = 200;
const MAX_RECIPIENTS = 10;

type AdminClient = NonNullable<ReturnType<typeof createAdminClient>>;

type Summary = {
  ok: boolean;
  reason?: string;
  scanned: number;
  verified: number;
  flagged: number;
  alerts: number;
  skipped: number;
  errors: number;
  details: Array<Record<string, unknown>>;
};

type FreshnessItemRow = {
  id: string;
  organization_id: string;
  run_id: string;
  channel: string;
  mode: string | null;
  transport: string | null;
  publish_status: string | null;
  verification_status: string | null;
  stale_after: string | null;
  next_retry_at: string | null;
  listing_post_id: string | null;
  proof_url: string | null;
  external_url: string | null;
  attempt_count: number | null;
};

type DistributionRunRow = {
  id: string;
  organization_id: string;
  property_id: string;
  status: string;
};

type ListingPostRow = {
  id: string;
  organization_id: string;
  property_id: string;
  portal: string;
  url: string | null;
  status: string;
  posted_on: string | null;
};

type ListingHealthOrgRow = {
  id: string;
  name: string | null;
  brand_color: string | null;
  logo_url: string | null;
  reply_to_email: string | null;
  public_contact_email: string | null;
};

type ListingHealthPostRow = {
  id: string;
  property_id: string;
  portal: string;
  label: string | null;
  url: string | null;
  status: string;
  posted_on: string | null;
  last_health_alerted_at: string | null;
  properties:
    | { id: string; address: string | null; status: string | null }
    | { id: string; address: string | null; status: string | null }[]
    | null;
};

type VerifierOutcome = {
  verificationType: VerificationType;
  observedResult: VerificationResult;
  result: VerificationResult;
  externalUrl: string | null;
  matchedFields: Record<string, boolean>;
  failureReason: string | null;
  fresh: boolean;
  staleAfter: string | null;
  nextRetryAt: string | null;
};

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const qp = req.nextUrl.searchParams.get("secret");
  return qp === secret;
}

function pushDetail(summary: Summary, detail: Record<string, unknown>): void {
  if (summary.details.length < 40) summary.details.push(detail);
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function one<T>(rel: T | T[] | null | undefined): T | null {
  if (Array.isArray(rel)) return rel[0] ?? null;
  return (rel as T) ?? null;
}

async function operatorFallbackForOrg(
  admin: AdminClient,
  org: ListingHealthOrgRow,
): Promise<string[]> {
  const { data: memberRows } = await admin
    .from("memberships")
    .select("user_id, role")
    .eq("organization_id", org.id);
  const members: NotifyMember[] = [];
  for (const m of (memberRows ?? []) as { user_id: string; role: string }[]) {
    const { data: u } = await admin.auth.admin.getUserById(m.user_id);
    members.push({ role: m.role, email: u?.user?.email ?? null });
  }
  return resolveLeadNotifyEmails(members, [
    org.reply_to_email,
    org.public_contact_email,
  ]).slice(0, MAX_RECIPIENTS);
}

async function loadListingHealthPosts(
  admin: AdminClient,
  orgId: string,
): Promise<{ posts: ListingHealthPost[]; missingColumn: boolean }> {
  const { data, error } = await admin
    .from("listing_posts")
    .select(
      "id, property_id, portal, label, url, status, posted_on, last_health_alerted_at, properties!inner(id, address, status)",
    )
    .eq("organization_id", orgId)
    .eq("properties.status", "available");

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("last_health_alerted_at")) {
      return { posts: [], missingColumn: true };
    }
    throw new Error(`listing_health_posts:${msg}`);
  }

  const posts = ((data ?? []) as ListingHealthPostRow[]).map((row) => {
    const prop = one(row.properties);
    return {
      id: row.id,
      propertyId: row.property_id,
      address: prop?.address ?? null,
      portal: row.portal,
      label: row.label,
      status: row.status,
      url: row.url,
      postedOn: row.posted_on,
      lastHealthAlertedAt: row.last_health_alerted_at,
    };
  });
  return { posts, missingColumn: false };
}

async function sendListingHealthAlerts({
  admin,
  nowISO,
  summary,
}: {
  admin: AdminClient;
  nowISO: string;
  summary: Summary;
}): Promise<void> {
  const event = getNotificationEvent(LISTING_HEALTH_EVENT_KEY);
  if (!event) {
    summary.errors++;
    pushDetail(summary, { listing_health: "event_not_registered" });
    return;
  }

  const { data: settingRows, error: settingErr } = await admin
    .from("notification_settings")
    .select("organization_id, event_key, enabled, subject_template, body_template, recipients, accent_color")
    .eq("event_key", LISTING_HEALTH_EVENT_KEY);
  if (settingErr) {
    summary.errors++;
    pushDetail(summary, { listing_health: `settings_query:${settingErr.message}` });
    return;
  }

  const settingsByOrg = new Map<string, NotificationSettingRow>();
  for (const raw of (settingRows ?? []) as Array<NotificationSettingRow & { organization_id?: string | null }>) {
    if (!raw.organization_id) continue;
    const setting: NotificationSettingRow = {
      event_key: raw.event_key,
      enabled: raw.enabled,
      subject_template: raw.subject_template,
      body_template: raw.body_template,
      recipients: raw.recipients,
      accent_color: raw.accent_color,
    };
    if (isDripEnqueueEnabled(setting)) settingsByOrg.set(raw.organization_id, setting);
  }
  if (settingsByOrg.size === 0) return;

  const { data: orgRows, error: orgErr } = await admin
    .from("organizations")
    .select("id, name, brand_color, logo_url, reply_to_email, public_contact_email")
    .in("id", Array.from(settingsByOrg.keys()));
  if (orgErr) {
    summary.errors++;
    pushDetail(summary, { listing_health: `org_query:${orgErr.message}` });
    return;
  }

  const today = nowISO.slice(0, 10);
  for (const org of (orgRows ?? []) as ListingHealthOrgRow[]) {
    try {
      const { posts, missingColumn } = await loadListingHealthPosts(admin, org.id);
      if (missingColumn) {
        summary.skipped++;
        pushDetail(summary, {
          org: org.id,
          listing_health: "missing_last_health_alerted_at",
        });
        continue;
      }

      const channels = alertableListingHealthChannels(
        listingHealthChannels({ posts, today, nowISO }),
      );
      if (channels.length === 0) {
        summary.skipped++;
        continue;
      }

      const digest = buildListingHealthDigest(channels, APP_URL);
      const fallback = await operatorFallbackForOrg(admin, org);
      const result = await sendOrgNotification({
        client: admin,
        org: {
          id: org.id,
          name: org.name,
          brand_color: org.brand_color,
          logo_url: org.logo_url,
          reply_to_email: org.reply_to_email,
        },
        eventKey: LISTING_HEALTH_EVENT_KEY,
        vars: {
          org_name: org.name ?? "",
          property_address: "",
          affected_ads_count: String(digest.adCount),
          affected_units_count: String(digest.unitCount),
          listing_health_summary: digest.summaryText,
          listing_health_details: digest.detailsText,
          dashboard_url: digest.firstDistributeUrl ?? `${APP_URL}/dashboard/leasing`,
        },
        operatorFallback: fallback,
        action: {
          label: "Review listing health",
          url: digest.firstDistributeUrl ?? `${APP_URL}/dashboard/leasing`,
        },
      });

      if (!result.delivered) {
        summary.skipped++;
        pushDetail(summary, {
          org: org.id,
          listing_health: "send_skipped",
          reason: result.skipped ?? "send_failed",
          attempted: result.attempted,
        });
        continue;
      }

      const postIds = Array.from(
        new Set(channels.flatMap((channel) => channel.postIds)),
      );
      if (postIds.length > 0) {
        const { error: stampErr } = await admin
          .from("listing_posts")
          .update({ last_health_alerted_at: nowISO })
          .in("id", postIds);
        if (stampErr) throw new Error(`listing_health_stamp:${stampErr.message}`);
      }

      summary.alerts++;
      pushDetail(summary, {
        org: org.id,
        listing_health: "sent",
        ads: digest.adCount,
        units: digest.unitCount,
        posts_stamped: postIds.length,
      });
    } catch (err) {
      summary.errors++;
      pushDetail(summary, {
        org: org.id,
        listing_health_error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

async function loadRun(
  admin: AdminClient,
  runId: string,
): Promise<DistributionRunRow | null> {
  const { data, error } = await admin
    .from("distribution_runs")
    .select("id, organization_id, property_id, status")
    .eq("id", runId)
    .maybeSingle();
  if (error) throw new Error(`run_query:${error.message}`);
  return (data as DistributionRunRow | null) ?? null;
}

async function loadListingPost(
  admin: AdminClient,
  postId: string | null,
): Promise<ListingPostRow | null> {
  if (!postId) return null;
  const { data, error } = await admin
    .from("listing_posts")
    .select("id, organization_id, property_id, portal, url, status, posted_on")
    .eq("id", postId)
    .maybeSingle();
  if (error) throw new Error(`post_query:${error.message}`);
  return (data as ListingPostRow | null) ?? null;
}

async function verifyPublicPageForCron(
  admin: AdminClient,
  propertyId: string,
  nowISO: string,
): Promise<VerifierOutcome> {
  const { data: prop, error } = await admin
    .from("properties")
    .select("id, organization_id, status, rent_cents, beds, baths, address")
    .eq("id", propertyId)
    .maybeSingle();
  if (error) throw new Error(`property_query:${error.message}`);
  if (!prop) {
    return staleOutcome({
      channel: "vacantless",
      verificationType: "public_page",
      observedResult: "not_found",
      nowISO,
      externalUrl: `${APP_URL}/r/${propertyId}`,
      matchedFields: { propertyFound: false },
      failureReason: "The rental record could not be found.",
    });
  }

  const p = prop as {
    status: string;
    rent_cents: number | null;
    beds: number | null;
    baths: number | null;
    address: string | null;
  };
  const { count } = await admin
    .from("property_photos")
    .select("id", { count: "exact", head: true })
    .eq("property_id", propertyId);
  const share = buildShareReadiness({
    status: p.status,
    rentCents: p.rent_cents,
    beds: p.beds,
    baths: p.baths,
    address: p.address,
    photoCount: count ?? 0,
    availabilityWindowCount: 0,
    replyToEmail: null,
  });
  const byKey: Record<string, boolean> = {};
  for (const check of share.checks) byKey[check.key] = check.ok;

  const proof = interpretPublicPageProof({
    isPublic: byKey.live === true,
    bookable: byKey.live === true,
    hasAddress: byKey.address === true,
    hasRent: byKey.rent === true,
    hasPhoto: byKey.photos === true,
  });
  const update = freshnessUpdateForVerification({
    channel: "vacantless",
    result: proof.result,
    nowISO,
  });
  return {
    verificationType: "public_page",
    observedResult: proof.result,
    result: update.runItemResult,
    externalUrl: `${APP_URL}/r/${propertyId}`,
    matchedFields: proof.matchedFields,
    failureReason:
      update.fresh
        ? proof.failureReason
        : proof.failureReason ?? "The renter page needs a freshness refresh.",
    fresh: update.fresh,
    staleAfter: update.staleAfter,
    nextRetryAt: update.nextRetryAt,
  };
}

async function verifyOrgFeedForCron(
  admin: AdminClient,
  propertyId: string,
  orgId: string,
  nowISO: string,
): Promise<VerifierOutcome> {
  const { data: prop, error } = await admin
    .from("properties")
    .select("id, status, rent_cents, beds, baths, address, description")
    .eq("id", propertyId)
    .maybeSingle();
  if (error) throw new Error(`property_query:${error.message}`);
  if (!prop) {
    return staleOutcome({
      channel: "org_feed",
      verificationType: "feed_render",
      observedResult: "not_found",
      nowISO,
      externalUrl: null,
      matchedFields: { propertyFound: false },
      failureReason: "The rental record could not be found for the feed.",
    });
  }

  const p = prop as {
    id: string;
    status: string;
    rent_cents: number | null;
    beds: number | null;
    baths: number | null;
    address: string | null;
    description: string | null;
  };
  const [{ count: photoCount }, { data: orgRow }] = await Promise.all([
    admin
      .from("property_photos")
      .select("id", { count: "exact", head: true })
      .eq("property_id", propertyId),
    admin
      .from("organizations")
      .select("public_contact_phone")
      .eq("id", orgId)
      .maybeSingle(),
  ]);
  const readiness = listingFeedReadiness({
    id: p.id,
    address: p.address,
    rent_cents: p.rent_cents,
    beds: p.beds,
    baths: p.baths,
    description: p.description,
    photos: Array((photoCount ?? 0) as number).fill("x"),
  } as unknown as FeedListingInput);
  const orgPhone =
    ((orgRow as { public_contact_phone?: string | null } | null)
      ?.public_contact_phone ?? null);
  const orgHasPhone = !!orgPhone?.trim();
  const proof = interpretOrgFeedProof({
    feedReachable: true,
    listingIncluded: isPublicBookable(p.status),
    hasRequiredFields: readiness.ready && orgHasPhone,
  });
  const update = freshnessUpdateForVerification({
    channel: "org_feed",
    result: proof.result,
    nowISO,
  });
  return {
    verificationType: "feed_render",
    observedResult: proof.result,
    result: update.runItemResult,
    externalUrl: null,
    matchedFields: {
      ...proof.matchedFields,
      feedReady: readiness.ready,
      orgPhone: orgHasPhone,
    },
    failureReason:
      update.fresh
        ? proof.failureReason
        : proof.failureReason ??
          (readiness.ready
            ? "The feed needs a freshness refresh."
            : `Missing feed fields: ${readiness.missing.join(", ")}`),
    fresh: update.fresh,
    staleAfter: update.staleAfter,
    nextRetryAt: update.nextRetryAt,
  };
}

function staleOutcome({
  channel,
  verificationType,
  observedResult,
  nowISO,
  externalUrl,
  matchedFields,
  failureReason,
}: {
  channel: string;
  verificationType: VerificationType;
  observedResult: VerificationResult;
  nowISO: string;
  externalUrl: string | null;
  matchedFields: Record<string, boolean>;
  failureReason: string;
}): VerifierOutcome {
  const update = freshnessUpdateForVerification({
    channel,
    result: observedResult,
    nowISO,
  });
  return {
    verificationType,
    observedResult,
    result: update.runItemResult,
    externalUrl,
    matchedFields,
    failureReason,
    fresh: update.fresh,
    staleAfter: update.staleAfter,
    nextRetryAt: update.nextRetryAt,
  };
}

async function flagPortalForRefresh({
  item,
  post,
  nowISO,
  reason,
}: {
  item: FreshnessItemRow;
  post: ListingPostRow | null;
  nowISO: string;
  reason: string;
}): Promise<VerifierOutcome> {
  const update = freshnessUpdateForVerification({
    channel: item.channel,
    result: "stale",
    nowISO,
  });
  const status: ListingPostStatus | null = isListingPostStatus(post?.status)
    ? post.status
    : null;
  return {
    verificationType: "external_url",
    observedResult: "stale",
    result: update.runItemResult,
    externalUrl: post?.url ?? item.external_url ?? item.proof_url,
    matchedFields: {
      trackerFound: !!post,
      trackerLive: status === "live",
      trackerExpired: status === "expired" || status === "removed",
      externalPortalChecked: false,
    },
    failureReason:
      reason === "tracker_expired"
        ? "The tracked portal post is expired or removed."
        : "Portal refresh is due. The freshness cron does not log into or submit to external portals.",
    fresh: false,
    staleAfter: update.staleAfter,
    nextRetryAt: update.nextRetryAt,
  };
}

async function recordFreshnessOutcome({
  admin,
  item,
  run,
  propertyId,
  outcome,
  nowISO,
}: {
  admin: AdminClient;
  item: FreshnessItemRow;
  run: DistributionRunRow;
  propertyId: string;
  outcome: VerifierOutcome;
  nowISO: string;
}): Promise<void> {
  const { data: proof, error: proofErr } = await admin
    .from("distribution_verifications")
    .insert({
      organization_id: run.organization_id,
      property_id: propertyId,
      run_id: item.run_id,
      run_item_id: item.id,
      listing_post_id: item.listing_post_id,
      channel: item.channel,
      verification_type: outcome.verificationType,
      result: outcome.result,
      external_url: outcome.externalUrl,
      screenshot_path: null,
      matched_fields: outcome.matchedFields,
      failure_reason: outcome.failureReason,
      checked_by: null,
      next_check_at: outcome.nextRetryAt,
      metadata: {
        source: "distribution_freshness_cron",
        observed_result: outcome.observedResult,
      },
    })
    .select("id")
    .single();
  if (proofErr || !proof?.id) {
    throw new Error(`verification_insert:${proofErr?.message ?? "missing_id"}`);
  }

  const proofId = proof.id as string;
  const attempt = buildAttemptRecord({
    organizationId: run.organization_id,
    runId: item.run_id,
    runItemId: item.id,
    channel: item.channel,
    transport: item.transport,
    currentAttemptCount: item.attempt_count ?? 0,
    actorType: "system",
    actorUserId: null,
    statusBefore: item.verification_status ?? item.publish_status,
    statusAfter: outcome.result,
    proofId,
    metadata: {
      source: "distribution_freshness_cron",
      observed_result: outcome.observedResult,
    },
  });
  const { data: att, error: attErr } = await admin
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
  if (attErr || !att?.id) {
    throw new Error(`attempt_insert:${attErr?.message ?? "missing_id"}`);
  }

  const { error: updateErr } = await admin
    .from("distribution_run_items")
    .update({
      verification_status: outcome.result,
      last_verification_id: proofId,
      last_attempt_id: att.id as string,
      proof_url: outcome.externalUrl ?? item.proof_url,
      attempt_count: (item.attempt_count ?? 0) + 1,
      next_retry_at: outcome.nextRetryAt,
      stale_after: outcome.staleAfter,
      last_verified_at: nowISO,
      updated_at: nowISO,
    })
    .eq("id", item.id);
  if (updateErr) throw new Error(`item_update:${updateErr.message}`);
}

async function processItem({
  admin,
  item,
  nowISO,
  summary,
}: {
  admin: AdminClient;
  item: FreshnessItemRow;
  nowISO: string;
  summary: Summary;
}): Promise<void> {
  const run = await loadRun(admin, item.run_id);
  if (!run || run.status === "cancelled") {
    summary.skipped++;
    pushDetail(summary, { item: item.id, channel: item.channel, skipped: "run_inactive" });
    return;
  }

  if (isFreshnessVerifiableChannel(item.channel)) {
    const due = freshnessDue({
      nowISO,
      staleAfter: item.stale_after,
      nextRetryAt: item.next_retry_at,
    });
    if (!due.due) {
      summary.skipped++;
      return;
    }
    const outcome =
      item.channel === "vacantless"
        ? await verifyPublicPageForCron(admin, run.property_id, nowISO)
        : await verifyOrgFeedForCron(
            admin,
            run.property_id,
            run.organization_id,
            nowISO,
          );
    await recordFreshnessOutcome({
      admin,
      item,
      run,
      propertyId: run.property_id,
      outcome,
      nowISO,
    });
    if (outcome.fresh) summary.verified++;
    else summary.flagged++;
    pushDetail(summary, {
      item: item.id,
      channel: item.channel,
      result: outcome.result,
      observed: outcome.observedResult,
      next: outcome.nextRetryAt,
    });
    return;
  }

  if (isFreshnessPortalChannel(item.channel)) {
    const post = await loadListingPost(admin, item.listing_post_id);
    const decision = portalFreshnessDecision({
      channel: item.channel,
      listingPostStatus: post?.status ?? null,
      listingPostUrl: post?.url ?? null,
      listingPostPostedOn: post?.posted_on ?? null,
      staleAfter: item.stale_after,
      nextRetryAt: item.next_retry_at,
      nowISO,
    });
    if (!decision.shouldFlag) {
      summary.skipped++;
      pushDetail(summary, {
        item: item.id,
        channel: item.channel,
        skipped: decision.reason,
      });
      return;
    }
    const outcome = await flagPortalForRefresh({
      item,
      post,
      nowISO,
      reason: decision.reason,
    });
    await recordFreshnessOutcome({
      admin,
      item,
      run,
      propertyId: run.property_id,
      outcome,
      nowISO,
    });
    summary.flagged++;
    pushDetail(summary, {
      item: item.id,
      channel: item.channel,
      result: outcome.result,
      reason: decision.reason,
      next: outcome.nextRetryAt,
    });
    return;
  }

  summary.skipped++;
  pushDetail(summary, {
    item: item.id,
    channel: item.channel,
    skipped: "unsupported_channel",
  });
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  const disabledSummary: Summary = {
    ok: true,
    reason: "disabled",
    scanned: 0,
    verified: 0,
    flagged: 0,
    alerts: 0,
    skipped: 0,
    errors: 0,
    details: [],
  };
  if (!envFlagEnabled(process.env.DISTRIBUTION_FRESHNESS_ENABLED)) {
    return NextResponse.json(disabledSummary, { status: 200 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      {
        ...disabledSummary,
        ok: false,
        reason: "service_role_not_configured",
      } satisfies Summary,
      { status: 200 },
    );
  }

  const nowISO = new Date().toISOString();
  const summary: Summary = {
    ok: true,
    scanned: 0,
    verified: 0,
    flagged: 0,
    alerts: 0,
    skipped: 0,
    errors: 0,
    details: [],
  };

  const { data, error } = await admin
    .from("distribution_run_items")
    .select(
      "id, organization_id, run_id, channel, mode, transport, publish_status, verification_status, stale_after, next_retry_at, listing_post_id, proof_url, external_url, attempt_count",
    )
    .in("publish_status", ["live", "submitted"])
    .order("updated_at", { ascending: true })
    .limit(MAX_ITEMS_PER_SWEEP);

  if (error) {
    return NextResponse.json(
      {
        ...summary,
        ok: false,
        reason: `query_error:${error.message}`,
        errors: 1,
      } satisfies Summary,
      { status: 200 },
    );
  }

  const rows = (data ?? []) as FreshnessItemRow[];
  summary.scanned = rows.length;

  for (const item of rows) {
    try {
      if (!textOrNull(item.id) || !textOrNull(item.run_id)) {
        summary.skipped++;
        pushDetail(summary, { item: item.id ?? null, skipped: "bad_item" });
        continue;
      }
      await processItem({ admin, item, nowISO, summary });
    } catch (err) {
      summary.errors++;
      pushDetail(summary, {
        item: item.id,
        channel: item.channel,
        error: err instanceof Error ? err.message : String(err),
      });
      console.error("[distribution-freshness] item failed", {
        itemId: item.id,
        channel: item.channel,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await sendListingHealthAlerts({ admin, nowISO, summary });

  console.log("[distribution-freshness]", JSON.stringify(summary));
  return NextResponse.json(summary, { status: 200 });
}
