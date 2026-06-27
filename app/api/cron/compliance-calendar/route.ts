import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendOrgNotification } from "@/lib/notifications-server";
import {
  getNotificationEvent,
  isDripEnqueueEnabled,
  firstWord,
  renderNotification,
  type NotificationSettingRow,
} from "@/lib/notifications";
import { resolveLeadNotifyEmails } from "@/lib/leads-notify";
import type { NotifyMember } from "@/lib/incident-reports";
import { localDateString } from "@/lib/leasing-snapshot";
import {
  COMPLIANCE_CALENDAR_ITEMS,
  LANDLORD_CALENDAR_ITEMS,
  dueComplianceItems,
  anchorDateFor,
  seasonalDedupeKey,
  complianceReminderDedupeKey,
  type ComplianceCalendarItem,
  type DueComplianceItem,
} from "@/lib/compliance-calendar";

// Seasonal compliance-calendar sweep — the first build-out of the send-mode axis
// after the S341 approve_to_send keystone. On each tick it asks which SEASONAL
// items (lib/compliance-calendar.ts) are inside their lead window for the org's
// LOCAL date, and for every active tenancy DRAFTS a soft, non-legal tenant
// courtesy note (furnace filter / outdoor water off+on / smoke+CO test) into the
// pending_tenant_messages approval queue (0075). It NEVER sends: a human operator
// reviews/edits and taps Approve & Send at /dashboard/messages (the exact same
// surface the rent-increase courtesy note uses). The whole tier ships dark —
// enqueue is OPT-IN per org+event (isDripEnqueueEnabled), so nothing drafts until
// an operator turns a seasonal event on.
//
// Rides the notification substrate (copy/recipients/branding/on-off) like every
// other event; idempotency is the pending_tenant_messages unique dedupe index
// keyed on (org, event, seasonalDedupeKey) — so the 15-min pinger drafts at most
// one row per (tenancy, event, season). No per-tenancy stamp needed (unlike the
// rent-increase sweep): the dedupe row IS the once-per-season guard.
//
// S357 adds a SECOND tier to the same sweep: the LANDLORD-NOTIFY annual reminders
// (LANDLORD_CALENDAR_ITEMS — insurance review / heating service / alarm
// compliance). These go to the OPERATOR directly (audience operator, sendMode
// notify, like leasing.rent_increase), ONE email per org per season — NOT a
// tenant draft. Because they are org-wide (no per-tenancy stamp, no pending_
// tenant_messages row to dedupe on), their at-most-once guard is the dedicated
// compliance_reminder_log table (0079), keyed (org, event, season). Same opt-in
// posture (isDripEnqueueEnabled) so each ships dark until an operator turns it on.
//
// Auth: CRON_SECRET (Bearer or ?secret=). Test affordances (CRON_SECRET-gated):
//   ?org=<id>   limit the sweep to one org
//   ?force=1    treat EVERY calendar item (both tiers) as in-window (current
//               year) — for QA outside the real window; still requires the event
//               opt-in. For the landlord tier, force also bypasses the
//               already-sent log check so QA can re-fire.
//   ?dry=1      build + return the drafts/reminders WITHOUT inserting or sending
//
// Reads tenancies/tenants across all orgs via the service-role client (RLS hides
// them from anon/user sessions); see lib/supabase/admin.ts.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://app.vacantless.com";

type Summary = {
  ok: boolean;
  reason?: string;
  scanned: number; // orgs scanned
  enqueued: number; // tenant drafts queued (or "would queue" in dry mode)
  notified: number; // landlord-notify reminders sent (or "would send" in dry)
  skipped: number; // (org,item) pairs skipped — event off / no due items / already sent
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
  property_id: string | null;
  property: { address: string | null } | null;
  tenants: { name: string | null; email: string | null; is_primary: boolean | null }[] | null;
};

/** The primary tenant (is_primary first, else the first listed) — the address
 *  for the soft courtesy draft. */
function primaryTenantOf(t: TenancyRow): { name: string | null; email: string | null } | null {
  const list = (t.tenants ?? [])
    .slice()
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
  return list[0] ?? null;
}

/** Every item in a set mapped to the current year's anchor — the ?force= view
 *  that ignores the calendar window for QA. Defaults to the tenant set. */
function allItemsForYear(
  todayYear: number,
  items: readonly ComplianceCalendarItem[] = COMPLIANCE_CALENDAR_ITEMS,
): DueComplianceItem[] {
  return items.map((item) => ({
    item,
    seasonYear: todayYear,
    anchorDate: anchorDateFor(item, todayYear),
  }));
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { ok: false, reason: "service_role_not_configured", scanned: 0, enqueued: 0, notified: 0, skipped: 0, errors: 0, details: [] } satisfies Summary,
      { status: 200 },
    );
  }

  const params = req.nextUrl.searchParams;
  const force = params.get("force") === "1";
  const dry = params.get("dry") === "1";
  const onlyOrg = params.get("org");

  let orgQuery = admin
    .from("organizations")
    .select(
      "id, name, booking_timezone, brand_color, logo_url, reply_to_email, public_contact_email",
    );
  if (onlyOrg) orgQuery = orgQuery.eq("id", onlyOrg);
  const { data: orgs, error: orgErr } = await orgQuery;

  if (orgErr) {
    return NextResponse.json(
      { ok: false, reason: `org_query_error:${orgErr.message}`, scanned: 0, enqueued: 0, notified: 0, skipped: 0, errors: 1, details: [] } satisfies Summary,
      { status: 200 },
    );
  }

  const nowMs = Date.now();
  const summary: Summary = { ok: true, scanned: (orgs ?? []).length, enqueued: 0, notified: 0, skipped: 0, errors: 0, details: [] };

  for (const org of (orgs ?? []) as any[]) {
    // Per-org isolation: one org's thrown error must not abort the sweep.
    try {
      const tz: string = org.booking_timezone || "America/Toronto";
      const today = localDateString(nowMs, tz);
      const todayYear = Number(today.slice(0, 4));

      // ======================================================================
      // TIER 1 — SOFT tenant courtesy notes (approve_to_send drafts). Drafts one
      // per active tenancy into pending_tenant_messages; idempotency = that
      // table's unique dedupe index. Unchanged from S343.
      // ======================================================================
      const dueTenant = force ? allItemsForYear(todayYear) : dueComplianceItems(today);
      if (dueTenant.length === 0) {
        summary.details.push({ org: org.id, tier: "tenant", due: 0 });
      } else {
        // Which of the due items does this org have turned ON (opt-in)? Fetch each
        // event's override row; absent / not-enabled => the seasonal note stays dark.
        const enabledDue: Array<{ d: DueComplianceItem; setting: NotificationSettingRow | null }> = [];
        for (const d of dueTenant) {
          const event = getNotificationEvent(d.item.eventKey);
          if (!event) {
            summary.skipped++;
            continue;
          }
          const { data: settingRow } = await admin
            .from("notification_settings")
            .select("event_key, enabled, subject_template, body_template, recipients, accent_color")
            .eq("organization_id", org.id)
            .eq("event_key", d.item.eventKey)
            .maybeSingle();
          const setting = (settingRow as NotificationSettingRow | null) ?? null;
          if (!isDripEnqueueEnabled(setting)) {
            summary.skipped++;
            continue;
          }
          enabledDue.push({ d, setting });
        }

        if (enabledDue.length === 0) {
          summary.details.push({ org: org.id, tier: "tenant", due: dueTenant.length, enabled: 0 });
        } else {
          // The active tenancies whose primary tenant we'll address — fetched once.
          const { data: tenancyRows } = await admin
            .from("tenancies")
            .select("id, property_id, property:properties(address), tenants(name, email, is_primary)")
            .eq("organization_id", org.id)
            .eq("status", "active");
          const tenancies = ((tenancyRows ?? []) as any[]).map((r) => ({
            ...r,
            property: one(r.property),
          })) as TenancyRow[];

          for (const { d, setting } of enabledDue) {
            const event = getNotificationEvent(d.item.eventKey)!;
            for (const t of tenancies) {
              const primary = primaryTenantOf(t);
              const tenantEmail = (primary?.email ?? "").trim() || null;
              // A draft with nowhere to go isn't actionable — skip tenancies with no
              // tenant address. (The operator can still send manually elsewhere.)
              if (!tenantEmail) {
                summary.skipped++;
                continue;
              }
              const address = t.property?.address?.trim() || "your rental unit";
              const vars: Record<string, string> = {
                org_name: org.name ?? "",
                property_address: address,
                tenant_first_name: firstWord(primary?.name ?? null),
                season_year: String(d.seasonYear),
              };
              const rendered = renderNotification(event, setting, vars);
              const dedupe = seasonalDedupeKey(d.item.eventKey, t.id, d.seasonYear);

              if (dry) {
                summary.enqueued++; // "would enqueue"
                summary.details.push({
                  org: org.id,
                  tenancy: t.id,
                  event: d.item.eventKey,
                  tier: "tenant",
                  dry: true,
                  to: tenantEmail,
                  season_year: d.seasonYear,
                  dedupe_key: dedupe,
                  subject: rendered.subject,
                  body: rendered.body,
                });
                continue;
              }

              const { error: draftErr } = await admin.from("pending_tenant_messages").upsert(
                {
                  organization_id: org.id,
                  event_key: d.item.eventKey,
                  tenancy_id: t.id,
                  property_id: t.property_id,
                  tenant_name: primary?.name ?? null,
                  tenant_email: tenantEmail,
                  subject: rendered.subject,
                  body: rendered.body,
                  dedupe_key: dedupe,
                  status: "pending",
                },
                { onConflict: "organization_id,event_key,dedupe_key", ignoreDuplicates: true },
              );
              if (!draftErr) {
                summary.enqueued++;
                summary.details.push({
                  org: org.id,
                  tenancy: t.id,
                  event: d.item.eventKey,
                  tier: "tenant",
                  enqueued: true,
                  to: tenantEmail,
                  season_year: d.seasonYear,
                });
              } else {
                summary.errors++;
                summary.details.push({
                  org: org.id,
                  tenancy: t.id,
                  event: d.item.eventKey,
                  tier: "tenant",
                  enqueued: false,
                  error: draftErr.message,
                });
              }
            }
          }
        }
      }

      // ======================================================================
      // TIER 2 — LANDLORD-NOTIFY annual reminders (S357). Emails the OPERATOR
      // directly (audience operator, sendMode notify) ONCE per org per season —
      // no tenant message. At-most-once guard = compliance_reminder_log (0079),
      // since these are org-wide (no per-tenancy stamp, no pending draft to
      // dedupe on). Opt-in per org (isDripEnqueueEnabled), so dark until turned on.
      // ======================================================================
      const dueLandlord = force
        ? allItemsForYear(todayYear, LANDLORD_CALENDAR_ITEMS)
        : dueComplianceItems(today, LANDLORD_CALENDAR_ITEMS);

      const enabledLandlord: Array<{ d: DueComplianceItem; setting: NotificationSettingRow | null }> = [];
      for (const d of dueLandlord) {
        const event = getNotificationEvent(d.item.eventKey);
        if (!event) {
          summary.skipped++;
          continue;
        }
        const { data: row } = await admin
          .from("notification_settings")
          .select("event_key, enabled, subject_template, body_template, recipients, accent_color")
          .eq("organization_id", org.id)
          .eq("event_key", d.item.eventKey)
          .maybeSingle();
        const setting = (row as NotificationSettingRow | null) ?? null;
        if (!isDripEnqueueEnabled(setting)) {
          summary.skipped++;
          continue;
        }
        enabledLandlord.push({ d, setting });
      }

      if (enabledLandlord.length > 0) {
        // Operator fallback recipients (members who manage, else the org's
        // reply-to / public contact) — resolved once, only when a landlord item
        // is actually enabled + due, so we don't hit auth on every quiet tick.
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
        ]);

        const dashboardUrl = `${APP_URL}/dashboard`;
        for (const { d, setting } of enabledLandlord) {
          const event = getNotificationEvent(d.item.eventKey)!;
          const dedupe = complianceReminderDedupeKey(d.seasonYear);
          const vars: Record<string, string> = {
            org_name: org.name ?? "",
            // org-wide reminder: no single property; a sane fallback so a custom
            // template that references {{property_address}} never shows the token.
            property_address: "your rental properties",
            season_year: String(d.seasonYear),
            dashboard_url: dashboardUrl,
          };

          // --- Dry run: render + report, never send, never log ---------------
          if (dry) {
            const rendered = renderNotification(event, setting, vars);
            summary.notified++; // "would send"
            summary.details.push({
              org: org.id,
              event: d.item.eventKey,
              tier: "landlord",
              dry: true,
              season_year: d.seasonYear,
              dedupe_key: dedupe,
              subject: rendered.subject,
              body: rendered.body,
            });
            continue;
          }

          // --- At-most-once per season: skip if already logged (unless force) -
          if (!force) {
            const { data: prior } = await admin
              .from("compliance_reminder_log")
              .select("id")
              .eq("organization_id", org.id)
              .eq("event_key", d.item.eventKey)
              .eq("dedupe_key", dedupe)
              .maybeSingle();
            if (prior) {
              summary.skipped++;
              summary.details.push({
                org: org.id,
                event: d.item.eventKey,
                tier: "landlord",
                already_sent: true,
                season_year: d.seasonYear,
              });
              continue;
            }
          }

          // --- Send to the operator via the substrate, then record the log ---
          // sendOrgNotification is best-effort (never throws, short-circuits a
          // disabled event or empty recipients); the log upsert (ignoreDuplicates)
          // is the once-per-season guard the 15-min pinger relies on.
          await sendOrgNotification({
            client: admin,
            org: {
              id: org.id,
              name: org.name,
              brand_color: org.brand_color,
              logo_url: org.logo_url,
              reply_to_email: org.reply_to_email,
            },
            eventKey: d.item.eventKey,
            vars,
            operatorFallback,
            action: { label: "Open your dashboard", url: dashboardUrl },
          });

          const { error: logErr } = await admin.from("compliance_reminder_log").upsert(
            {
              organization_id: org.id,
              event_key: d.item.eventKey,
              dedupe_key: dedupe,
            },
            { onConflict: "organization_id,event_key,dedupe_key", ignoreDuplicates: true },
          );
          if (!logErr) {
            summary.notified++;
            summary.details.push({
              org: org.id,
              event: d.item.eventKey,
              tier: "landlord",
              notified: true,
              season_year: d.seasonYear,
            });
          } else {
            summary.errors++;
            summary.details.push({
              org: org.id,
              event: d.item.eventKey,
              tier: "landlord",
              notified: false,
              error: logErr.message,
            });
          }
        }
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
