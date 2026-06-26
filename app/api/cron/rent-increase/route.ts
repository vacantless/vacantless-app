import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendOrgNotification } from "@/lib/notifications-server";
import {
  getNotificationEvent,
  isEventEnabled,
  isDripEnqueueEnabled,
  firstWord,
  renderNotification,
  resolveNotificationRecipients,
  type NotificationSettingRow,
} from "@/lib/notifications";
import { resolveLeadNotifyEmails } from "@/lib/leads-notify";
import type { NotifyMember } from "@/lib/incident-reports";
import { localDateString } from "@/lib/leasing-snapshot";
import { deriveRentIncrease } from "@/lib/rent-increase";
import { formatRentCents } from "@/lib/tenancy";
import {
  decideRentIncreaseNudge,
  RENT_INCREASE_URGENCY,
} from "@/lib/rent-increase-sweep";
import { tenantNoticeDedupeKey } from "@/lib/tenant-message-approvals";

// Rent-increase reminder sweep — the proactive "autopilot" half of the free
// compliance wedge (S339). The calc core (lib/rent-increase.ts) + pre-filled N1
// (lib/n1-render.ts) shipped S282/S284 and already power the per-tenancy card +
// the Overview rollup; what was missing is anyone TELLING the operator in time.
// This sweep emails one reminder per tenancy that has entered the actionable
// band (serve_window / serve_late / overdue), so the N1 never gets served late.
//
// Rides the notification substrate (lib/notifications*) for copy/recipients/
// on-off + branding, exactly like leasing.daily_snapshot. Cadence + idempotency
// mirror the other sweeps: pinged every 15 min by the shared GitHub Actions
// schedule; each tenancy self-gates to ONCE per increase cycle via the stable
// tenancies.rent_increase_nudged_for stamp (the earliest-effective anniversary
// date — see lib/rent-increase-sweep.ts). Recording an increase rolls the
// anniversary forward and re-arms the next cycle automatically.
//
// Auth: CRON_SECRET (Bearer or ?secret=). Test affordances (CRON_SECRET-gated):
//   ?org=<id>   limit the sweep to one org
//   ?force=1    bypass the already-nudged gate (still sends + stamps)
//   ?dry=1      build + return the rendered reminders WITHOUT sending or stamping
//
// Reads tenancies/tenants across all orgs via the service-role client (RLS hides
// them from anon/user sessions); see lib/supabase/admin.ts.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://vacantless-app.vercel.app";
const MAX_RECIPIENTS = 10;
const EVENT_KEY = "leasing.rent_increase";
// The SOFT, approve-to-send companion drafted alongside the landlord N1 nudge
// (S341). Opt-in per org; never sent from here — only queued for operator review.
const TENANT_NOTICE_EVENT_KEY = "leasing.rent_increase_tenant_notice";

type Summary = {
  ok: boolean;
  reason?: string;
  scanned: number; // orgs scanned
  sent: number; // reminders sent (or "would send" in dry mode)
  skipped: number; // tenancies not actionable / already nudged
  enqueued: number; // soft tenant-notice drafts queued (or "would queue" in dry)
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

type TenancyRow = {
  id: string;
  status: string;
  rent_cents: number | null;
  start_date: string | null;
  last_rent_increase_date: string | null;
  rent_increase_nudged_for: string | null;
  property_id: string | null;
  property: { address: string | null; rent_control_exempt: boolean | null } | null;
  tenants: { name: string | null; email: string | null; is_primary: boolean | null }[] | null;
};

/** Primary tenant first, then co-tenants; drop the unnamed. Mirrors n1/route.ts. */
function tenantNamesOf(t: TenancyRow): string[] {
  return (t.tenants ?? [])
    .slice()
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
    .map((x) => (x.name ?? "").trim())
    .filter((n) => n.length > 0);
}

/** The primary tenant (is_primary first, else the first listed) — its name+email
 *  is the address for the soft approve-to-send courtesy draft. */
function primaryTenantOf(t: TenancyRow): { name: string | null; email: string | null } | null {
  const list = (t.tenants ?? []).slice().sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
  return list[0] ?? null;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { ok: false, reason: "service_role_not_configured", scanned: 0, sent: 0, skipped: 0, enqueued: 0, errors: 0, details: [] } satisfies Summary,
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
      { ok: false, reason: "event_not_registered", scanned: 0, sent: 0, skipped: 0, enqueued: 0, errors: 1, details: [] } satisfies Summary,
      { status: 200 },
    );
  }
  // The soft tenant-notice companion event (approve-to-send). Absent => skip the
  // drip entirely (it just won't draft); the landlord nudge is unaffected.
  const tenantNoticeEvent = getNotificationEvent(TENANT_NOTICE_EVENT_KEY);

  let orgQuery = admin
    .from("organizations")
    .select(
      "id, name, brand_color, logo_url, reply_to_email, public_contact_email, booking_timezone",
    );
  if (onlyOrg) orgQuery = orgQuery.eq("id", onlyOrg);
  const { data: orgs, error: orgErr } = await orgQuery;

  if (orgErr) {
    return NextResponse.json(
      { ok: false, reason: `org_query_error:${orgErr.message}`, scanned: 0, sent: 0, skipped: 0, enqueued: 0, errors: 1, details: [] } satisfies Summary,
      { status: 200 },
    );
  }

  const nowMs = Date.now();
  const summary: Summary = { ok: true, scanned: (orgs ?? []).length, sent: 0, skipped: 0, enqueued: 0, errors: 0, details: [] };

  for (const org of (orgs ?? []) as any[]) {
    // Per-org isolation: one org's thrown error must not abort the sweep.
    try {
      const tz: string = org.booking_timezone || "America/Toronto";
      // Anchor "today" to the org's local date so the legal date math matches the
      // card + the N1 route (Vercel server runs UTC — KI443).
      const today = localDateString(nowMs, tz);

      // Active tenancies with a rent + start date — the same gate the card uses.
      const { data: tenancyRows } = await admin
        .from("tenancies")
        .select(
          "id, status, rent_cents, start_date, last_rent_increase_date, rent_increase_nudged_for, property_id, " +
            "property:properties(address, rent_control_exempt), tenants(name, email, is_primary)",
        )
        .eq("organization_id", org.id)
        .eq("status", "active");

      const due: Array<{ t: TenancyRow; result: NonNullable<ReturnType<typeof deriveRentIncrease>>; stampFor: string }> = [];
      for (const raw of (tenancyRows ?? []) as any[]) {
        const t = raw as TenancyRow;
        if (t.rent_cents == null || !t.start_date) {
          summary.skipped++;
          continue;
        }
        const prop = one<{ address: string | null; rent_control_exempt: boolean | null }>(t.property as any);
        const result = deriveRentIncrease(
          {
            startDate: t.start_date,
            currentRentCents: t.rent_cents,
            lastIncreaseDate: t.last_rent_increase_date ?? null,
            exempt: prop?.rent_control_exempt === true,
          },
          today,
        );
        const decision = decideRentIncreaseNudge({
          result,
          lastNudgedFor: t.rent_increase_nudged_for ?? null,
          force,
        });
        if (!decision.nudge || !result || decision.stampFor == null) {
          summary.skipped++;
          continue;
        }
        // Normalize the embedded property to the flat shape tenantNamesOf/vars use.
        due.push({
          t: { ...t, property: prop },
          result,
          stampFor: decision.stampFor,
        });
      }

      if (due.length === 0) {
        summary.details.push({ org: org.id, due: 0 });
        continue;
      }

      // Most-urgent first (overdue → serve_late → serve_window), then by date.
      due.sort(
        (a, b) =>
          (RENT_INCREASE_URGENCY[a.result.status] ?? 9) -
            (RENT_INCREASE_URGENCY[b.result.status] ?? 9) ||
          a.result.earliestEffectiveDate.localeCompare(b.result.earliestEffectiveDate),
      );

      // Operator fallback recipients: members who manage leads, else the org's
      // reply-to / public contact (same resolver as the snapshot + new-lead alert).
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

      // The per-org override row (absent == defaults) — fetched once for dry-mode
      // reporting; the real send re-reads it inside sendOrgNotification.
      let setting: NotificationSettingRow | null = null;
      if (dry) {
        const { data: settingRow } = await admin
          .from("notification_settings")
          .select("event_key, enabled, subject_template, body_template, recipients, accent_color")
          .eq("organization_id", org.id)
          .eq("event_key", EVENT_KEY)
          .maybeSingle();
        setting = (settingRow as NotificationSettingRow | null) ?? null;
      }

      // The soft tenant-notice (approve-to-send) drip override. Fetched in BOTH
      // dry and real modes because the enqueue is OPT-IN (isDripEnqueueEnabled):
      // it only drafts when the org has explicitly turned this event on, so the
      // drip ships dark. Absent event / absent row => no draft.
      let tenantNoticeSetting: NotificationSettingRow | null = null;
      if (tenantNoticeEvent) {
        const { data: tnRow } = await admin
          .from("notification_settings")
          .select("event_key, enabled, subject_template, body_template, recipients, accent_color")
          .eq("organization_id", org.id)
          .eq("event_key", TENANT_NOTICE_EVENT_KEY)
          .maybeSingle();
        tenantNoticeSetting = (tnRow as NotificationSettingRow | null) ?? null;
      }
      const dripOn = tenantNoticeEvent != null && isDripEnqueueEnabled(tenantNoticeSetting);

      for (const { t, result, stampFor } of due) {
        const address = t.property?.address?.trim() || "your rental unit";
        const tenantNames = tenantNamesOf(t);
        const dashboardUrl = `${APP_URL}/dashboard/tenancies/${t.id}`;
        const vars: Record<string, string> = {
          org_name: org.name ?? "",
          property_address: address,
          tenant_names: tenantNames.join(", ") || "your tenant",
          serve_by_date: result.serveByDate,
          effective_date: result.effectiveDate,
          guideline_percent:
            result.guidelinePercent != null ? `${result.guidelinePercent}%` : "the guideline",
          current_rent: formatRentCents(result.currentRentCents),
          new_rent:
            result.newRentCents != null ? formatRentCents(result.newRentCents) : "the new amount",
          dashboard_url: dashboardUrl,
        };

        // The soft tenant-notice draft vars (shared by dry + real). Only the
        // primary tenant is addressed; the courtesy note is non-legal and uses
        // first-name + effective date, never the rent math.
        const primary = primaryTenantOf(t);
        const tenantEmail = (primary?.email ?? "").trim() || null;
        const tenantNoticeVars: Record<string, string> = {
          org_name: org.name ?? "",
          property_address: address,
          tenant_first_name: firstWord(primary?.name ?? null),
          effective_date: result.effectiveDate,
          dashboard_url: dashboardUrl,
        };
        const tenantNoticeDedupe = tenantNoticeDedupeKey(
          TENANT_NOTICE_EVENT_KEY,
          t.id,
          result.earliestEffectiveDate,
        );
        // Draft only when the drip is opt-in ON and the tenant has an address to
        // send to (a draft with nowhere to go isn't actionable).
        const willDraft = dripOn && tenantEmail != null && tenantNoticeEvent != null;

        // --- Dry run: render + report, never send, never stamp, never draft ---
        if (dry) {
          const rendered = renderNotification(event, setting, vars);
          const recipients = resolveNotificationRecipients({
            audience: event.audience,
            configured: setting?.recipients ?? [],
            operatorFallback,
          });
          const detail: Record<string, unknown> = {
            org: org.id,
            tenancy: t.id,
            dry: true,
            enabled: isEventEnabled(setting),
            status: result.status,
            stampFor,
            recipients,
            subject: rendered.subject,
            body: rendered.body,
          };
          if (willDraft) {
            const tn = renderNotification(tenantNoticeEvent!, tenantNoticeSetting, tenantNoticeVars);
            detail.tenant_notice = {
              would_enqueue: true,
              to: tenantEmail,
              dedupe_key: tenantNoticeDedupe,
              subject: tn.subject,
              body: tn.body,
            };
            summary.enqueued++; // "would enqueue"
          }
          summary.details.push(detail);
          summary.sent++; // "would send"
          continue;
        }

        // --- Real send via the substrate, then stamp the cycle ---------------
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
          action: { label: "Review & serve the N1", url: dashboardUrl },
        });

        // Stamp regardless of whether the event was enabled/had recipients — the
        // substrate short-circuits a disabled event, and we don't want to rebuild
        // this nudge every 15 min for the rest of the cycle.
        await admin
          .from("tenancies")
          .update({ rent_increase_nudged_for: stampFor })
          .eq("id", t.id);

        summary.sent++;
        const detail: Record<string, unknown> = {
          org: org.id,
          tenancy: t.id,
          sent: true,
          status: result.status,
          stamped: stampFor,
        };

        // --- Soft tenant-notice: DRAFT into the approval queue, never send ----
        // Opt-in (dripOn) + a tenant address present. Upsert on the dedupe index
        // so the 15-min pinger / a forced re-run never doubles a cycle's draft.
        // This row only reaches the tenant once an operator taps Approve & Send
        // (app/dashboard/messages). The landlord stamp above already gates this
        // to once per cycle; the unique dedupe is the belt-and-suspenders guard.
        if (willDraft) {
          const tn = renderNotification(tenantNoticeEvent!, tenantNoticeSetting, tenantNoticeVars);
          const { error: draftErr } = await admin
            .from("pending_tenant_messages")
            .upsert(
              {
                organization_id: org.id,
                event_key: TENANT_NOTICE_EVENT_KEY,
                tenancy_id: t.id,
                property_id: t.property_id,
                tenant_name: primary?.name ?? null,
                tenant_email: tenantEmail,
                subject: tn.subject,
                body: tn.body,
                dedupe_key: tenantNoticeDedupe,
                status: "pending",
              },
              { onConflict: "organization_id,event_key,dedupe_key", ignoreDuplicates: true },
            );
          if (!draftErr) {
            summary.enqueued++;
            detail.tenant_notice = { enqueued: true, to: tenantEmail };
          } else {
            detail.tenant_notice = { enqueued: false, error: draftErr.message };
          }
        }

        summary.details.push(detail);
      }
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
