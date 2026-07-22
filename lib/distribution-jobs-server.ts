// Server-only S553 distribution job orchestration.

import type { SupabaseClient } from "@supabase/supabase-js";
import { isAsciiApiKey } from "./listing-extract";
import { sendNotificationEmail } from "./email";
import { sendOrgNotification, type NotifyOrg } from "./notifications-server";
import { MAX_NOTIFICATION_RECIPIENTS } from "./notifications";
import { roleCan } from "./roles";
import { createAdminClient } from "./supabase/admin";
import { adminEmails } from "./provisioning-server";
import {
  canCallAiForDistributionJob,
  distributionJobAdapterForChannel,
  distributionJobStatusLabel,
  distributionJobWorkerDecision,
  humanGateLabel,
  minimumDistributionJobPayload,
  type DistributionJobAdapter,
  type DistributionJobStatus,
  type MinimumDistributionJobPayload,
} from "./distribution-jobs";

const APP_URL = (
  process.env.NEXT_PUBLIC_APP_URL || "https://app.vacantless.com"
).replace(/\/+$/, "");
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_AI_MODEL = "claude-haiku-4-5-20251001";
const AI_TIMEOUT_MS = 12_000;
const MAX_JOBS_PER_SWEEP = 25;

type AdminClient = NonNullable<ReturnType<typeof createAdminClient>>;

type ChannelAccountRow = {
  account_status: string | null;
  feed_url: string | null;
  manager_url: string | null;
  external_account_label: string | null;
};

type PropertyRow = {
  id: string;
  address: string | null;
  rent_cents: number | null;
  beds: number | null;
  baths: number | null;
  description: string | null;
};

type OrgRow = NotifyOrg & {
  public_contact_email?: string | null;
};

export type DistributionJobRow = {
  id: string;
  organization_id: string;
  property_id: string;
  run_id: string;
  run_item_id: string;
  channel: string;
  transport: string | null;
  status: string | null;
  account_status_snapshot: string | null;
  ai_consent_at: string | null;
  minimum_payload: unknown;
  attempt_count: number | null;
};

export type EnqueueDistributionJobResult =
  | { ok: true; jobId: string }
  | { ok: false; reason: "table_unavailable" | "insert_failed" | "missing_context" };

export async function enqueueDistributionJobForConciergeRequest(args: {
  client: SupabaseClient;
  orgId: string;
  propertyId: string;
  runId: string;
  runItemId: string;
  channel: string;
  requestedBy: string | null;
  aiConsent: boolean;
}): Promise<EnqueueDistributionJobResult> {
  const now = new Date().toISOString();
  const adapter = distributionJobAdapterForChannel(args.channel);
  const account = await loadChannelAccount(args.client, args.orgId, adapter);
  const property = await loadProperty(args.client, args.propertyId);
  const publicUrl = `${APP_URL}/r/${args.propertyId}`;
  const payload = minimumDistributionJobPayload({
    channel: args.channel,
    propertyAddress: property?.address,
    rentCents: property?.rent_cents,
    beds: property?.beds,
    baths: property?.baths,
    publicUrl,
    listingCopy: property?.description,
  });

  const row = {
    organization_id: args.orgId,
    property_id: args.propertyId,
    run_id: args.runId,
    run_item_id: args.runItemId,
    channel: adapter.channel,
    transport: adapter.transport,
    source: "concierge_request",
    status: "queued" satisfies DistributionJobStatus,
    adapter_kind: adapter.kind,
    requested_by: args.requestedBy,
    requested_at: now,
    next_run_at: now,
    account_status_snapshot: account?.account_status ?? null,
    requires_connected_account: adapter.requiresConnectedAccount,
    requires_login: adapter.requiresLogin,
    requires_payment: adapter.requiresPayment,
    requires_captcha_gate: adapter.requiresCaptchaGate,
    requires_human_final_submit: adapter.requiresHumanFinalSubmit,
    proof_required: true,
    ai_consent_at: args.aiConsent ? now : null,
    ai_consent_by: args.aiConsent ? args.requestedBy : null,
    minimum_payload: payload,
    human_gates: adapter.humanGates,
    blockers: [],
    notification_state: { queued_requested_at: now },
    updated_at: now,
  };

  const { data, error } = await args.client
    .from("distribution_jobs")
    .upsert(row, { onConflict: "run_item_id" })
    .select("id")
    .single();

  if (error) {
    const reason = missingRelation(error)
      ? "table_unavailable"
      : "insert_failed";
    console.error("enqueueDistributionJobForConciergeRequest failed", {
      reason,
      runItemId: args.runItemId,
      channel: args.channel,
      error,
    });
    return { ok: false, reason };
  }

  const jobId = (data?.id as string | undefined) ?? null;
  if (!jobId) return { ok: false, reason: "insert_failed" };

  void notifyDistributionJobQueued({
    orgId: args.orgId,
    propertyId: args.propertyId,
    runItemId: args.runItemId,
    jobId,
    adapter,
    payload,
  });
  return { ok: true, jobId };
}

export async function markDistributionJobPreparingForRunItem(args: {
  admin: AdminClient;
  runItemId: string;
  assignedTo: string;
}): Promise<void> {
  const now = new Date().toISOString();
  await args.admin
    .from("distribution_jobs")
    .update({
      status: "preparing",
      assigned_to: args.assignedTo,
      claimed_at: now,
      updated_at: now,
    })
    .eq("run_item_id", args.runItemId)
    .in("status", ["queued", "blocked", "ready_for_human", "preparing"]);
}

export async function markDistributionJobCompletedForRunItem(args: {
  admin: AdminClient;
  orgId: string;
  propertyId: string;
  runItemId: string;
  channel: string;
  proofUrl: string | null;
  proofVerificationId: string | null;
}): Promise<void> {
  const now = new Date().toISOString();
  await args.admin
    .from("distribution_jobs")
    .update({
      status: "completed",
      completed_at: now,
      proof_url: args.proofUrl,
      proof_verification_id: args.proofVerificationId,
      blockers: [],
      last_error: null,
      updated_at: now,
    })
    .eq("run_item_id", args.runItemId);

  const adapter = distributionJobAdapterForChannel(args.channel);
  const property = await loadProperty(args.admin, args.propertyId);
  await notifyDistributionJobOperator({
    admin: args.admin,
    orgId: args.orgId,
    property,
    eventKey: "leasing.distribution_job_completed",
    adapter,
    statusLabel: distributionJobStatusLabel("completed"),
    detail:
      args.proofUrl ??
      "Proof was saved through the Vacantless publishing desk.",
    dashboardUrl: `${APP_URL}/dashboard/properties/${args.propertyId}#distribute-header`,
  });
}

export async function markDistributionJobBlockedForRunItem(args: {
  admin: AdminClient;
  orgId: string;
  propertyId: string;
  runItemId: string;
  channel: string;
  reason: string;
  failed?: boolean;
}): Promise<void> {
  const now = new Date().toISOString();
  const status: DistributionJobStatus = args.failed ? "failed" : "blocked";
  await args.admin
    .from("distribution_jobs")
    .update({
      status,
      blockers: [args.reason],
      last_error: args.reason,
      updated_at: now,
    })
    .eq("run_item_id", args.runItemId);

  const adapter = distributionJobAdapterForChannel(args.channel);
  const property = await loadProperty(args.admin, args.propertyId);
  await notifyDistributionJobBlocked({
    admin: args.admin,
    orgId: args.orgId,
    property,
    adapter,
    reason: args.reason,
    dashboardUrl: `${APP_URL}/dashboard/properties/${args.propertyId}#distribute-header`,
  });
}

export type ProcessDistributionJobsSummary = {
  scanned: number;
  prepared: number;
  readyForHuman: number;
  blocked: number;
  errors: number;
  details: Array<Record<string, unknown>>;
};

export async function processDueDistributionJobs(
  admin: AdminClient,
  opts?: { limit?: number; workerId?: string },
): Promise<ProcessDistributionJobsSummary> {
  const summary: ProcessDistributionJobsSummary = {
    scanned: 0,
    prepared: 0,
    readyForHuman: 0,
    blocked: 0,
    errors: 0,
    details: [],
  };
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("distribution_jobs")
    .select(
      "id, organization_id, property_id, run_id, run_item_id, channel, transport, status, account_status_snapshot, ai_consent_at, minimum_payload, attempt_count",
    )
    .eq("status", "queued")
    .lte("next_run_at", now)
    .order("requested_at", { ascending: true })
    .limit(opts?.limit ?? MAX_JOBS_PER_SWEEP);

  if (error) {
    summary.errors += 1;
    summary.details.push({ stage: "load", error: publicError(error) });
    return summary;
  }

  for (const job of (data ?? []) as DistributionJobRow[]) {
    summary.scanned += 1;
    try {
      const outcome = await processOneDistributionJob(admin, job, opts?.workerId);
      if (outcome === "blocked") summary.blocked += 1;
      else if (outcome === "ready_for_human") summary.readyForHuman += 1;
      else summary.prepared += 1;
      summary.details.push({ jobId: job.id, status: outcome });
    } catch (err) {
      summary.errors += 1;
      summary.details.push({
        jobId: job.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return summary;
}

async function processOneDistributionJob(
  admin: AdminClient,
  job: DistributionJobRow,
  workerId: string | undefined,
): Promise<DistributionJobStatus> {
  const adapter = distributionJobAdapterForChannel(job.channel);
  const decision = distributionJobWorkerDecision({
    adapter,
    accountStatus: job.account_status_snapshot,
  });
  const payload =
    typeof job.minimum_payload === "object" && job.minimum_payload !== null
      ? (job.minimum_payload as MinimumDistributionJobPayload)
      : minimumDistributionJobPayload({ channel: job.channel });
  const ai = await maybePrepareWithAnthropic({
    adapter,
    payload,
    aiConsentAt: job.ai_consent_at,
  });
  const now = new Date().toISOString();
  const update: Record<string, unknown> = {
    status: decision.status,
    blockers: decision.blockers,
    last_error: decision.status === "blocked" ? decision.blockers.join(" ") : null,
    locked_at: null,
    locked_by: workerId ?? "distribution_jobs_worker",
    attempt_count: Math.max(0, Number(job.attempt_count ?? 0)) + 1,
    updated_at: now,
  };
  if (ai) {
    update.ai_prepared_at = now;
    update.ai_model = ai.model;
    update.ai_result = ai.result;
  }
  await admin.from("distribution_jobs").update(update).eq("id", job.id);
  if (decision.runItemPublishStatus) {
    await admin
      .from("distribution_run_items")
      .update({
        publish_status: decision.runItemPublishStatus,
        status: "in_progress",
        blockers: decision.blockers,
        error_message:
          decision.status === "blocked" ? decision.blockers.join(" ") : null,
        audit_message: decision.nextStep,
        updated_at: now,
      })
      .eq("id", job.run_item_id)
      .eq("mode", "concierge");
  }

  if (decision.status === "blocked") {
    const property = await loadProperty(admin, job.property_id);
    await notifyDistributionJobBlocked({
      admin,
      orgId: job.organization_id,
      property,
      adapter,
      reason: decision.blockers.join(" "),
      dashboardUrl: `${APP_URL}/dashboard/properties/${job.property_id}#distribute-header`,
    });
  }
  return decision.status;
}

async function maybePrepareWithAnthropic(args: {
  adapter: DistributionJobAdapter;
  payload: MinimumDistributionJobPayload;
  aiConsentAt: string | null;
}): Promise<{ model: string; result: Record<string, unknown> } | null> {
  if (process.env.DISTRIBUTION_JOB_AI_ENABLED !== "true") return null;
  if (!canCallAiForDistributionJob(args)) return null;
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey || !isAsciiApiKey(apiKey)) return null;

  const model = process.env.DISTRIBUTION_JOB_AI_MODEL || DEFAULT_AI_MODEL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: 700,
        system:
          "You prepare rental posting work for a human operator. You do not log in, pay, solve CAPTCHA, submit externally, or mark anything live. Use only supplied facts.",
        messages: [
          {
            role: "user",
            content: [
              "Prepare a concise channel posting packet from the minimum facts below.",
              "Return plain text with: copy notes, fields to check, human gates, proof to collect.",
              "Do not invent amenities, neighbourhood claims, renter traits, or unsupported terms.",
              "",
              JSON.stringify(args.payload, null, 2),
            ].join("\n"),
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const text =
      json.content?.find((block) => block.type === "text" && typeof block.text === "string")
        ?.text ?? null;
    return text ? { model, result: { text } } : null;
  } catch (err) {
    console.error("distribution job AI prep failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function notifyDistributionJobQueued(args: {
  orgId: string;
  propertyId: string;
  runItemId: string;
  jobId: string;
  adapter: DistributionJobAdapter;
  payload: MinimumDistributionJobPayload;
}): Promise<void> {
  const admin = createAdminClient();
  if (!admin) return;
  const org = await loadOrg(admin, args.orgId);
  if (!org) return;
  const dashboardUrl = `${APP_URL}/dashboard/properties/${args.propertyId}#distribute-header`;
  await notifyStaff({
    org,
    subject: `Done-for-you queued: ${args.adapter.channelLabel}`,
    body: [
      `${org.name ?? "An org"} queued a done-for-you ${args.adapter.channelLabel} job.`,
      `Property: ${args.payload.propertyAddress ?? "(no address)"}`,
      `Job: ${args.jobId}`,
      `Run item: ${args.runItemId}`,
      `Human gates: ${args.adapter.humanGates.map(humanGateLabel).join(", ")}`,
      `Open: ${dashboardUrl}`,
    ].join("\n"),
    actionUrl: `${APP_URL}/dashboard/admin/concierge`,
    actionLabel: "Open desk",
  });
  await notifyDistributionJobOperator({
    admin,
    orgId: args.orgId,
    property: {
      id: args.propertyId,
      address: args.payload.propertyAddress,
      rent_cents: args.payload.rentCents,
      beds: args.payload.beds,
      baths: args.payload.baths,
      description: args.payload.listingCopy,
    },
    eventKey: "leasing.distribution_job_queued",
    adapter: args.adapter,
    statusLabel: distributionJobStatusLabel("queued"),
    detail: "The Vacantless publishing desk has the channel in its work queue.",
    dashboardUrl,
  });
}

async function notifyDistributionJobBlocked(args: {
  admin: AdminClient;
  orgId: string;
  property: PropertyRow | null;
  adapter: DistributionJobAdapter;
  reason: string;
  dashboardUrl: string;
}): Promise<void> {
  const org = await loadOrg(args.admin, args.orgId);
  if (!org) return;
  await notifyStaff({
    org,
    subject: `Done-for-you blocked: ${args.adapter.channelLabel}`,
    body: [
      `${org.name ?? "An org"} has a blocked ${args.adapter.channelLabel} job.`,
      `Property: ${args.property?.address ?? "(no address)"}`,
      `Reason: ${args.reason}`,
      `Open: ${args.dashboardUrl}`,
    ].join("\n"),
    actionUrl: `${APP_URL}/dashboard/admin/concierge`,
    actionLabel: "Open desk",
  });
  await notifyDistributionJobOperator({
    admin: args.admin,
    orgId: args.orgId,
    property: args.property,
    eventKey: "leasing.distribution_job_blocked",
    adapter: args.adapter,
    statusLabel: distributionJobStatusLabel("blocked"),
    detail: args.reason,
    dashboardUrl: args.dashboardUrl,
  });
}

async function notifyDistributionJobOperator(args: {
  admin: AdminClient;
  orgId: string;
  property: PropertyRow | null;
  eventKey: string;
  adapter: DistributionJobAdapter;
  statusLabel: string;
  detail: string;
  dashboardUrl: string;
}): Promise<void> {
  const org = await loadOrg(args.admin, args.orgId);
  if (!org) return;
  const operatorFallback = await propertyOperatorFallbackForOrg(args.admin, org);
  await sendOrgNotification({
    client: args.admin,
    org,
    eventKey: args.eventKey,
    vars: {
      org_name: org.name ?? "",
      property_address: args.property?.address ?? "(unspecified property)",
      distribution_channel: args.adapter.channelLabel,
      job_status: args.statusLabel,
      job_detail: args.detail,
      dashboard_url: args.dashboardUrl,
    },
    operatorFallback,
    action: { label: "Open distribution", url: args.dashboardUrl },
  });
}

async function notifyStaff(args: {
  org: NotifyOrg;
  subject: string;
  body: string;
  actionUrl: string;
  actionLabel: string;
}): Promise<void> {
  const recipients = adminEmails().slice(0, MAX_NOTIFICATION_RECIPIENTS);
  await Promise.allSettled(
    recipients.map((to) =>
      sendNotificationEmail({
        to_email: to,
        subject: args.subject,
        body: args.body,
        action_label: args.actionLabel,
        action_url: args.actionUrl,
        org_name: args.org.name ?? "Vacantless",
        brand_color: args.org.brand_color,
        logo_url: args.org.logo_url,
        reply_to_email: args.org.reply_to_email,
      }),
    ),
  );
}

async function propertyOperatorFallbackForOrg(
  admin: AdminClient,
  org: OrgRow,
): Promise<string[]> {
  const { data: memberRows } = await admin
    .from("memberships")
    .select("user_id, role")
    .eq("organization_id", org.id);
  const out: string[] = [];
  for (const m of (memberRows ?? []) as { user_id: string; role: string }[]) {
    if (!roleCan(m.role, "manage_properties")) continue;
    const { data: u } = await admin.auth.admin.getUserById(m.user_id);
    const email = normalizeEmail(u?.user?.email);
    if (email && !out.includes(email)) out.push(email);
  }
  if (out.length === 0) {
    const fallback = normalizeEmail(org.reply_to_email ?? org.public_contact_email ?? null);
    if (fallback) out.push(fallback);
  }
  return out.slice(0, MAX_NOTIFICATION_RECIPIENTS);
}

async function loadChannelAccount(
  client: SupabaseClient,
  orgId: string,
  adapter: DistributionJobAdapter,
): Promise<ChannelAccountRow | null> {
  const { data, error } = await client
    .from("distribution_channel_accounts")
    .select("account_status, feed_url, manager_url, external_account_label")
    .eq("organization_id", orgId)
    .eq("channel", adapter.channel)
    .maybeSingle();
  if (error) return null;
  return (data as ChannelAccountRow | null) ?? null;
}

async function loadProperty(
  client: SupabaseClient,
  propertyId: string,
): Promise<PropertyRow | null> {
  const { data } = await client
    .from("properties")
    .select("id, address, rent_cents, beds, baths, description")
    .eq("id", propertyId)
    .maybeSingle();
  return (data as PropertyRow | null) ?? null;
}

async function loadOrg(
  admin: AdminClient,
  orgId: string,
): Promise<OrgRow | null> {
  const { data } = await admin
    .from("organizations")
    .select("id, name, brand_color, logo_url, reply_to_email, public_contact_email")
    .eq("id", orgId)
    .maybeSingle();
  return (data as OrgRow | null) ?? null;
}

function normalizeEmail(value: string | null | undefined): string | null {
  const email = value?.trim().toLowerCase() ?? "";
  return email && email.includes("@") ? email : null;
}

function missingRelation(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "42P01" || code === "PGRST205";
}

function publicError(error: unknown): string {
  const e = error as { code?: unknown; message?: unknown } | null;
  return [e?.code, e?.message].filter(Boolean).join(":") || "unknown";
}
