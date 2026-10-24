import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendNotificationEmail } from "@/lib/email";
import { adminEmails } from "@/lib/provisioning-server";
import { canUseRobotPosting } from "@/lib/billing";
import { nodeHasBrotliFix } from "@/lib/image-url-import";
import {
  DIGEST_LOCAL_HOUR,
  buildHealthDigest,
  portalOutcomeIsProblem,
  torontoDateHour,
  type EmailProblem,
  type HealthInput,
} from "@/lib/health-digest";

// S720: the daily health email to Noam (lib/health-digest.ts says why).
// Called every 15 minutes by /api/cron/sweep-all; sends once a day, the first
// run at or after 8 AM Toronto, by claiming today's platform_digest_runs row.
//   ?dry=1    gather and return the email, send nothing, claim nothing
//   ?force=1  send now even if today's email went (does not claim)

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const DAY_MS = 86_400_000;
const BREVO_EVENTS = ["hardBounces", "softBounces", "blocked", "invalid", "error", "spam"] as const;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  return req.nextUrl.searchParams.get("secret") === secret;
}

async function brevoProblems(): Promise<HealthInput["emails"]> {
  const key = process.env.BREVO_API_KEY;
  if (!key) return { checked: false, note: "no Brevo key", problems: [] };
  const problems: EmailProblem[] = [];
  try {
    const lists = await Promise.all(
      BREVO_EVENTS.map(async (event) => {
        const url = `https://api.brevo.com/v3/smtp/statistics/events?limit=100&days=1&event=${event}`;
        const res = await fetch(url, {
          headers: { "api-key": key, accept: "application/json" },
          cache: "no-store",
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) throw new Error(`brevo ${event} ${res.status}`);
        const json = (await res.json()) as {
          events?: { email?: string; subject?: string; reason?: string; event?: string }[];
        };
        return (json.events ?? []).map((e) => ({
          event: event as string,
          email: e.email ?? "(unknown)",
          subject: e.subject ?? null,
          reason: e.reason ?? null,
        }));
      }),
    );
    for (const l of lists) problems.push(...l);
    return { checked: true, problems };
  } catch (err) {
    return {
      checked: false,
      note: err instanceof Error ? err.message : "Brevo did not answer",
      problems,
    };
  }
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ ok: false, reason: "service_role_not_configured" });

  const dry = req.nextUrl.searchParams.get("dry") === "1";
  const force = req.nextUrl.searchParams.get("force") === "1";
  const now = new Date();
  const local = torontoDateHour(now);
  if (!dry && !force && local.hour < DIGEST_LOCAL_HOUR) {
    return NextResponse.json({ ok: true, sent: 0, reason: "before_send_hour" });
  }
  if (!dry && !force) {
    const { data: already } = await admin
      .from("platform_digest_runs")
      .select("sent_on")
      .eq("digest", "health")
      .eq("sent_on", local.date)
      .maybeSingle();
    if (already) return NextResponse.json({ ok: true, sent: 0, reason: "already_sent_today" });
  }

  const since = new Date(now.getTime() - DAY_MS).toISOString();
  const { data: orgRows } = await admin
    .from("organizations")
    .select("id, name, plan, posting_addon_active");
  const orgs = new Map<string, { name: string; robot: boolean }>();
  for (const o of (orgRows ?? []) as {
    id: string;
    name: string | null;
    plan: string | null;
    posting_addon_active: boolean | null;
  }[]) {
    orgs.set(o.id, { name: o.name ?? "Unnamed account", robot: canUseRobotPosting(o) });
  }
  const orgName = (id: string | null) => (id && orgs.get(id)?.name) || "Unknown account";

  const [sweepsRes, lastSweepRes, portalRes, notesRes, robotRes, sessionRes, emails] =
    await Promise.all([
      admin.from("sweep_runs").select("ran_at, ok, ran, failed, details").gte("ran_at", since),
      admin.from("sweep_runs").select("ran_at").order("ran_at", { ascending: false }).limit(1).maybeSingle(),
      admin.from("inbound_portal_events").select("organization_id, outcome").gte("received_at", since),
      admin
        .from("leads")
        .select("organization_id, name, notes")
        .gte("created_at", since)
        .ilike("notes", "%Parser notes:%"),
      admin
        .from("distribution_run_items")
        .select("organization_id, channel, publish_status, error_code, error_message")
        .gte("updated_at", since)
        .or("publish_status.in.(rejected,blocked,needs_login,needs_payment),error_code.not.is.null"),
      admin
        .from("distribution_channel_session_status")
        .select("organization_id, channel, alive, last_check_code")
        .eq("alive", false),
      brevoProblems(),
    ]);

  const portalCounts = new Map<string, { org: string; outcome: string; count: number }>();
  for (const e of (portalRes.data ?? []) as { organization_id: string | null; outcome: string }[]) {
    if (!portalOutcomeIsProblem(e.outcome)) continue;
    const k = `${e.organization_id}|${e.outcome}`;
    const cur = portalCounts.get(k) ?? { org: orgName(e.organization_id), outcome: e.outcome, count: 0 };
    cur.count++;
    portalCounts.set(k, cur);
  }

  const input: HealthInput = {
    now,
    sweeps: (sweepsRes.data ?? []) as HealthInput["sweeps"],
    lastSweepAt: (lastSweepRes.data as { ran_at: string } | null)?.ran_at ?? null,
    emails,
    portal: [...portalCounts.values()],
    parserNotes: ((notesRes.data ?? []) as { organization_id: string; name: string | null; notes: string }[]).map(
      (l) => ({ org: orgName(l.organization_id), name: l.name, notes: l.notes }),
    ),
    robot: (
      (robotRes.data ?? []) as {
        organization_id: string;
        channel: string;
        publish_status: string | null;
        error_code: string | null;
        error_message: string | null;
      }[]
    )
      // S729: closed_stale is the run-item closer (S728) tidying a dead job on
      // purpose, not a failure. Its first run closed 26 old items and filled
      // the 2026-10-21 digest with 26 false "problems".
      .filter((r) => r.error_code !== "closed_stale")
      .map((r) => ({
      org: orgName(r.organization_id),
      channel: r.channel,
      status: r.publish_status ?? r.error_code,
      error: r.error_message ?? (r.publish_status ? r.error_code : null),
    })),
    // Only accounts that can robot-post (Agile, or the Posting add-on): a test
    // account's dead sign-in is not a problem anyone has to fix.
    signIns: (
      (sessionRes.data ?? []) as { organization_id: string; channel: string; last_check_code: string | null }[]
    )
      .filter((s) => orgs.get(s.organization_id)?.robot)
      .map((s) => ({ org: orgName(s.organization_id), channel: s.channel, code: s.last_check_code })),
  };

  const email = buildHealthDigest({ ...input, serverNode: { version: process.version, fixed: nodeHasBrotliFix(process.version) } });
  if (dry) return NextResponse.json({ ok: true, dry: true, ...email });
  // This route runs inside a sweep, which logs itself only when it finishes.
  // Right after the log table appeared there is no line yet; wait one tick
  // rather than send a false "never ran".
  if (!force && !input.lastSweepAt) {
    return NextResponse.json({ ok: true, sent: 0, reason: "waiting_for_first_sweep_log" });
  }

  if (!force) {
    // Claim today. A second run in the same tick loses the insert and stops.
    const { error: claimErr } = await admin
      .from("platform_digest_runs")
      .insert({ digest: "health", sent_on: local.date });
    if (claimErr) return NextResponse.json({ ok: true, sent: 0, reason: "already_sent_today" });
  }

  const recipients = adminEmails();
  const to = recipients.length > 0 ? recipients : ["hello@vacantless.com"];
  let sent = 0;
  const errors: string[] = [];
  for (const addr of to) {
    const r = await sendNotificationEmail({
      to_email: addr,
      subject: email.subject,
      body: email.body,
      org_name: "Vacantless",
      brand_color: null,
      logo_url: null,
      reply_to_email: null,
    });
    if (r.sent) sent++;
    else errors.push(`${addr}:${r.reason}`);
  }
  return NextResponse.json({ ok: errors.length === 0, sent, problems: email.problems, errors });
}
