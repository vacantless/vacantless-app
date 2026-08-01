import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMessageChannel } from "@/lib/tenant-comms";
import { dispatchTenantMessage } from "@/lib/tenant-comms-dispatch";
import { tenantCommsOutboxEnabled } from "@/lib/tenant-comms-schedule";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const LIMIT = 50;

type ScheduledTenantMessageRow = {
  id: string;
  organization_id: string;
  tenancy_id: string;
  channel: string;
  subject: string | null;
  body: string;
  recipient_ids: string[] | null;
  scheduled_send_at: string;
  created_by: string | null;
  attempts: number | null;
};

type OrgRow = {
  id: string;
  name: string | null;
  plan: string;
  sms_enabled: boolean | null;
  brand_color: string | null;
  logo_url: string | null;
  reply_to_email: string | null;
  public_contact_email: string | null;
  public_contact_phone: string | null;
};

type Summary = {
  ok: boolean;
  reason?: string;
  skipped?: string;
  scanned: number;
  claimed: number;
  sent: number;
  failed: number;
  noone: number;
  dry: boolean;
  details: Array<Record<string, unknown>>;
};

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  return req.nextUrl.searchParams.get("secret") === secret;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000);
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  if (!tenantCommsOutboxEnabled()) {
    return NextResponse.json({ ok: true, skipped: "disabled" });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { ok: false, reason: "service_role_not_configured", scanned: 0, claimed: 0, sent: 0, failed: 0, noone: 0, dry: false, details: [] } satisfies Summary,
      { status: 200 },
    );
  }

  const params = req.nextUrl.searchParams;
  const dry = params.get("dry") === "1";
  const force = params.get("force") === "1";
  const onlyOrg = params.get("org");
  const nowIso = new Date().toISOString();

  let query = admin
    .from("scheduled_tenant_messages")
    .select(
      "id, organization_id, tenancy_id, channel, subject, body, recipient_ids, scheduled_send_at, created_by, attempts",
    )
    .eq("status", "scheduled")
    .order("scheduled_send_at", { ascending: true })
    .limit(LIMIT);
  if (!force) query = query.lte("scheduled_send_at", nowIso);
  if (onlyOrg) query = query.eq("organization_id", onlyOrg);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { ok: false, reason: `query_error:${error.message}`, scanned: 0, claimed: 0, sent: 0, failed: 1, noone: 0, dry, details: [] } satisfies Summary,
      { status: 200 },
    );
  }

  const rows = (data ?? []) as ScheduledTenantMessageRow[];
  const summary: Summary = {
    ok: true,
    scanned: rows.length,
    claimed: 0,
    sent: 0,
    failed: 0,
    noone: 0,
    dry,
    details: [],
  };

  if (dry) {
    summary.details = rows.map((row) => ({
      id: row.id,
      organization_id: row.organization_id,
      tenancy_id: row.tenancy_id,
      channel: row.channel,
      scheduled_send_at: row.scheduled_send_at,
      recipients: row.recipient_ids?.length ?? 0,
    }));
    return NextResponse.json(summary);
  }

  for (const row of rows) {
    const { data: claimed, error: claimError } = await admin
      .from("scheduled_tenant_messages")
      .update({ status: "sending" })
      .eq("id", row.id)
      .eq("organization_id", row.organization_id)
      .eq("status", "scheduled")
      .select(
        "id, organization_id, tenancy_id, channel, subject, body, recipient_ids, scheduled_send_at, created_by, attempts",
      )
      .maybeSingle();

    if (claimError) {
      summary.failed++;
      summary.details.push({ id: row.id, outcome: "claim_error", error: claimError.message });
      continue;
    }

    const claimedRow = claimed as ScheduledTenantMessageRow | null;
    if (!claimedRow) {
      summary.details.push({ id: row.id, outcome: "already_claimed" });
      continue;
    }
    summary.claimed++;

    try {
      if (!isMessageChannel(claimedRow.channel)) throw new Error("bad_channel");

      const { data: orgData, error: orgError } = await admin
        .from("organizations")
        .select(
          "id, name, plan, sms_enabled, brand_color, logo_url, reply_to_email, public_contact_email, public_contact_phone",
        )
        .eq("id", claimedRow.organization_id)
        .maybeSingle();
      if (orgError || !orgData) throw new Error(orgError?.message ?? "org_not_found");

      const org = orgData as OrgRow;
      const result = await dispatchTenantMessage({
        supabase: admin,
        org,
        tenancyId: claimedRow.tenancy_id,
        channel: claimedRow.channel,
        subject: claimedRow.subject,
        body: claimedRow.body,
        recipientIds: claimedRow.recipient_ids ?? [],
        sentBy: claimedRow.created_by,
      });
      if (!result.ok) throw new Error("dispatch_failed");

      await admin
        .from("scheduled_tenant_messages")
        .update({
          status: "sent",
          sent_message_id: result.messageId,
          dispatched_at: new Date().toISOString(),
          error: null,
        })
        .eq("id", claimedRow.id)
        .eq("organization_id", claimedRow.organization_id);

      const outcome = result.sent > 0 ? "sent" : result.failed > 0 ? "failed" : "noone";
      if (outcome === "sent") summary.sent++;
      else if (outcome === "failed") summary.failed++;
      else summary.noone++;
      summary.details.push({
        id: claimedRow.id,
        outcome,
        message_id: result.messageId,
        sent: result.sent,
        failed: result.failed,
        skipped: result.skipped,
      });
    } catch (dispatchError) {
      await admin
        .from("scheduled_tenant_messages")
        .update({
          status: "failed",
          error: errorText(dispatchError),
          attempts: (claimedRow.attempts ?? 0) + 1,
        })
        .eq("id", claimedRow.id)
        .eq("organization_id", claimedRow.organization_id);
      summary.failed++;
      summary.details.push({
        id: claimedRow.id,
        outcome: "failed",
        error: errorText(dispatchError),
      });
    }
  }

  return NextResponse.json(summary);
}
