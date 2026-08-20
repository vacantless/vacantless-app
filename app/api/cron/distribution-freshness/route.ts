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
import { channelByKey } from "@/lib/distribution-channels";
import {
  RELIST_RADAR_AUTOPILOT_RECAP_EVENT_KEY,
  RELIST_RADAR_EMAIL_EVENT_KEY,
  RELIST_RADAR_LAST_CHANCE_EVENT_KEY,
  RELIST_RADAR_PAID_LAPSE_EVENT_KEY,
  buildRelistRadarAutopilotRecap,
  buildRelistRadarEmail,
  classifyRelistRadarCandidate,
  createRelistRadarDecisionToken,
  relistRadarAllowedOrgFilter,
  relistRadarDecisionTokenSecret,
  relistRadarEmailChannelIncluded,
  relistRadarFreeExecutionGate,
  relistRadarManageUrl,
  relistRadarOrgAllowed,
  relistRadarStandingAutoRefreshConsent,
  resolveRelistRadarSettings,
  type RelistRadarAutopilotRecapItem,
  type RelistRadarDecisionAction,
  type RelistRadarEmailItem,
  type RelistRadarEmailKind,
  type RelistRadarSettings,
} from "@/lib/relist-radar";

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
  radar_candidates?: number;
  radar_emails?: number;
  radar_refreshes?: number;
  radar_recaps?: number;
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

type RelistRadarItemRow = {
  id: string;
  organization_id: string;
  run_id: string;
  channel: string;
  publish_status: string | null;
  listing_post_id: string | null;
  external_expires_at: string | null;
};

type RelistRadarSettingsRow = {
  settings: unknown;
};

type RelistRadarEventRow = {
  id: string;
  organization_id: string;
  property_id: string;
  run_id: string | null;
  run_item_id: string;
  listing_post_id: string | null;
  channel: string;
  cycle_date: string;
  external_expires_at: string;
  paid: boolean;
  decision: string | null;
  metadata: unknown;
};

type RelistRadarPropertyRow = {
  id: string;
  organization_id: string;
  address: string | null;
  status: string | null;
};

type RelistRadarChannelAccountRow = {
  organization_id: string;
  channel: string;
  account_status: string | null;
  automation_authorized: boolean | null;
  auto_submit_allowed: boolean | null;
};

type RelistRadarExecutionItemRow = {
  id: string;
  organization_id: string;
  run_id: string;
  channel: string;
  mode: string | null;
  transport: string | null;
  publish_status: string | null;
  listing_post_id: string | null;
  external_url: string | null;
  proof_url: string | null;
  attempt_count: number | null;
  external_posted_at: string | null;
  external_expires_at: string | null;
  concierge_claimed_by: string | null;
};

type RelistRadarBackupPropertyRow = {
  id: string;
  organization_id: string;
  status: string | null;
  address: string | null;
  rent_cents: number | string | null;
  beds: number | string | null;
  baths: number | string | null;
  sqft: number | string | null;
  description: string | null;
  virtual_tour_url: string | null;
  available_date: string | null;
  furnished: boolean | null;
  parking: string | null;
  postal_code: string | null;
  lease_term: string | null;
  pet_friendly: boolean | null;
  pets_cats: boolean | null;
  pets_dogs: boolean | null;
  air_conditioning: boolean | null;
  smoking: string | null;
  unit_type: string | null;
  for_rent_by: string | null;
  balcony: boolean | null;
  laundry: string | null;
  heat_included: boolean | null;
  hydro_included: boolean | null;
  water_included: boolean | null;
};

type RelistRadarBackupPhotoRow = {
  id: string;
  storage_path: string;
  url: string;
  sort_order: number;
  is_cover: boolean;
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
      "id, property_id, portal, label, url, status, posted_on, last_health_alerted_at, properties!inner(id, address, status, archived_at)",
    )
    .eq("organization_id", orgId)
    .eq("properties.status", "available")
    .is("properties.archived_at", null);

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
    .select("id, name, brand_color, logo_url, mail_alias, reply_to_email, public_contact_email")
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

const RELIST_RADAR_PAID_FEE_CENTS: Partial<Record<string, number>> = {
  viewit: 5495,
  rentfaster: 11696,
};

const RELIST_RADAR_MAX_EMAIL_EVENTS = 120;

function addDaysDate(date: string, days: number): string {
  const time = Date.parse(`${date}T00:00:00.000Z`);
  return new Date(time + days * 86_400_000).toISOString().slice(0, 10);
}

function decisionUrl(token: string): string {
  return `${APP_URL}/api/relist-radar/decision/${encodeURIComponent(token)}`;
}

function eventCycleDate(event: RelistRadarEventRow): string {
  return event.cycle_date.slice(0, 10);
}

function radarMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function metadataString(
  metadata: Record<string, unknown>,
  key: string,
): string | null {
  return typeof metadata[key] === "string" && metadata[key]
    ? (metadata[key] as string)
    : null;
}

function metadataBoolean(
  metadata: Record<string, unknown>,
  key: string,
): boolean {
  return metadata[key] === true;
}

function groupRadarEventsByProperty(
  events: readonly RelistRadarEventRow[],
): Map<string, RelistRadarEventRow[]> {
  const groups = new Map<string, RelistRadarEventRow[]>();
  for (const event of events) {
    const rows = groups.get(event.property_id) ?? [];
    rows.push(event);
    groups.set(event.property_id, rows);
  }
  return groups;
}

function previousUtcMonthWindow(today: string):
  | { start: string; end: string; label: string }
  | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || today.slice(8, 10) !== "01") {
    return null;
  }
  const end = new Date(`${today}T00:00:00.000Z`);
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 1, 1));
  return {
    start: start.toISOString().slice(0, 10),
    end: today,
    label: new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      month: "long",
      year: "numeric",
    }).format(start),
  };
}

function orgChannelKey(orgId: string, channel: string): string {
  return `${orgId}:${channel}`;
}

async function loadRelistRadarOrgs(
  admin: AdminClient,
  orgIds: readonly string[],
): Promise<Map<string, ListingHealthOrgRow>> {
  const ids = Array.from(new Set(orgIds.filter(Boolean)));
  if (ids.length === 0) return new Map();
  const { data, error } = await admin
    .from("organizations")
    .select("id, name, brand_color, logo_url, mail_alias, reply_to_email, public_contact_email")
    .in("id", ids);
  if (error) throw new Error(`radar_orgs:${error.message}`);
  return new Map(
    ((data ?? []) as ListingHealthOrgRow[]).map((row) => [row.id, row]),
  );
}

async function loadRelistRadarProperties(
  admin: AdminClient,
  propertyIds: readonly string[],
): Promise<Map<string, RelistRadarPropertyRow>> {
  const ids = Array.from(new Set(propertyIds.filter(Boolean)));
  if (ids.length === 0) return new Map();
  const { data, error } = await admin
    .from("properties")
    .select("id, organization_id, address, status")
    .in("id", ids);
  if (error) throw new Error(`radar_properties:${error.message}`);
  return new Map(
    ((data ?? []) as RelistRadarPropertyRow[]).map((row) => [row.id, row]),
  );
}

async function loadRelistRadarChannelAccounts(
  admin: AdminClient,
  events: readonly Pick<RelistRadarEventRow, "organization_id" | "channel">[],
): Promise<Map<string, RelistRadarChannelAccountRow>> {
  const orgIds = Array.from(new Set(events.map((event) => event.organization_id).filter(Boolean)));
  const channelKeys = Array.from(new Set(events.map((event) => event.channel).filter(Boolean)));
  if (orgIds.length === 0 || channelKeys.length === 0) return new Map();
  const { data, error } = await admin
    .from("distribution_channel_accounts")
    .select("organization_id, channel, account_status, automation_authorized, auto_submit_allowed")
    .in("organization_id", orgIds)
    .in("channel", channelKeys);
  if (error) throw new Error(`radar_accounts:${error.message}`);
  return new Map(
    ((data ?? []) as RelistRadarChannelAccountRow[]).map((row) => [
      orgChannelKey(row.organization_id, row.channel),
      row,
    ]),
  );
}

async function insertRelistRadarToken({
  admin,
  event,
  action,
  secret,
  nowMs,
  emailKind,
}: {
  admin: AdminClient;
  event: RelistRadarEventRow;
  action: RelistRadarDecisionAction;
  secret: string;
  nowMs: number;
  emailKind: RelistRadarEmailKind;
}): Promise<string> {
  const created = createRelistRadarDecisionToken({
    runItemId: event.run_item_id,
    portal: event.channel,
    action,
    cycleDate: eventCycleDate(event),
    secret,
    nowMs,
  });
  const { error } = await admin.from("relist_radar_decision_tokens").insert({
    organization_id: event.organization_id,
    event_id: event.id,
    run_item_id: event.run_item_id,
    cycle_date: eventCycleDate(event),
    channel: event.channel,
    action,
    token_hash: created.tokenHash,
    expires_at: created.expiresAt,
    metadata: {
      source: "distribution_freshness_cron",
      email_kind: emailKind,
    },
  });
  if (error) throw new Error(`radar_token:${error.message}`);
  return decisionUrl(created.token);
}

async function radarEmailItemForEvent({
  admin,
  event,
  propertyId,
  kind,
  secret,
  nowMs,
}: {
  admin: AdminClient;
  event: RelistRadarEventRow;
  propertyId: string;
  kind: RelistRadarEmailKind;
  secret: string;
  nowMs: number;
}): Promise<RelistRadarEmailItem | null> {
  const channel = channelByKey(event.channel);
  if (!channel) return null;

  const manage = relistRadarManageUrl(APP_URL, propertyId);
  const actionUrls: RelistRadarEmailItem["actionUrls"] = { manage };
  if (kind === "notice") {
    if (event.paid) {
      actionUrls.consent = await insertRelistRadarToken({
        admin,
        event,
        action: "consent",
        secret,
        nowMs,
        emailKind: kind,
      });
    } else {
      actionUrls.skip = await insertRelistRadarToken({
        admin,
        event,
        action: "skip",
        secret,
        nowMs,
        emailKind: kind,
      });
    }
  } else if (kind === "last_chance") {
    actionUrls.keepLive = await insertRelistRadarToken({
      admin,
      event,
      action: "keep_live",
      secret,
      nowMs,
      emailKind: kind,
    });
    actionUrls.letExpire = await insertRelistRadarToken({
      admin,
      event,
      action: "let_expire",
      secret,
      nowMs,
      emailKind: kind,
    });
  } else if (kind === "paid_lapse") {
    actionUrls.consent = await insertRelistRadarToken({
      admin,
      event,
      action: "consent",
      secret,
      nowMs,
      emailKind: kind,
    });
  }

  return {
    runItemId: event.run_item_id,
    channel: event.channel,
    channelLabel: channel.label,
    paid: event.paid,
    cycleDate: eventCycleDate(event),
    externalExpiresAt: event.external_expires_at,
    feeCents: RELIST_RADAR_PAID_FEE_CENTS[event.channel] ?? null,
    actionUrls,
  };
}

async function sendRelistRadarPropertyEmail({
  admin,
  org,
  property,
  events,
  kind,
  eventKey,
  secret,
  nowMs,
}: {
  admin: AdminClient;
  org: ListingHealthOrgRow | null;
  property: RelistRadarPropertyRow;
  events: readonly RelistRadarEventRow[];
  kind: RelistRadarEmailKind;
  eventKey: string;
  secret: string;
  nowMs: number;
}): Promise<{ delivered: boolean; itemIds: string[]; reason?: string }> {
  if (!org) {
    return { delivered: false, itemIds: [], reason: "org_missing" };
  }
  if (property.organization_id !== org.id) {
    return { delivered: false, itemIds: [], reason: "property_org_mismatch" };
  }
  if ((property.status ?? "").toLowerCase() !== "available") {
    return { delivered: false, itemIds: [], reason: "property_not_available" };
  }

  const items: RelistRadarEmailItem[] = [];
  for (const event of events) {
    const item = await radarEmailItemForEvent({
      admin,
      event,
      propertyId: property.id,
      kind,
      secret,
      nowMs,
    });
    if (item) items.push(item);
  }
  if (items.length === 0) {
    return { delivered: false, itemIds: [], reason: "no_email_items" };
  }

  const built = buildRelistRadarEmail({
    kind,
    propertyAddress: property.address ?? "this property",
    propertyId: property.id,
    appUrl: APP_URL,
    items,
  });
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
    eventKey,
    vars: {
      org_name: org.name ?? "",
      property_address: property.address ?? "",
      relist_radar_subject: built.subject,
      relist_radar_body: built.body,
      dashboard_url: built.dashboardUrl,
    },
    operatorFallback: fallback,
    actions: built.actions,
  });

  if (!result.delivered) {
    return {
      delivered: false,
      itemIds: [],
      reason: result.skipped ?? "send_failed",
    };
  }

  return { delivered: true, itemIds: events.map((event) => event.id) };
}

function relistRadarBaseEventQuery(admin: AdminClient) {
  let query = admin
    .from("relist_radar_events")
    .select(
      "id, organization_id, property_id, run_id, run_item_id, listing_post_id, channel, cycle_date, external_expires_at, paid, decision, metadata",
    )
    .eq("event_type", "radar_candidate");
  const orgIds = relistRadarAllowedOrgFilter();
  if (orgIds) query = query.in("organization_id", orgIds);
  return query;
}

async function sendRelistRadarNotices({
  admin,
  nowISO,
  today,
  secret,
  summary,
}: {
  admin: AdminClient;
  nowISO: string;
  today: string;
  secret: string;
  summary: Summary;
}): Promise<void> {
  const { data, error } = await relistRadarBaseEventQuery(admin)
    .is("notice_sent_at", null)
    .is("decision", null)
    .gte("cycle_date", today)
    .order("cycle_date", { ascending: true })
    .limit(RELIST_RADAR_MAX_EMAIL_EVENTS);
  if (error) throw new Error(`radar_notice_query:${error.message}`);

  const events = (data ?? []) as RelistRadarEventRow[];
  if (events.length === 0) return;
  const [properties, orgs, accounts] = await Promise.all([
    loadRelistRadarProperties(admin, events.map((event) => event.property_id)),
    loadRelistRadarOrgs(
      admin,
      events.map((event) => event.organization_id),
    ),
    loadRelistRadarChannelAccounts(admin, events),
  ]);

  const included = events.filter((event) => {
    const channel = channelByKey(event.channel);
    if (!relistRadarEmailChannelIncluded(channel)) return false;
    if (
      !event.paid &&
      relistRadarStandingAutoRefreshConsent(
        accounts.get(orgChannelKey(event.organization_id, event.channel)),
      )
    ) {
      return false;
    }
    return true;
  });

  for (const [propertyId, propertyEvents] of groupRadarEventsByProperty(included)) {
    const property = properties.get(propertyId);
    if (!property) {
      summary.skipped++;
      pushDetail(summary, {
        relist_radar_email: "notice_skipped",
        property: propertyId,
        reason: "property_missing",
      });
      continue;
    }

    const sent = await sendRelistRadarPropertyEmail({
      admin,
      org: orgs.get(property.organization_id) ?? null,
      property,
      events: propertyEvents,
      kind: "notice",
      eventKey: RELIST_RADAR_EMAIL_EVENT_KEY,
      secret,
      nowMs: Date.parse(nowISO),
    });
    if (!sent.delivered) {
      summary.skipped++;
      pushDetail(summary, {
        relist_radar_email: "notice_skipped",
        property: propertyId,
        reason: sent.reason ?? "send_failed",
      });
      continue;
    }

    const { error: stampErr } = await admin
      .from("relist_radar_events")
      .update({ notice_sent_at: nowISO })
      .in("id", sent.itemIds)
      .is("notice_sent_at", null);
    if (stampErr) throw new Error(`radar_notice_stamp:${stampErr.message}`);

    summary.radar_emails = (summary.radar_emails ?? 0) + 1;
    pushDetail(summary, {
      relist_radar_email: "notice_sent",
      property: propertyId,
      events: sent.itemIds.length,
    });
  }
}

async function sendRelistRadarLastChance({
  admin,
  nowISO,
  today,
  secret,
  summary,
}: {
  admin: AdminClient;
  nowISO: string;
  today: string;
  secret: string;
  summary: Summary;
}): Promise<void> {
  const tomorrow = addDaysDate(today, 1);
  const { data, error } = await relistRadarBaseEventQuery(admin)
    .eq("paid", false)
    .eq("decision", "skipped")
    .is("last_chance_sent_at", null)
    .gte("cycle_date", today)
    .lte("cycle_date", tomorrow)
    .order("cycle_date", { ascending: true })
    .limit(RELIST_RADAR_MAX_EMAIL_EVENTS);
  if (error) throw new Error(`radar_last_chance_query:${error.message}`);

  const events = (data ?? []) as RelistRadarEventRow[];
  if (events.length === 0) return;
  const [properties, orgs] = await Promise.all([
    loadRelistRadarProperties(
      admin,
      events.map((event) => event.property_id),
    ),
    loadRelistRadarOrgs(
      admin,
      events.map((event) => event.organization_id),
    ),
  ]);

  for (const [propertyId, propertyEvents] of groupRadarEventsByProperty(events)) {
    const property = properties.get(propertyId);
    if (!property) {
      summary.skipped++;
      pushDetail(summary, {
        relist_radar_email: "last_chance_skipped",
        property: propertyId,
        reason: "property_missing",
      });
      continue;
    }

    const sent = await sendRelistRadarPropertyEmail({
      admin,
      org: orgs.get(property.organization_id) ?? null,
      property,
      events: propertyEvents,
      kind: "last_chance",
      eventKey: RELIST_RADAR_LAST_CHANCE_EVENT_KEY,
      secret,
      nowMs: Date.parse(nowISO),
    });
    if (!sent.delivered) {
      summary.skipped++;
      pushDetail(summary, {
        relist_radar_email: "last_chance_skipped",
        property: propertyId,
        reason: sent.reason ?? "send_failed",
      });
      continue;
    }

    const { error: stampErr } = await admin
      .from("relist_radar_events")
      .update({ last_chance_sent_at: nowISO })
      .in("id", sent.itemIds)
      .eq("decision", "skipped")
      .is("last_chance_sent_at", null);
    if (stampErr) throw new Error(`radar_last_chance_stamp:${stampErr.message}`);

    summary.radar_emails = (summary.radar_emails ?? 0) + 1;
    pushDetail(summary, {
      relist_radar_email: "last_chance_sent",
      property: propertyId,
      events: sent.itemIds.length,
    });
  }
}

async function sendRelistRadarPaidLapses({
  admin,
  nowISO,
  today,
  secret,
  summary,
}: {
  admin: AdminClient;
  nowISO: string;
  today: string;
  secret: string;
  summary: Summary;
}): Promise<void> {
  const { data, error } = await relistRadarBaseEventQuery(admin)
    .eq("paid", true)
    .is("decision", null)
    .is("lapse_nudge_sent_at", null)
    .lt("cycle_date", today)
    .order("cycle_date", { ascending: true })
    .limit(RELIST_RADAR_MAX_EMAIL_EVENTS);
  if (error) throw new Error(`radar_paid_lapse_query:${error.message}`);

  const events = (data ?? []) as RelistRadarEventRow[];
  if (events.length === 0) return;
  const [properties, orgs] = await Promise.all([
    loadRelistRadarProperties(
      admin,
      events.map((event) => event.property_id),
    ),
    loadRelistRadarOrgs(
      admin,
      events.map((event) => event.organization_id),
    ),
  ]);

  for (const [propertyId, propertyEvents] of groupRadarEventsByProperty(events)) {
    const property = properties.get(propertyId);
    if (!property) {
      summary.skipped++;
      pushDetail(summary, {
        relist_radar_email: "paid_lapse_skipped",
        property: propertyId,
        reason: "property_missing",
      });
      continue;
    }

    const sent = await sendRelistRadarPropertyEmail({
      admin,
      org: orgs.get(property.organization_id) ?? null,
      property,
      events: propertyEvents,
      kind: "paid_lapse",
      eventKey: RELIST_RADAR_PAID_LAPSE_EVENT_KEY,
      secret,
      nowMs: Date.parse(nowISO),
    });
    if (!sent.delivered) {
      summary.skipped++;
      pushDetail(summary, {
        relist_radar_email: "paid_lapse_skipped",
        property: propertyId,
        reason: sent.reason ?? "send_failed",
      });
      continue;
    }

    const { error: stampErr } = await admin
      .from("relist_radar_events")
      .update({
        decision: "no_response",
        decided_at: nowISO,
        decided_via: "relist_radar_paid_lapse",
        lapse_nudge_sent_at: nowISO,
      })
      .in("id", sent.itemIds)
      .is("decision", null)
      .is("lapse_nudge_sent_at", null);
    if (stampErr) throw new Error(`radar_paid_lapse_stamp:${stampErr.message}`);

    summary.radar_emails = (summary.radar_emails ?? 0) + 1;
    pushDetail(summary, {
      relist_radar_email: "paid_lapse_sent",
      property: propertyId,
      events: sent.itemIds.length,
    });
  }
}

async function sendRelistRadarEmails({
  admin,
  nowISO,
  summary,
}: {
  admin: AdminClient;
  nowISO: string;
  summary: Summary;
}): Promise<void> {
  const secret = relistRadarDecisionTokenSecret();
  if (!secret) {
    summary.errors++;
    pushDetail(summary, { relist_radar_email: "missing_token_secret" });
    return;
  }

  const today = nowISO.slice(0, 10);
  await sendRelistRadarNotices({ admin, nowISO, today, secret, summary });
  await sendRelistRadarLastChance({ admin, nowISO, today, secret, summary });
  await sendRelistRadarPaidLapses({ admin, nowISO, today, secret, summary });
}

async function loadRelistRadarExecutionItem(
  admin: AdminClient,
  itemId: string,
): Promise<RelistRadarExecutionItemRow | null> {
  const { data, error } = await admin
    .from("distribution_run_items")
    .select(
      "id, organization_id, run_id, channel, mode, transport, publish_status, listing_post_id, external_url, proof_url, attempt_count, external_posted_at, external_expires_at, concierge_claimed_by",
    )
    .eq("id", itemId)
    .maybeSingle();
  if (error) throw new Error(`radar_execute_item:${error.message}`);
  return (data as RelistRadarExecutionItemRow | null) ?? null;
}

async function buildRelistRadarRefreshBackup({
  admin,
  event,
  item,
  run,
  property,
  nowISO,
}: {
  admin: AdminClient;
  event: RelistRadarEventRow;
  item: RelistRadarExecutionItemRow;
  run: DistributionRunRow;
  property: RelistRadarPropertyRow;
  nowISO: string;
}): Promise<Record<string, unknown>> {
  const { data: propertyRow, error: propertyErr } = await admin
    .from("properties")
    .select(
      "id, organization_id, status, address, rent_cents, beds, baths, sqft, description, virtual_tour_url, available_date, furnished, parking, postal_code, lease_term, pet_friendly, pets_cats, pets_dogs, air_conditioning, smoking, unit_type, for_rent_by, balcony, laundry, heat_included, hydro_included, water_included",
    )
    .eq("id", run.property_id)
    .eq("organization_id", run.organization_id)
    .maybeSingle();
  if (propertyErr) throw new Error(`radar_backup_property:${propertyErr.message}`);
  if (!propertyRow) throw new Error("radar_backup_property:missing");

  const { data: photoRows, error: photoErr } = await admin
    .from("property_photos")
    .select("id, storage_path, url, sort_order, is_cover")
    .eq("property_id", run.property_id)
    .eq("organization_id", run.organization_id)
    .order("is_cover", { ascending: false })
    .order("sort_order", { ascending: true });
  if (photoErr) throw new Error(`radar_backup_photos:${photoErr.message}`);

  let listingPost: Record<string, unknown> | null = null;
  if (item.listing_post_id) {
    const { data: postRow, error: postErr } = await admin
      .from("listing_posts")
      .select("id, portal, label, url, status, posted_on, notes")
      .eq("id", item.listing_post_id)
      .eq("organization_id", run.organization_id)
      .eq("property_id", run.property_id)
      .maybeSingle();
    if (postErr) throw new Error(`radar_backup_post:${postErr.message}`);
    listingPost = (postRow as Record<string, unknown> | null) ?? null;
  }

  return {
    v: 1,
    source: "relist_radar_autorefresh",
    backed_up_at: nowISO,
    organization_id: run.organization_id,
    property_id: run.property_id,
    run_id: item.run_id,
    run_item_id: item.id,
    channel: item.channel,
    cycle_date: eventCycleDate(event),
    previous: {
      external_url: item.external_url,
      proof_url: item.proof_url,
      external_posted_at: item.external_posted_at,
      external_expires_at: item.external_expires_at,
      listing_post_id: item.listing_post_id,
      listing_post: listingPost,
    },
    property: propertyRow as RelistRadarBackupPropertyRow,
    property_label: property.address,
    photos: (photoRows ?? []) as RelistRadarBackupPhotoRow[],
  };
}

async function enqueueRelistRadarFreeRefresh({
  admin,
  event,
  item,
  run,
  property,
  metadata,
  gateReason,
  standingConsent,
  nowISO,
  summary,
}: {
  admin: AdminClient;
  event: RelistRadarEventRow;
  item: RelistRadarExecutionItemRow;
  run: DistributionRunRow;
  property: RelistRadarPropertyRow;
  metadata: Record<string, unknown>;
  gateReason: string;
  standingConsent: boolean;
  nowISO: string;
  summary: Summary;
}): Promise<void> {
  const backup = await buildRelistRadarRefreshBackup({
    admin,
    event,
    item,
    run,
    property,
    nowISO,
  });
  const priorAttempts = item.attempt_count ?? 0;
  const attempt = buildAttemptRecord({
    organizationId: item.organization_id,
    runId: item.run_id,
    runItemId: item.id,
    channel: item.channel,
    transport: "concierge",
    currentAttemptCount: priorAttempts,
    actorType: "system",
    actorUserId: null,
    statusBefore: item.publish_status ?? "live",
    statusAfter: "needs_operator",
    proofId: null,
    metadata: {
      source: "relist_radar_autorefresh",
      gate_reason: gateReason,
      cycle_date: eventCycleDate(event),
      event_id: event.id,
      standing_autopilot: standingConsent,
      backup_captured: true,
      no_concierge_credit: true,
      worker_lane: "phase_b_submit_free_plan",
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
    throw new Error(`radar_execute_attempt:${attErr?.message ?? "missing_id"}`);
  }

  // Free auto-refresh is the org's own authorized account and free Kijiji slot.
  // Do not call claim_concierge_leaseup or stamp concierge_requested_at here:
  // no staffed concierge-pack credit is consumed for this worker enqueue.
  const { data: queued, error: queueErr } = await admin
    .from("distribution_run_items")
    .update({
      mode: "concierge",
      transport: "concierge",
      publish_status: "needs_operator",
      status: "in_progress",
      operator_submit_approved_at: nowISO,
      operator_submit_approved_by: null,
      concierge_claimed_by: null,
      concierge_claimed_at: null,
      error_code: null,
      error_message: null,
      audit_message:
        "Relist Radar queued a free Kijiji refresh. The worker may post only with the $0 plan; Live still needs real URL proof.",
      relist_radar_backup: backup,
      last_attempt_id: att.id as string,
      attempt_count: priorAttempts + 1,
      updated_at: nowISO,
    })
    .eq("id", item.id)
    .eq("organization_id", item.organization_id)
    .eq("run_id", item.run_id)
    .eq("channel", item.channel)
    .eq("publish_status", "live")
    .is("concierge_claimed_by", null)
    .select("id")
    .maybeSingle();
  if (queueErr) throw new Error(`radar_execute_queue:${queueErr.message}`);
  if (!queued) {
    summary.skipped++;
    pushDetail(summary, {
      relist_radar_execute: "queue_lost",
      item: item.id,
      event: event.id,
    });
    return;
  }

  const nextMetadata = {
    ...metadata,
    auto_refresh_enqueued_at: nowISO,
    auto_refresh_attempt_id: att.id as string,
    auto_refresh_gate: gateReason,
    standing_autopilot: standingConsent,
    backup_captured_at: nowISO,
    no_concierge_credit: true,
    worker_lane: "phase_b_submit_free_plan",
  };
  const { error: eventErr } = await admin
    .from("relist_radar_events")
    .update({ metadata: nextMetadata })
    .eq("id", event.id);
  if (eventErr) throw new Error(`radar_execute_event:${eventErr.message}`);

  summary.radar_refreshes = (summary.radar_refreshes ?? 0) + 1;
  pushDetail(summary, {
    relist_radar_execute: "free_refresh_enqueued",
    property: run.property_id,
    item: item.id,
    channel: item.channel,
    cycle_date: eventCycleDate(event),
    standing_autopilot: standingConsent,
  });
}

async function executeRelistRadarFreeRefreshes({
  admin,
  nowISO,
  summary,
}: {
  admin: AdminClient;
  nowISO: string;
  summary: Summary;
}): Promise<void> {
  const today = nowISO.slice(0, 10);
  const { data, error } = await relistRadarBaseEventQuery(admin)
    .eq("paid", false)
    .lte("cycle_date", today)
    .order("cycle_date", { ascending: true })
    .limit(RELIST_RADAR_MAX_EMAIL_EVENTS);
  if (error) throw new Error(`radar_execute_query:${error.message}`);
  const events = (data ?? []) as RelistRadarEventRow[];
  if (events.length === 0) return;

  const [properties, accounts] = await Promise.all([
    loadRelistRadarProperties(admin, events.map((event) => event.property_id)),
    loadRelistRadarChannelAccounts(admin, events),
  ]);

  for (const event of events) {
    try {
      const metadata = radarMetadata(event.metadata);
      const property = properties.get(event.property_id) ?? null;
      const account =
        accounts.get(orgChannelKey(event.organization_id, event.channel)) ?? null;
      const standingConsent = relistRadarStandingAutoRefreshConsent(account);
      const gate = relistRadarFreeExecutionGate({
        channelKey: event.channel,
        paid: event.paid,
        decision: event.decision,
        propertyStatus: property?.status ?? null,
        cycleDate: eventCycleDate(event),
        today,
        automationAuthorized: account?.automation_authorized === true,
        accountStatus: account?.account_status ?? null,
        standingConsent,
        alreadyEnqueued: Boolean(metadataString(metadata, "auto_refresh_enqueued_at")),
      });
      if (!gate.shouldEnqueue) {
        summary.skipped++;
        pushDetail(summary, {
          relist_radar_execute: "skipped",
          event: event.id,
          item: event.run_item_id,
          reason: gate.reason,
        });
        continue;
      }
      if (!property) {
        summary.skipped++;
        pushDetail(summary, {
          relist_radar_execute: "skipped",
          event: event.id,
          reason: "property_missing",
        });
        continue;
      }

      const item = await loadRelistRadarExecutionItem(admin, event.run_item_id);
      if (!item) {
        summary.skipped++;
        pushDetail(summary, {
          relist_radar_execute: "skipped",
          event: event.id,
          reason: "item_missing",
        });
        continue;
      }
      if (
        item.publish_status !== "live" ||
        item.external_expires_at?.slice(0, 10) !== eventCycleDate(event)
      ) {
        summary.skipped++;
        pushDetail(summary, {
          relist_radar_execute: "skipped",
          event: event.id,
          item: item.id,
          reason: "item_not_current_live_cycle",
        });
        continue;
      }

      const run = await loadRun(admin, item.run_id);
      if (!run || run.status === "cancelled") {
        summary.skipped++;
        pushDetail(summary, {
          relist_radar_execute: "skipped",
          event: event.id,
          item: item.id,
          reason: "run_inactive",
        });
        continue;
      }
      if (run.organization_id !== event.organization_id || run.property_id !== property.id) {
        summary.skipped++;
        pushDetail(summary, {
          relist_radar_execute: "skipped",
          event: event.id,
          item: item.id,
          reason: "run_event_mismatch",
        });
        continue;
      }

      await enqueueRelistRadarFreeRefresh({
        admin,
        event,
        item,
        run,
        property,
        metadata,
        gateReason: gate.reason,
        standingConsent: gate.standingConsent,
        nowISO,
        summary,
      });
    } catch (err) {
      summary.errors++;
      pushDetail(summary, {
        relist_radar_execute_error:
          err instanceof Error ? err.message : String(err),
        event: event.id,
        item: event.run_item_id,
      });
      console.error("[relist-radar] execute failed", {
        eventId: event.id,
        itemId: event.run_item_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

async function sendRelistRadarAutopilotRecaps({
  admin,
  nowISO,
  summary,
}: {
  admin: AdminClient;
  nowISO: string;
  summary: Summary;
}): Promise<void> {
  const today = nowISO.slice(0, 10);
  const window = previousUtcMonthWindow(today);
  if (!window) return;

  const { data, error } = await relistRadarBaseEventQuery(admin)
    .eq("paid", false)
    .gte("cycle_date", window.start)
    .lt("cycle_date", window.end)
    .order("cycle_date", { ascending: true })
    .limit(RELIST_RADAR_MAX_EMAIL_EVENTS);
  if (error) throw new Error(`radar_recap_query:${error.message}`);
  const due = ((data ?? []) as RelistRadarEventRow[]).filter((event) => {
    const meta = radarMetadata(event.metadata);
    return (
      Boolean(metadataString(meta, "auto_refresh_enqueued_at")) &&
      metadataBoolean(meta, "standing_autopilot") &&
      !metadataString(meta, "autopilot_recap_sent_at")
    );
  });
  if (due.length === 0) return;

  const [properties, orgs] = await Promise.all([
    loadRelistRadarProperties(
      admin,
      due.map((event) => event.property_id),
    ),
    loadRelistRadarOrgs(
      admin,
      due.map((event) => event.organization_id),
    ),
  ]);
  const dueByOrg = new Map<string, RelistRadarEventRow[]>();
  for (const event of due) {
    const rows = dueByOrg.get(event.organization_id) ?? [];
    rows.push(event);
    dueByOrg.set(event.organization_id, rows);
  }
  const settingsCache = new Map<string, RelistRadarSettings>();

  for (const [orgId, orgEvents] of dueByOrg) {
    const org = orgs.get(orgId) ?? null;
    if (!org) {
      summary.skipped++;
      pushDetail(summary, { relist_radar_recap: "org_missing", org: orgId });
      continue;
    }
    const settings = await loadRelistRadarSettingsForOrg(
      admin,
      org.id,
      settingsCache,
    );
    if (settings.autopilot_receipt !== "monthly") continue;

    const items: RelistRadarAutopilotRecapItem[] = orgEvents.map((event) => {
      const property = properties.get(event.property_id) ?? null;
      const channel = channelByKey(event.channel);
      const meta = radarMetadata(event.metadata);
      return {
        propertyAddress: property?.address ?? "this property",
        propertyId: event.property_id,
        channelLabel: channel?.label ?? event.channel,
        cycleDate: eventCycleDate(event),
        enqueuedAt: metadataString(meta, "auto_refresh_enqueued_at") ?? "",
        dashboardUrl: relistRadarManageUrl(APP_URL, event.property_id),
      };
    });

    const built = buildRelistRadarAutopilotRecap({
      appUrl: APP_URL,
      monthLabel: window.label,
      items,
    });
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
      eventKey: RELIST_RADAR_AUTOPILOT_RECAP_EVENT_KEY,
      vars: {
        org_name: org.name ?? "",
        property_address: "",
        relist_radar_subject: built.subject,
        relist_radar_body: built.body,
        dashboard_url: built.dashboardUrl,
      },
      operatorFallback: fallback,
      actions: built.actions,
    });
    if (!result.delivered) {
      summary.skipped++;
      pushDetail(summary, {
        relist_radar_recap: "send_skipped",
        org: org.id,
        reason: result.skipped ?? "send_failed",
      });
      continue;
    }

    for (const event of orgEvents) {
      const { error: stampErr } = await admin
        .from("relist_radar_events")
        .update({
          metadata: {
            ...radarMetadata(event.metadata),
            autopilot_recap_sent_at: nowISO,
          },
        })
        .eq("id", event.id);
      if (stampErr) throw new Error(`radar_recap_stamp:${stampErr.message}`);
    }

    summary.radar_recaps = (summary.radar_recaps ?? 0) + 1;
    pushDetail(summary, {
      relist_radar_recap: "sent",
      org: org.id,
      events: orgEvents.length,
      month: window.label,
    });
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

async function loadRelistRadarItems(
  admin: AdminClient,
  summary: Summary,
): Promise<RelistRadarItemRow[]> {
  let query = admin
    .from("distribution_run_items")
    .select(
      "id, organization_id, run_id, channel, publish_status, listing_post_id, external_expires_at",
    )
    .eq("publish_status", "live")
    .not("external_expires_at", "is", null);
  const orgIds = relistRadarAllowedOrgFilter();
  if (orgIds) query = query.in("organization_id", orgIds);
  const { data, error } = await query
    .order("external_expires_at", { ascending: true })
    .limit(MAX_ITEMS_PER_SWEEP);

  if (error) {
    summary.errors++;
    pushDetail(summary, { relist_radar: `item_query:${error.message}` });
    return [];
  }
  return (data ?? []) as RelistRadarItemRow[];
}

async function loadRelistRadarSettingsForOrg(
  admin: AdminClient,
  orgId: string,
  cache: Map<string, RelistRadarSettings>,
): Promise<RelistRadarSettings> {
  const cached = cache.get(orgId);
  if (cached) return cached;

  const { data, error } = await admin
    .from("relist_radar_settings")
    .select("settings")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) throw new Error(`radar_settings:${error.message}`);

  const settings = resolveRelistRadarSettings(
    (data as RelistRadarSettingsRow | null)?.settings,
  );
  cache.set(orgId, settings);
  return settings;
}

async function loadPropertyStatus(
  admin: AdminClient,
  propertyId: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from("properties")
    .select("status")
    .eq("id", propertyId)
    .maybeSingle();
  if (error) throw new Error(`radar_property:${error.message}`);
  return ((data as { status?: string | null } | null)?.status ?? null) as
    | string
    | null;
}

async function recordRelistRadarCandidate({
  admin,
  item,
  run,
  paid,
  expiresAt,
  cycleDate,
  daysToExpiry,
  notifyLeadDays,
  nowISO,
  summary,
}: {
  admin: AdminClient;
  item: RelistRadarItemRow;
  run: DistributionRunRow;
  paid: boolean;
  expiresAt: string;
  cycleDate: string;
  daysToExpiry: number;
  notifyLeadDays: number;
  nowISO: string;
  summary: Summary;
}): Promise<void> {
  const { data, error } = await admin
    .from("relist_radar_events")
    .upsert(
      {
        organization_id: run.organization_id,
        property_id: run.property_id,
        run_id: item.run_id,
        run_item_id: item.id,
        listing_post_id: item.listing_post_id,
        channel: item.channel,
        event_type: "radar_candidate",
        cycle_date: cycleDate,
        external_expires_at: expiresAt,
        paid,
        detected_at: nowISO,
        metadata: {
          source: "distribution_freshness_cron",
          days_to_expiry: daysToExpiry,
          notify_lead_days: notifyLeadDays,
        },
      },
      {
        onConflict: "run_item_id,event_type,cycle_date",
        ignoreDuplicates: true,
      },
    )
    .select("id");
  if (error) throw new Error(`radar_event:${error.message}`);

  const inserted = Array.isArray(data) && data.length > 0;
  if (inserted) {
    summary.radar_candidates = (summary.radar_candidates ?? 0) + 1;
    console.log(
      "[relist-radar]",
      JSON.stringify({
        event: "radar_candidate",
        organization_id: run.organization_id,
        property_id: run.property_id,
        run_item_id: item.id,
        channel: item.channel,
        cycle_date: cycleDate,
        days_to_expiry: daysToExpiry,
        paid,
      }),
    );
  }
  pushDetail(summary, {
    relist_radar: inserted ? "candidate" : "candidate_existing",
    item: item.id,
    channel: item.channel,
    cycle_date: cycleDate,
  });
}

async function detectRelistRadarCandidates({
  admin,
  nowISO,
  summary,
}: {
  admin: AdminClient;
  nowISO: string;
  summary: Summary;
}): Promise<void> {
  const items = await loadRelistRadarItems(admin, summary);
  const settingsCache = new Map<string, RelistRadarSettings>();

  for (const item of items) {
    try {
      if (!relistRadarOrgAllowed(item.organization_id)) {
        summary.skipped++;
        continue;
      }
      const channel = channelByKey(item.channel);
      if (!channel) {
        summary.skipped++;
        continue;
      }
      const run = await loadRun(admin, item.run_id);
      if (!run || run.status === "cancelled") {
        summary.skipped++;
        continue;
      }
      if (run.organization_id !== item.organization_id) {
        summary.skipped++;
        pushDetail(summary, {
          relist_radar: "skipped",
          item: item.id,
          reason: "run_item_org_mismatch",
        });
        continue;
      }
      const propertyStatus = await loadPropertyStatus(admin, run.property_id);
      const settings = await loadRelistRadarSettingsForOrg(
        admin,
        item.organization_id,
        settingsCache,
      );
      const classification = classifyRelistRadarCandidate({
        nowISO,
        propertyStatus,
        externalExpiresAt: item.external_expires_at,
        channelTtlDays: channel.ttlDays,
        notifyLeadDays: settings.notify_lead_days,
      });
      if (classification.kind !== "radar_candidate") {
        summary.skipped++;
        continue;
      }
      await recordRelistRadarCandidate({
        admin,
        item,
        run,
        paid: channel.paid,
        expiresAt: item.external_expires_at as string,
        cycleDate: classification.cycleDate,
        daysToExpiry: classification.daysToExpiry,
        notifyLeadDays: settings.notify_lead_days,
        nowISO,
        summary,
      });
    } catch (err) {
      summary.errors++;
      pushDetail(summary, {
        item: item.id,
        channel: item.channel,
        relist_radar_error: err instanceof Error ? err.message : String(err),
      });
      console.error("[relist-radar] item failed", {
        itemId: item.id,
        channel: item.channel,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
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

  if (envFlagEnabled(process.env.RELIST_RADAR_CLOCK_ENABLED)) {
    await detectRelistRadarCandidates({ admin, nowISO, summary });
  }

  if (envFlagEnabled(process.env.RELIST_RADAR_EMAIL_ENABLED)) {
    try {
      await sendRelistRadarEmails({ admin, nowISO, summary });
    } catch (err) {
      summary.errors++;
      pushDetail(summary, {
        relist_radar_email_error: err instanceof Error ? err.message : String(err),
      });
      console.error("[relist-radar] email failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (envFlagEnabled(process.env.RELIST_RADAR_EXECUTE_FREE_ENABLED)) {
    await executeRelistRadarFreeRefreshes({ admin, nowISO, summary });
    if (envFlagEnabled(process.env.RELIST_RADAR_EMAIL_ENABLED)) {
      try {
        await sendRelistRadarAutopilotRecaps({ admin, nowISO, summary });
      } catch (err) {
        summary.errors++;
        pushDetail(summary, {
          relist_radar_recap_error:
            err instanceof Error ? err.message : String(err),
        });
        console.error("[relist-radar] recap failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  await sendListingHealthAlerts({ admin, nowISO, summary });

  console.log("[distribution-freshness]", JSON.stringify(summary));
  return NextResponse.json(summary, { status: 200 });
}
