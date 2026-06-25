import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendOrgNotification } from "@/lib/notifications-server";
import {
  getNotificationEvent,
  isEventEnabled,
  renderNotification,
  resolveNotificationRecipients,
  type NotificationSettingRow,
} from "@/lib/notifications";
import { resolveLeadNotifyEmails } from "@/lib/leads-notify";
import type { NotifyMember } from "@/lib/incident-reports";
import {
  snapshotWindow,
  shouldSendSnapshot,
  buildSnapshotBlock,
  snapshotCounts,
  snapshotHasContent,
  snapshotDateLabel,
  SNAPSHOT_NUDGE_STATUSES,
  type SnapshotLead,
  type SnapshotShowing,
  type SnapshotBuckets,
} from "@/lib/leasing-snapshot";

// Daily leasing-snapshot sweep — the scheduled digest that RETIRES Agile's old
// daily Zap (365197456). One email per weekday, at the org's start-of-shift
// hour, summarizing four buckets (new leads 24h / showings today / showings
// later this week / came-in-no-showing). Rides the notification substrate
// (lib/notifications*) for copy/recipients/on-off + branding; the bucket math +
// formatting are pure (lib/leasing-snapshot.ts).
//
// Cadence + idempotency mirror the reminder/nurture/feedback sweeps: pinged
// every 15 min by the shared GitHub Actions schedule, each org self-gates to
// exactly once per weekday via shouldSendSnapshot + the
// organizations.leasing_snapshot_last_sent_on stamp. Fire-on-data: an org whose
// snapshot is empty gets NO email (we still stamp the day so it stops checking).
//
// Auth: CRON_SECRET (Bearer or ?secret=). Test affordances (CRON_SECRET-gated):
//   ?org=<id>   limit the sweep to one org
//   ?force=1    bypass the weekday/hour/already-sent gate (still sends + stamps)
//   ?dry=1      build + return the rendered digest WITHOUT sending or stamping
//
// Reads leads/showings across all orgs via the service-role client (RLS hides
// them from anon/user sessions); see lib/supabase/admin.ts.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://vacantless-app.vercel.app";
const MAX_RECIPIENTS = 10;
const EVENT_KEY = "leasing.daily_snapshot";

type Summary = {
  ok: boolean;
  reason?: string;
  scanned: number;
  sent: number;
  skipped: number;
  errors: number;
  details: Array<Record<string, unknown>>;
};

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // not configured → refuse
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  return req.nextUrl.searchParams.get("secret") === secret;
}

function one<T>(rel: T | T[] | null | undefined): T | null {
  if (Array.isArray(rel)) return rel[0] ?? null;
  return (rel as T) ?? null;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { ok: false, reason: "service_role_not_configured", scanned: 0, sent: 0, skipped: 0, errors: 0, details: [] } satisfies Summary,
      { status: 200 },
    );
  }

  const params = req.nextUrl.searchParams;
  const force = params.get("force") === "1";
  const dry = params.get("dry") === "1";
  const onlyOrg = params.get("org");

  const event = getNotificationEvent(EVENT_KEY);
  if (!event) {
    return NextResponse.json(
      { ok: false, reason: "event_not_registered", scanned: 0, sent: 0, skipped: 0, errors: 1, details: [] } satisfies Summary,
      { status: 200 },
    );
  }

  let orgQuery = admin
    .from("organizations")
    .select(
      "id, name, brand_color, logo_url, reply_to_email, public_contact_email, " +
        "booking_timezone, leasing_snapshot_hour, leasing_snapshot_last_sent_on",
    );
  if (onlyOrg) orgQuery = orgQuery.eq("id", onlyOrg);
  const { data: orgs, error: orgErr } = await orgQuery;

  if (orgErr) {
    return NextResponse.json(
      { ok: false, reason: `org_query_error:${orgErr.message}`, scanned: 0, sent: 0, skipped: 0, errors: 1, details: [] } satisfies Summary,
      { status: 200 },
    );
  }

  const nowMs = Date.now();
  const summary: Summary = { ok: true, scanned: (orgs ?? []).length, sent: 0, skipped: 0, errors: 0, details: [] };

  for (const org of (orgs ?? []) as any[]) {
    // Per-org isolation: one org's thrown error must not abort the sweep.
    try {
      const tz: string = org.booking_timezone || "America/Toronto";
      const snapshotHour: number =
        typeof org.leasing_snapshot_hour === "number" ? org.leasing_snapshot_hour : 16;

      // --- Time gate (skipped for force/dry) -------------------------------
      const gate = shouldSendSnapshot({
        nowMs,
        tz,
        snapshotHour,
        lastSentOn: org.leasing_snapshot_last_sent_on ?? null,
      });
      if (!force && !dry && !gate.send) {
        summary.skipped++;
        summary.details.push({ org: org.id, skipped: gate.reason });
        continue;
      }

      const win = snapshotWindow(nowMs, tz);

      // --- Bucket 1: new leads in the last 24h -----------------------------
      const { data: newRows } = await admin
        .from("leads")
        .select("id, name, phone, move_in, source, created_at, properties(address)")
        .eq("organization_id", org.id)
        .gt("created_at", win.cutoff24hIso)
        .order("created_at", { ascending: true });
      const newLeads: SnapshotLead[] = (newRows ?? []).map((r: any) => ({
        name: r.name,
        phone: r.phone,
        move_in: r.move_in,
        source: r.source,
        property_address: one<any>(r.properties)?.address ?? null,
        created_at: r.created_at,
      }));

      // --- Buckets 2 & 3: scheduled showings today / later this week -------
      const { data: showRows } = await admin
        .from("showings")
        .select("scheduled_at, leads(name, phone), properties(address)")
        .eq("organization_id", org.id)
        .eq("outcome", "scheduled")
        .gte("scheduled_at", win.startTodayIso)
        .lt("scheduled_at", win.endWeekIso)
        .order("scheduled_at", { ascending: true });
      const showingsToday: SnapshotShowing[] = [];
      const showingsWeek: SnapshotShowing[] = [];
      for (const s of (showRows ?? []) as any[]) {
        const row: SnapshotShowing = {
          name: one<any>(s.leads)?.name ?? null,
          phone: one<any>(s.leads)?.phone ?? null,
          scheduled_at: s.scheduled_at,
          property_address: one<any>(s.properties)?.address ?? null,
        };
        if (s.scheduled_at && s.scheduled_at < win.endTodayIso) showingsToday.push(row);
        else showingsWeek.push(row);
      }

      // --- Bucket 4: came in 1–7d ago, early stage, no booked showing ------
      // Lead ids that have an upcoming scheduled showing (to exclude).
      const { data: futureShow } = await admin
        .from("showings")
        .select("lead_id")
        .eq("organization_id", org.id)
        .eq("outcome", "scheduled")
        .gte("scheduled_at", win.startTodayIso);
      const bookedLeadIds = new Set(
        (futureShow ?? []).map((r: any) => r.lead_id).filter(Boolean),
      );
      const { data: nudgeRows } = await admin
        .from("leads")
        .select("id, name, phone, move_in, source, created_at, properties(address)")
        .eq("organization_id", org.id)
        .gt("created_at", win.cutoff7dIso)
        .lte("created_at", win.cutoff24hIso)
        .in("status", SNAPSHOT_NUDGE_STATUSES as unknown as string[])
        .order("created_at", { ascending: true });
      const noShowing: SnapshotLead[] = (nudgeRows ?? [])
        .filter((r: any) => !bookedLeadIds.has(r.id))
        .map((r: any) => ({
          name: r.name,
          phone: r.phone,
          move_in: r.move_in,
          source: r.source,
          property_address: one<any>(r.properties)?.address ?? null,
          created_at: r.created_at,
        }));

      const buckets: SnapshotBuckets = { newLeads, showingsToday, showingsWeek, noShowing };
      const counts = snapshotCounts(buckets);

      // Fire-on-data: a quiet day sends nothing. In normal mode we still stamp
      // so we don't recompute every 15 min for the rest of the day. force/dry
      // bypass the empty gate so a test can always see the result.
      if (!snapshotHasContent(buckets) && !force && !dry) {
        await admin
          .from("organizations")
          .update({ leasing_snapshot_last_sent_on: gate.localDate })
          .eq("id", org.id);
        summary.skipped++;
        summary.details.push({ org: org.id, skipped: "empty", stamped: gate.localDate });
        continue;
      }

      const snapshotBlock = buildSnapshotBlock(buckets, tz);
      const vars: Record<string, string> = {
        org_name: org.name ?? "",
        property_address: "",
        snapshot_date: snapshotDateLabel(nowMs, tz),
        new_count: String(counts.newCount),
        showings_today_count: String(counts.showingsTodayCount),
        snapshot: snapshotBlock,
        dashboard_url: `${APP_URL}/dashboard/leads`,
      };

      // Operator fallback recipients: members who manage leads, else the org's
      // reply-to / public contact (same resolver as the new-lead alert).
      const { data: memberRows } = await admin
        .from("memberships")
        .select("user_id, role")
        .eq("organization_id", org.id);
      const members: NotifyMember[] = [];
      for (const m of (memberRows ?? []) as { user_id: string; role: string }[]) {
        const { data: u } = await admin.auth.admin.getUserById(m.user_id);
        members.push({ role: m.role, email: u?.user?.email ?? null });
      }
      const operatorFallback = resolveLeadNotifyEmails(members, [
        org.reply_to_email,
        org.public_contact_email,
      ]).slice(0, MAX_RECIPIENTS);

      // --- Dry run: render + report, never send, never stamp ---------------
      if (dry) {
        const { data: settingRow } = await admin
          .from("notification_settings")
          .select("event_key, enabled, subject_template, body_template, recipients, accent_color")
          .eq("organization_id", org.id)
          .eq("event_key", EVENT_KEY)
          .maybeSingle();
        const setting = (settingRow as NotificationSettingRow | null) ?? null;
        const rendered = renderNotification(event, setting, vars);
        const recipients = resolveNotificationRecipients({
          audience: event.audience,
          configured: setting?.recipients ?? [],
          operatorFallback,
        });
        summary.details.push({
          org: org.id,
          dry: true,
          enabled: isEventEnabled(setting),
          counts,
          recipients,
          subject: rendered.subject,
          body: rendered.body,
        });
        summary.sent++; // "would send"
        continue;
      }

      // --- Real send via the substrate, then stamp the day -----------------
      await sendOrgNotification({
        client: admin,
        org: {
          id: org.id,
          name: org.name,
          brand_color: org.brand_color,
          logo_url: org.logo_url,
          reply_to_email: org.reply_to_email,
        },
        eventKey: EVENT_KEY,
        vars,
        operatorFallback,
        action: { label: "Open your pipeline", url: `${APP_URL}/dashboard/leads` },
      });

      // Stamp regardless of whether the event was enabled/had recipients — the
      // substrate short-circuits a disabled event, and we don't want to retry
      // the build all day. (force keeps the existing stamp date semantics.)
      await admin
        .from("organizations")
        .update({ leasing_snapshot_last_sent_on: gate.localDate })
        .eq("id", org.id);

      summary.sent++;
      summary.details.push({ org: org.id, sent: true, counts, stamped: gate.localDate });
    } catch (err) {
      summary.errors++;
      summary.details.push({
        org: (org as any)?.id,
        error: `org_threw:${err instanceof Error ? err.message : "unknown"}`,
      });
    }
  }

  return NextResponse.json(summary, { status: 200 });
}
