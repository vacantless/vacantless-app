// ============================================================================
// S553 Slice 1 - done-for-you posting WORKER (DARK).
//
// Turns done-for-you from a passive concierge queue into a worker that PREPARES
// one authorized concierge job per invocation and STOPS at the human gate. It:
//   1. is dark unless DISTRIBUTION_WORKER_ENABLED is set (env gate), AND
//   2. only touches a channel whose distribution_channel_accounts row has
//      automation_authorized = true (per-channel gate).
// It claims a FRESH (queued) concierge item via the same guarded-CAS posture as
// claimConciergeItem (flip queued -> submitting; a second worker/human loses the
// race), composes the post with the agent if a key is present (no-op otherwise),
// records an append-only attempt (actor_type 'agent'), moves the item to the
// correct gate (needs_login | needs_payment | needs_operator), RELEASES the claim
// so a human can finish, and notifies the operator. It NEVER logs in, enters a
// password/card, solves a CAPTCHA, clicks final submit, or writes external_url /
// live / submitted. Proof-before-Live stays with completeConciergeItem.
// ============================================================================

import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { envFlagEnabled } from "@/lib/auto-listing-copy";
import { sendOrgNotification } from "@/lib/notifications-server";
import { resolveLeadNotifyEmails } from "@/lib/leads-notify";
import type { NotifyMember } from "@/lib/incident-reports";
import { buildAttemptRecord } from "@/lib/distribution-attempts";
import { buildRunSteps } from "@/lib/distribution-run";
import { channelByKey } from "@/lib/distribution-channels";
import {
  assertWorkerNeverTerminal,
  selectGate,
  workerJobEligible,
  type WorkerGate,
  type WorkerListingFacts,
} from "@/lib/distribution-worker";
import { composePostWithAgent } from "@/lib/distribution-worker-ai";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const APP_URL = (
  process.env.NEXT_PUBLIC_APP_URL || "https://app.vacantless.com"
).replace(/\/+$/, "");
const MAX_RECIPIENTS = 10;
const CANDIDATE_LIMIT = 25;

// A fixed, non-user sentinel that marks the worker's transient claim on a run
// item (concierge_claimed_by has no FK, so this is safe). It is set during
// preparation and cleared when the item is moved to its gate, so a human sees an
// unclaimed item at the gate. Distinct from any real auth user id.
const WORKER_CLAIM_ID = "00000000-0000-4553-8000-000000000553";

const NOTIF_EVENT = "leasing.distribution_job_needs_action";

const GATE_STEP: Record<WorkerGate, string> = {
  needs_login: "log in to the channel (and clear any CAPTCHA), then review and submit the post",
  needs_payment: "complete the channel's payment, then review and submit the post",
  needs_operator: "review the prepared post and click submit, then paste the live URL",
};

type Summary = {
  ok: boolean;
  enabled: boolean;
  reason?: string;
  scanned: number;
  claimed: number;
  prepared: number;
  gate: WorkerGate | null;
  notified: boolean;
  skippedReason?: string;
  details: Array<Record<string, unknown>>;
};

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const qp = req.nextUrl.searchParams.get("secret");
  return qp === secret;
}

type AdminClient = NonNullable<ReturnType<typeof createAdminClient>>;

type CandidateRow = {
  id: string;
  organization_id: string;
  run_id: string;
  property_id: string;
  channel: string;
  publish_status: string;
  mode: string;
  concierge_claimed_by: string | null;
  attempt_count: number | null;
};

type ChannelAccountRow = {
  automation_authorized: boolean | null;
  requires_login: boolean | null;
  requires_payment: boolean | null;
  account_status: string | null;
};

async function operatorFallbackForOrg(
  admin: AdminClient,
  org: { id: string; reply_to_email: string | null; public_contact_email: string | null },
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

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  const base: Summary = {
    ok: true,
    enabled: false,
    scanned: 0,
    claimed: 0,
    prepared: 0,
    gate: null,
    notified: false,
    details: [],
  };

  // Env dark gate.
  if (!envFlagEnabled(process.env.DISTRIBUTION_WORKER_ENABLED)) {
    return NextResponse.json({ ...base, reason: "disabled" }, { status: 200 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { ...base, enabled: true, ok: false, reason: "service_role_not_configured" },
      { status: 200 },
    );
  }

  try {
    // Fresh, unclaimed concierge candidates (the only worker-eligible state).
    const { data: candData, error: candErr } = await admin
      .from("distribution_run_items")
      .select(
        "id, organization_id, run_id, property_id, channel, publish_status, mode, concierge_claimed_by, attempt_count",
      )
      .eq("mode", "concierge")
      .eq("publish_status", "queued")
      .is("concierge_claimed_by", null)
      .order("created_at", { ascending: true })
      .limit(CANDIDATE_LIMIT);
    if (candErr) {
      return NextResponse.json(
        { ...base, enabled: true, ok: false, reason: "query_failed", skippedReason: candErr.message },
        { status: 200 },
      );
    }
    const candidates = (candData ?? []) as CandidateRow[];
    const summary: Summary = { ...base, enabled: true, scanned: candidates.length };

    // Find the first candidate whose channel is authorized for automation.
    let job: CandidateRow | null = null;
    let account: ChannelAccountRow | null = null;
    for (const c of candidates) {
      const { data: acct } = await admin
        .from("distribution_channel_accounts")
        .select("automation_authorized, requires_login, requires_payment, account_status")
        .eq("organization_id", c.organization_id)
        .eq("channel", c.channel)
        .maybeSingle();
      const a = (acct as ChannelAccountRow | null) ?? null;
      const eligible = workerJobEligible({
        mode: c.mode as CandidateRow["mode"] as never,
        publishStatus: c.publish_status as never,
        automationAuthorized: a?.automation_authorized === true,
        claimedBy: c.concierge_claimed_by,
      });
      if (eligible) {
        job = c;
        account = a;
        break;
      }
    }

    if (!job || !account) {
      return NextResponse.json({ ...summary, skippedReason: "no_authorized_job" }, { status: 200 });
    }

    // CLAIM via guarded CAS: flip queued -> submitting and take the transient
    // worker claim, only if still queued + unclaimed. A concurrent worker or a
    // human claimConciergeItem loses this race (0 rows) and we stop.
    const nowISO = new Date().toISOString();
    const { data: claimed } = await admin
      .from("distribution_run_items")
      .update({
        concierge_claimed_by: WORKER_CLAIM_ID,
        concierge_claimed_at: nowISO,
        publish_status: "submitting",
        status: "in_progress",
        last_attempted_at: nowISO,
        updated_at: nowISO,
      })
      .eq("id", job.id)
      .eq("mode", "concierge")
      .eq("publish_status", "queued")
      .is("concierge_claimed_by", null)
      .select("id");
    if (!claimed || claimed.length === 0) {
      return NextResponse.json({ ...summary, skippedReason: "claim_lost" }, { status: 200 });
    }
    summary.claimed = 1;

    // Load the property facts for the compose prompt + notification address.
    const { data: prop } = await admin
      .from("properties")
      .select("id, address, beds, baths, rent_cents, description")
      .eq("id", job.property_id)
      .maybeSingle();
    const address = (prop?.address as string | null) ?? null;
    const listing: WorkerListingFacts = {
      propertyAddress: address,
      beds: (prop?.beds as number | null) ?? null,
      baths: (prop?.baths as number | null) ?? null,
      rentCents: (prop?.rent_cents as number | null) ?? null,
      unitType: null,
      description: (prop?.description as string | null) ?? null,
    };

    const channelMeta = channelByKey(job.channel);
    const channelLabel = channelMeta?.label ?? job.channel;
    const steps = buildRunSteps(job.channel);

    // Compose (dark-safe: no key => no-op, the human composes at the gate).
    const compose = await composePostWithAgent({
      channelKey: job.channel,
      channelLabel,
      listing,
      steps,
    });

    // Decide the gate. Never a terminal state.
    const gate = selectGate({
      requiresLogin: account.requires_login === true,
      connected: account.account_status === "connected",
      channelRequiresPayment: account.requires_payment === true,
      paymentCleared: false, // no payment-cleared signal exists yet; a paid channel always gates on payment
    });
    assertWorkerNeverTerminal(gate);
    summary.gate = gate;

    // Record the attempt (append-only, actor_type 'agent') BEFORE the gate flip.
    const attempt = buildAttemptRecord({
      organizationId: job.organization_id,
      runId: job.run_id,
      runItemId: job.id,
      channel: job.channel,
      transport: "concierge",
      currentAttemptCount: job.attempt_count ?? 0,
      actorType: "agent",
      actorUserId: null,
      statusBefore: "queued",
      statusAfter: gate,
      metadata: {
        source: "distribution_worker",
        composed: compose.composed != null,
        compose_skipped: compose.skipped,
      },
    });
    await admin.from("distribution_publish_attempts").insert({
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

    // Move the item to the gate and RELEASE the transient claim so a human can
    // finish. Guarded on our own claim so we never clobber a concurrent actor.
    // NEVER writes external_url / live / submitted.
    const gateISO = new Date().toISOString();
    const { data: gated } = await admin
      .from("distribution_run_items")
      .update({
        publish_status: gate,
        status: "in_progress",
        concierge_claimed_by: null,
        concierge_claimed_at: null,
        audit_message: `Prepared by the posting worker. Next: ${GATE_STEP[gate]}.`,
        updated_at: gateISO,
      })
      .eq("id", job.id)
      .eq("concierge_claimed_by", WORKER_CLAIM_ID)
      .select("id");
    if (!gated || gated.length === 0) {
      return NextResponse.json({ ...summary, skippedReason: "gate_write_lost" }, { status: 200 });
    }
    summary.prepared = 1;

    // Notify the operator that a prepared post needs a human at the gate.
    const { data: org } = await admin
      .from("organizations")
      .select("id, name, brand_color, logo_url, reply_to_email, public_contact_email")
      .eq("id", job.organization_id)
      .maybeSingle();
    if (org) {
      const dashboardUrl = `${APP_URL}/dashboard/properties/${job.property_id}#distribute-header`;
      const fallback = await operatorFallbackForOrg(admin, {
        id: org.id as string,
        reply_to_email: (org.reply_to_email as string | null) ?? null,
        public_contact_email: (org.public_contact_email as string | null) ?? null,
      });
      const result = await sendOrgNotification({
        client: admin,
        org: {
          id: org.id as string,
          name: (org.name as string | null) ?? null,
          brand_color: (org.brand_color as string | null) ?? null,
          logo_url: (org.logo_url as string | null) ?? null,
          reply_to_email: (org.reply_to_email as string | null) ?? null,
        },
        eventKey: NOTIF_EVENT,
        vars: {
          org_name: (org.name as string | null) ?? "",
          property_address: address ?? "",
          channel_label: channelLabel,
          gate_label: gate,
          next_step: GATE_STEP[gate],
          dashboard_url: dashboardUrl,
        },
        operatorFallback: fallback,
        action: { label: "Open Distribute", url: dashboardUrl },
      });
      summary.notified = result.delivered;
    }

    return NextResponse.json(summary, { status: 200 });
  } catch (err) {
    // Deploy-safe: a missing 0177 column / key / table no-ops the job rather
    // than 500ing the cron.
    return NextResponse.json(
      {
        ...base,
        enabled: true,
        ok: false,
        reason: "worker_error",
        skippedReason: err instanceof Error ? err.message : String(err),
      },
      { status: 200 },
    );
  }
}
