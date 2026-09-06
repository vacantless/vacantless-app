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
import {
  daysParked,
  selectStuckToAlert,
  stuckKind,
  STUCK_GATE_LABEL,
  STUCK_NEXT_STEP,
  type StuckCandidate,
} from "@/lib/distribution-stuck-sweep";

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
  /** S681: how many stuck-backlog alerts this invocation actually delivered. */
  sweptAlerts: number;
  /**
   * S681: why the sweep did nothing, when it did nothing. The first version
   * returned a bare 0 on error, so a swallowed PostgREST failure looked exactly
   * like a healthy quiet run. The GH Action prints this response body, so the
   * reason has to be IN it or nobody can tell the two apart.
   */
  sweepSkipped?: string;
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
  channel: string;
  publish_status: string;
  mode: string;
  transport: string | null;
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

async function releaseWorkerClaim(
  admin: AdminClient,
  itemId: string,
  auditMessage: string,
): Promise<void> {
  const now = new Date().toISOString();
  await admin
    .from("distribution_run_items")
    .update({
      publish_status: "queued",
      status: "in_progress",
      concierge_claimed_by: null,
      concierge_claimed_at: null,
      audit_message: auditMessage,
      updated_at: now,
    })
    .eq("id", itemId)
    .eq("concierge_claimed_by", WORKER_CLAIM_ID);
}


const SWEEP_SCAN_LIMIT = 200;

// ---------------------------------------------------------------------------
// S681: the stuck-item backlog sweep.
//
// leasing.distribution_job_needs_action only ever fired at the INSTANT this
// cron moved an item to its gate. Nothing looked at an item that was ALREADY
// parked, so anything that reached a gate by another path, or before that code
// shipped, was never mentioned again. Measured 2026-09-05: nine items parked,
// the oldest 54 days, including a real landlord org whose concierge request had
// been `queued` for 48 days and could never be claimed, because that org has no
// distribution_channel_accounts row.
//
// Reuses the existing event, recipients and templates. No new event.
// ---------------------------------------------------------------------------
type SweepResult = { alerted: number; skipped?: string };

async function runStuckSweep(admin: AdminClient): Promise<SweepResult> {
  try {
    const { data, error } = await admin
      .from("distribution_run_items")
      .select(
        "id, organization_id, run_id, channel, publish_status, mode, created_at, updated_at, last_stuck_alerted_at",
      )
      .in("publish_status", ["needs_login", "needs_payment", "needs_operator", "queued"])
      .limit(SWEEP_SCAN_LIMIT);
    // Name the failure. A missing column (migration 0224 not applied, or
    // PostgREST's schema cache not yet reloaded after it) reads identically to
    // "nothing was due" unless the reason is reported.
    if (error) return { alerted: 0, skipped: `query_failed: ${error.message}` };
    if (!data) return { alerted: 0, skipped: "query_returned_no_rows" };

    const nowMs = Date.now();
    const nowISO = new Date(nowMs).toISOString();
    const due = selectStuckToAlert(data as unknown as StuckCandidate[], nowMs);

    let delivered = 0;
    let considered = 0;
    for (const item of due) {
      const kind = stuckKind(item);
      if (!kind) continue;
      considered += 1;

      const { data: orgRow } = await admin
        .from("organizations")
        .select("id, name, brand_color, logo_url, reply_to_email, public_contact_email")
        .eq("id", item.organization_id)
        .maybeSingle();
      if (!orgRow) continue;

      const { data: runRow } = await admin
        .from("distribution_runs")
        .select("property_id")
        .eq("id", item.run_id)
        .maybeSingle();
      const propertyId = (runRow?.property_id as string | null) ?? null;

      let address: string | null = null;
      if (propertyId) {
        const { data: prop } = await admin
          .from("properties")
          .select("address")
          .eq("id", propertyId)
          .maybeSingle();
        address = (prop?.address as string | null) ?? null;
      }

      const dashboardUrl = propertyId
        ? `${APP_URL}/dashboard/properties/${propertyId}#distribute-header`
        : `${APP_URL}/dashboard/properties`;
      const days = daysParked(item, nowMs);
      const waited = `It has been waiting ${days} day${days === 1 ? "" : "s"}.`;

      const fallback = await operatorFallbackForOrg(admin, {
        id: orgRow.id as string,
        reply_to_email: (orgRow.reply_to_email as string | null) ?? null,
        public_contact_email: (orgRow.public_contact_email as string | null) ?? null,
      });

      const result = await sendOrgNotification({
        client: admin,
        org: {
          id: orgRow.id as string,
          name: (orgRow.name as string | null) ?? null,
          brand_color: (orgRow.brand_color as string | null) ?? null,
          logo_url: (orgRow.logo_url as string | null) ?? null,
          reply_to_email: (orgRow.reply_to_email as string | null) ?? null,
        },
        eventKey: NOTIF_EVENT,
        vars: {
          org_name: (orgRow.name as string | null) ?? "",
          property_address: address ?? "",
          channel_label: channelByKey(item.channel)?.label ?? item.channel,
          gate_label: STUCK_GATE_LABEL[kind],
          next_step: `${STUCK_NEXT_STEP[kind]}. ${waited}`,
          dashboard_url: dashboardUrl,
        },
        operatorFallback: fallback,
        action: { label: "Open Distribute", url: dashboardUrl },
      });

      // Stamp whether or not it was delivered. An org with no reachable
      // recipient must not make the sweep retry it on every single run.
      await admin
        .from("distribution_run_items")
        .update({ last_stuck_alerted_at: nowISO })
        .eq("id", item.id);

      if (result.delivered) delivered += 1;
    }
    if (due.length === 0) return { alerted: 0, skipped: "nothing_due" };
    if (delivered === 0)
      return { alerted: 0, skipped: `considered_${considered}_delivered_none` };
    return { alerted: delivered };
  } catch (err) {
    // Deploy-safe, matching this route's existing posture: the sweep must never
    // break the posting worker. But it must SAY why it stopped.
    return {
      alerted: 0,
      skipped: `threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
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
    sweptAlerts: 0,
    details: [],
  };

  // The admin client is resolved BEFORE the dark gate because the stuck sweep
  // below needs it and runs whether or not the posting worker is armed.
  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { ...base, ok: false, reason: "service_role_not_configured" },
      { status: 200 },
    );
  }

  // S681: the stuck sweep runs BEFORE the env dark gate ON PURPOSE. That gate
  // guards POSTING. Telling an operator an item has been parked for weeks is a
  // read and an email, and withholding it while the worker is dark is exactly
  // how nine items went unmentioned for up to 54 days.
  const sweep = await runStuckSweep(admin);
  base.sweptAlerts = sweep.alerted;
  if (sweep.skipped) base.sweepSkipped = sweep.skipped;

  // Env dark gate (posting only).
  if (!envFlagEnabled(process.env.DISTRIBUTION_WORKER_ENABLED)) {
    return NextResponse.json({ ...base, reason: "disabled" }, { status: 200 });
  }

  try {
    // Fresh, unclaimed concierge candidates (the only worker-eligible state).
    const { data: candData, error: candErr } = await admin
      .from("distribution_run_items")
      .select(
        "id, organization_id, run_id, channel, publish_status, mode, transport, concierge_claimed_by, attempt_count",
      )
      .eq("mode", "concierge")
      .eq("publish_status", "queued")
      .is("concierge_claimed_by", null)
      .or("transport.is.null,transport.neq.takedown")
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
        transport: c.transport,
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

    // Resolve the property via the run. distribution_run_items has no property_id
    // column; it lives on distribution_runs (same pattern as the freshness cron).
    // Done BEFORE the claim so a missing property never leaves a stuck claim.
    const { data: runRow } = await admin
      .from("distribution_runs")
      .select("property_id")
      .eq("id", job.run_id)
      .maybeSingle();
    const propertyId = (runRow?.property_id as string | null) ?? null;
    if (!propertyId) {
      return NextResponse.json({ ...summary, skippedReason: "run_property_missing" }, { status: 200 });
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
      .eq("id", propertyId)
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
    const { data: attemptRow, error: attemptErr } = await admin
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
      .maybeSingle();
    if (attemptErr || !attemptRow) {
      await releaseWorkerClaim(
        admin,
        job.id,
        "Posting worker could not record its audit attempt; the item is queued for retry.",
      );
      return NextResponse.json(
        {
          ...summary,
          skippedReason: attemptErr?.message ?? "attempt_log_failed",
          details: [
            ...summary.details,
            { reason: "attempt_log_failed", itemId: job.id },
          ],
        },
        { status: 200 },
      );
    }

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
        last_attempt_id: attemptRow.id,
        attempt_count: attempt.attempt_no,
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
      .select("id, name, brand_color, logo_url, mail_alias, reply_to_email, public_contact_email")
      .eq("id", job.organization_id)
      .maybeSingle();
    if (org) {
      const dashboardUrl = `${APP_URL}/dashboard/properties/${propertyId}#distribute-header`;
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
