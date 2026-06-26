import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getNotificationEvent,
  isDripEnqueueEnabled,
  firstWord,
  renderNotification,
  type NotificationSettingRow,
} from "@/lib/notifications";
import { localDateString } from "@/lib/leasing-snapshot";
import {
  COMPLIANCE_CALENDAR_ITEMS,
  dueComplianceItems,
  anchorDateFor,
  seasonalDedupeKey,
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
// Auth: CRON_SECRET (Bearer or ?secret=). Test affordances (CRON_SECRET-gated):
//   ?org=<id>   limit the sweep to one org
//   ?force=1    treat EVERY seasonal item as in-window (current year) — for QA
//               outside the real calendar window; still requires the event opt-in
//   ?dry=1      build + return the drafts WITHOUT inserting
//
// Reads tenancies/tenants across all orgs via the service-role client (RLS hides
// them from anon/user sessions); see lib/supabase/admin.ts.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Summary = {
  ok: boolean;
  reason?: string;
  scanned: number; // orgs scanned
  enqueued: number; // drafts queued (or "would queue" in dry mode)
  skipped: number; // (org,item) pairs skipped — event off / no due items
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

/** Every seasonal item mapped to the current year's anchor — the ?force= view
 *  that ignores the calendar window for QA. */
function allItemsForYear(todayYear: number): DueComplianceItem[] {
  return COMPLIANCE_CALENDAR_ITEMS.map((item) => ({
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
      { ok: false, reason: "service_role_not_configured", scanned: 0, enqueued: 0, skipped: 0, errors: 0, details: [] } satisfies Summary,
      { status: 200 },
    );
  }

  const params = req.nextUrl.searchParams;
  const force = params.get("force") === "1";
  const dry = params.get("dry") === "1";
  const onlyOrg = params.get("org");

  let orgQuery = admin.from("organizations").select("id, name, booking_timezone");
  if (onlyOrg) orgQuery = orgQuery.eq("id", onlyOrg);
  const { data: orgs, error: orgErr } = await orgQuery;

  if (orgErr) {
    return NextResponse.json(
      { ok: false, reason: `org_query_error:${orgErr.message}`, scanned: 0, enqueued: 0, skipped: 0, errors: 1, details: [] } satisfies Summary,
      { status: 200 },
    );
  }

  const nowMs = Date.now();
  const summary: Summary = { ok: true, scanned: (orgs ?? []).length, enqueued: 0, skipped: 0, errors: 0, details: [] };

  for (const org of (orgs ?? []) as any[]) {
    // Per-org isolation: one org's thrown error must not abort the sweep.
    try {
      const tz: string = org.booking_timezone || "America/Toronto";
      const today = localDateString(nowMs, tz);
      const todayYear = Number(today.slice(0, 4));

      const due = force ? allItemsForYear(todayYear) : dueComplianceItems(today);
      if (due.length === 0) {
        summary.details.push({ org: org.id, due: 0 });
        continue;
      }

      // Which of the due items does this org have turned ON (opt-in)? Fetch each
      // event's override row; absent / not-enabled => the seasonal note stays dark.
      const enabledDue: Array<{ d: DueComplianceItem; setting: NotificationSettingRow | null }> = [];
      for (const d of due) {
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
        summary.details.push({ org: org.id, due: due.length, enabled: 0 });
        continue;
      }

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
              enqueued: false,
              error: draftErr.message,
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
