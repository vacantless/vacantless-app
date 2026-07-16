import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendOrgNotification } from "@/lib/notifications-server";
import {
  getNotificationEvent,
  isDripEnqueueEnabled,
  renderNotification,
  resolveNotificationRecipients,
  type NotificationSettingRow,
} from "@/lib/notifications";
import { resolveLeadNotifyEmails } from "@/lib/leads-notify";
import type { NotifyMember } from "@/lib/incident-reports";
import { localDateString } from "@/lib/leasing-snapshot";
import {
  reminderAnchor,
  dueStatus,
  inspectionTypeLabel,
  INSPECTION_URGENCY,
  INSPECTION_LEAD_DAYS,
} from "@/lib/property-inspections";
import { decideInspectionNudge } from "@/lib/property-inspections-sweep";

// Per-tenancy property-inspection reminder sweep (S385) — the tenancy-scoped
// sibling of the lease-violation follow-up reminder (violation-followup). Each
// SCHEDULED inspection logged in tenancy_inspections (0094) that carries a
// planned date (scheduled_for) drives a reminder; when it enters its lead window
// (default 7 days) or passes the date, the operator gets ONE email per TENANCY
// listing every scheduled inspection on that tenancy that's approaching or
// overdue, so they can give the tenant the required written notice and book it
// before the date slips.
//
// Anchored to each inspection's planned date, this rides the rent-increase-style
// per-record sweep (NOT the seasonal compliance calendar). Copy/recipients/
// on-off + branding ride the notification substrate, exactly like every other
// event. Each inspection self-gates to ONCE per date via the stable
// tenancy_inspections.reminder_nudged_for stamp (the scheduled_for date — see
// property-inspections-sweep.ts); editing the date (or rescheduling) re-arms it.
//
// SHIP DARK: opt-in per org (isDripEnqueueEnabled) — nothing fires until the org
// turns the "Property inspection due" event on in Automations & Templates.
//
// Auth: CRON_SECRET (Bearer or ?secret=). Test affordances (CRON_SECRET-gated):
//   ?org=<id>   limit the sweep to one org
//   ?force=1    bypass the already-nudged gate (still sends + stamps)
//   ?dry=1      build + return the rendered reminders WITHOUT sending or stamping
//
// Reads tenancy_inspections across all orgs via the service-role client (RLS
// hides them from anon/user sessions); see lib/supabase/admin.ts.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://vacantless-app.vercel.app";
const MAX_RECIPIENTS = 10;
const EVENT_KEY = "leasing.landlord_inspection_due";

type Summary = {
  ok: boolean;
  reason?: string;
  scanned: number; // orgs scanned
  sent: number; // tenancy reminders sent (or "would send" in dry mode)
  skipped: number; // orgs/inspections not actionable / opt-out / already nudged
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

type InspectionRow = {
  id: string;
  tenancy_id: string | null;
  inspection_type: string | null;
  scheduled_for: string | null;
  status: string | null;
  reminder_nudged_for: string | null;
  tenancy: {
    id: string;
    property: { address: string | null } | null;
    tenants: { name: string | null; is_primary: boolean | null }[] | null;
  } | null;
};

type Actionable = {
  row: InspectionRow;
  scheduledFor: string;
  status: "approaching" | "overdue";
  stampFor: string | null; // non-null only when this inspection should be (re)stamped
};

/** One human line for the email's {{inspection_list}} token. */
function inspectionLine(a: Actionable): string {
  const r = a.row;
  const type = inspectionTypeLabel(r.inspection_type);
  const state = a.status === "overdue" ? "OVERDUE" : "date approaching";
  return `- ${type} — planned for ${a.scheduledFor} (${state})`;
}

/** The primary tenant's name (fallback: first named tenant), for the copy. */
function tenantName(t: InspectionRow["tenancy"]): string {
  const tenants = t?.tenants ?? [];
  const primary = tenants.find((x) => x.is_primary && (x.name ?? "").trim());
  const named = tenants.find((x) => (x.name ?? "").trim());
  return (primary?.name ?? named?.name ?? "").trim() || "your tenant";
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
      "id, name, brand_color, logo_url, reply_to_email, public_contact_email, booking_timezone",
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
      const today = localDateString(nowMs, tz);

      // Opt-in gate (ship dark): only sweep orgs that have explicitly turned the
      // event on. Absent row => isDripEnqueueEnabled false => skip. Fetched here
      // so a quiet/opt-out org costs one cheap read, not an inspection scan.
      const { data: settingRow } = await admin
        .from("notification_settings")
        .select("event_key, enabled, subject_template, body_template, recipients, accent_color")
        .eq("organization_id", org.id)
        .eq("event_key", EVENT_KEY)
        .maybeSingle();
      const setting = (settingRow as NotificationSettingRow | null) ?? null;
      if (!isDripEnqueueEnabled(setting)) {
        summary.skipped++;
        continue;
      }

      // All inspections for the org (RLS bypassed via the admin client; we filter
      // by org explicitly). Joined to the tenancy for the unit address + tenant
      // name + grouping. The status math drops non-scheduled / no-date rows.
      const { data: inspRows } = await admin
        .from("tenancy_inspections")
        .select(
          "id, tenancy_id, inspection_type, scheduled_for, status, reminder_nudged_for, " +
            "tenancy:tenancies(id, property:properties(address), tenants(name, is_primary))",
        )
        .eq("organization_id", org.id);

      // Group actionable inspections by tenancy; track which ones to (re)stamp.
      const byTenancy = new Map<
        string,
        { address: string; tenant: string; items: Actionable[] }
      >();
      for (const raw of (inspRows ?? []) as any[]) {
        const r = raw as InspectionRow;
        if (!r.tenancy_id) continue;
        // reminderAnchor returns null unless the record is SCHEDULED with a date.
        const scheduledFor = reminderAnchor({ status: r.status, scheduled_for: r.scheduled_for });
        const status = dueStatus(scheduledFor, today, INSPECTION_LEAD_DAYS);
        if (status !== "approaching" && status !== "overdue") continue; // not actionable
        const decision = decideInspectionNudge({
          scheduledFor,
          status,
          lastNudgedFor: r.reminder_nudged_for ?? null,
          force,
        });
        const ten = r.tenancy ?? null;
        const prop = one<{ address: string | null }>((ten as any)?.property);
        const address = prop?.address?.trim() || "your rental unit";
        const tenant = tenantName(ten);
        const bucket =
          byTenancy.get(r.tenancy_id) ?? { address, tenant, items: [] };
        bucket.items.push({
          row: r,
          scheduledFor: scheduledFor!, // non-null: approaching/overdue implies a real date
          status,
          stampFor: decision.nudge ? decision.stampFor : null,
        });
        byTenancy.set(r.tenancy_id, bucket);
      }

      // A tenancy is emailed only when it has at least one NEWLY due inspection
      // (one with a stampFor); already-nudged-only tenancies stay silent. The
      // email still lists EVERY actionable inspection on the tenancy.
      const dueTenancies = Array.from(byTenancy.entries()).filter(([, u]) =>
        u.items.some((i) => i.stampFor != null),
      );

      if (dueTenancies.length === 0) {
        summary.details.push({ org: org.id, due_tenancies: 0 });
        continue;
      }

      // Operator fallback recipients — same resolver as the violation nudge + the
      // snapshot. Resolved once, only when a tenancy is actually due.
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

      for (const [tenancyId, group] of dueTenancies) {
        // Most-urgent first (overdue before approaching), then earliest date.
        group.items.sort(
          (a, b) =>
            (INSPECTION_URGENCY[a.status] ?? 9) - (INSPECTION_URGENCY[b.status] ?? 9) ||
            a.scheduledFor.localeCompare(b.scheduledFor),
        );
        const dashboardUrl = `${APP_URL}/dashboard/tenancies/${tenancyId}#inspections`;
        const earliestDue = group.items
          .map((i) => i.scheduledFor)
          .sort((a, b) => a.localeCompare(b))[0];
        const vars: Record<string, string> = {
          org_name: org.name ?? "",
          property_address: group.address,
          tenant_name: group.tenant,
          inspection_list: group.items.map(inspectionLine).join("\n"),
          earliest_due: earliestDue,
          dashboard_url: dashboardUrl,
        };
        const toStamp = group.items.filter((i) => i.stampFor != null);

        // --- Dry run: render + report, never send, never stamp ---------------
        if (dry) {
          const rendered = renderNotification(event, setting, vars);
          const recipients = resolveNotificationRecipients({
            audience: event.audience,
            configured: setting?.recipients ?? [],
            operatorFallback,
          });
          summary.sent++; // "would send"
          summary.details.push({
            org: org.id,
            tenancy: tenancyId,
            dry: true,
            actionable: group.items.length,
            would_stamp: toStamp.map((i) => ({ id: i.row.id, due: i.stampFor })),
            recipients,
            subject: rendered.subject,
            body: rendered.body,
          });
          continue;
        }

        // --- Real send via the substrate, then stamp each newly-due inspection -
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
          action: { label: "Review the tenancy's inspections", url: dashboardUrl },
        });

        // Stamp regardless of whether the event ultimately had recipients — the
        // substrate short-circuits a disabled event, and we don't want to rebuild
        // this nudge on every tick for the rest of the date window.
        for (const i of toStamp) {
          await admin
            .from("tenancy_inspections")
            .update({ reminder_nudged_for: i.stampFor })
            .eq("id", i.row.id);
        }

        summary.sent++;
        summary.details.push({
          org: org.id,
          tenancy: tenancyId,
          sent: true,
          actionable: group.items.length,
          stamped: toStamp.map((i) => ({ id: i.row.id, due: i.stampFor })),
        });
      }
    } catch (e: any) {
      summary.errors++;
      summary.details.push({ org: org?.id, error: String(e?.message ?? e) });
    }
  }

  return NextResponse.json(summary, { status: 200 });
}
