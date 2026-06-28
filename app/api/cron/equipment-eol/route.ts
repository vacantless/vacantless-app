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
  computeEolDate,
  equipmentStatus,
  equipmentLeadDays,
  equipmentTypeLabel,
  equipmentInstallAnchor,
  EQUIPMENT_URGENCY,
  type EquipmentType,
} from "@/lib/equipment-eol";
import { decideEquipmentNudge } from "@/lib/equipment-eol-sweep";

// Major-equipment end-of-life reminder sweep — the asset-tracked, per-record
// sibling of the detector sweep (S361). Each item logged in unit_equipment (0081)
// has an install date + a manufacturer service life => an end-of-life date; when
// an item enters its (per-type) lead window the operator gets ONE email per UNIT
// listing every item in that unit that's due/overdue, so they plan a business-
// hours / off-season replacement instead of reacting to a failure (a burst water
// heater, a furnace dead mid-winter).
//
// Anchored to each item's install date, this rides the rent-increase-style
// per-record sweep (NOT the seasonal compliance calendar). Lead windows differ
// by type (water heater 120d, furnace 180d — lib/equipment-eol.ts). Copy/
// recipients/on-off + branding ride the notification substrate, exactly like
// every other event. Each item self-gates to ONCE per lifecycle via the stable
// unit_equipment.eol_nudged_for stamp (the EOL date — see equipment-eol-sweep.ts);
// logging a replacement rolls the EOL forward and re-arms the next cycle.
//
// SHIP DARK: opt-in per org (isDripEnqueueEnabled) — nothing fires until the org
// turns the "Major equipment reaching end of life" event on in Settings ->
// Notifications.
//
// Auth: CRON_SECRET (Bearer or ?secret=). Test affordances (CRON_SECRET-gated):
//   ?org=<id>   limit the sweep to one org
//   ?force=1    bypass the already-nudged gate (still sends + stamps)
//   ?dry=1      build + return the rendered reminders WITHOUT sending or stamping
//
// Reads unit_equipment across all orgs via the service-role client (RLS hides
// them from anon/user sessions); see lib/supabase/admin.ts.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://vacantless-app.vercel.app";
const MAX_RECIPIENTS = 10;
const EVENT_KEY = "leasing.landlord_equipment_eol";

type Summary = {
  ok: boolean;
  reason?: string;
  scanned: number; // orgs scanned
  sent: number; // unit reminders sent (or "would send" in dry mode)
  skipped: number; // orgs/items not actionable / opt-out / already nudged
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

type EquipmentRow = {
  id: string;
  property_id: string | null;
  equipment_type: EquipmentType;
  location: string | null;
  install_date: string | null;
  install_year: number | null;
  service_life_years: number | null;
  quantity: number | null;
  eol_nudged_for: string | null;
  property: { address: string | null } | null;
};

type Actionable = {
  row: EquipmentRow;
  eolDate: string;
  status: "due_soon" | "overdue";
  stampFor: string | null; // non-null only when this item should be (re)stamped
};

/** One human line for the email's {{equipment_list}} token. */
function equipmentLine(a: Actionable): string {
  const r = a.row;
  const type = equipmentTypeLabel(r.equipment_type);
  const where = (r.location ?? "").trim();
  const qty = r.quantity && r.quantity > 1 ? ` (x${r.quantity})` : "";
  const anchor = equipmentInstallAnchor(r);
  const installed = anchor ? `installed ${anchor.slice(0, 4)}` : "install date unknown";
  const state = a.status === "overdue" ? "OVERDUE" : "due soon";
  const loc = where ? ` — ${where}` : "";
  return `- ${type}${qty}${loc} — ${installed} — end of life ${a.eolDate} (${state})`;
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
      // so a quiet/opt-out org costs one cheap read, not an equipment scan.
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

      // All equipment for the org (RLS bypassed via the admin client; we filter
      // by org explicitly). Joined to the property for the address + grouping.
      const { data: equipRows } = await admin
        .from("unit_equipment")
        .select(
          "id, property_id, equipment_type, location, install_date, install_year, " +
            "service_life_years, quantity, eol_nudged_for, property:properties(address)",
        )
        .eq("organization_id", org.id);

      // Group actionable items by unit; track which ones to (re)stamp. The lead
      // window is per-TYPE (water heater 120d, furnace 180d), so status is
      // computed with the item's own window, not a flat constant.
      const byUnit = new Map<string, { address: string; items: Actionable[] }>();
      for (const raw of (equipRows ?? []) as any[]) {
        const r = raw as EquipmentRow;
        if (!r.property_id) continue;
        const eolDate = computeEolDate(r);
        const status = equipmentStatus(eolDate, today, equipmentLeadDays(r.equipment_type));
        if (status !== "due_soon" && status !== "overdue") continue; // not actionable
        const decision = decideEquipmentNudge({
          eolDate,
          status,
          lastNudgedFor: r.eol_nudged_for ?? null,
          force,
        });
        const prop = one<{ address: string | null }>(r.property as any);
        const address = prop?.address?.trim() || "your rental unit";
        const bucket = byUnit.get(r.property_id) ?? { address, items: [] };
        bucket.items.push({
          row: { ...r, property: prop },
          eolDate: eolDate!, // non-null: due_soon/overdue implies a real EOL date
          status,
          stampFor: decision.nudge ? decision.stampFor : null,
        });
        byUnit.set(r.property_id, bucket);
      }

      // A unit is emailed only when it has at least one NEWLY due item (one with
      // a stampFor); already-nudged-only units stay silent. The email still lists
      // EVERY actionable item in the unit, so the operator sees the full picture
      // and can combine the work.
      const dueUnits = Array.from(byUnit.entries()).filter(([, u]) =>
        u.items.some((i) => i.stampFor != null),
      );

      if (dueUnits.length === 0) {
        summary.details.push({ org: org.id, due_units: 0 });
        continue;
      }

      // Operator fallback recipients — same resolver as the rent-increase nudge
      // + the snapshot. Resolved once, only when a unit is actually due.
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

      for (const [propertyId, unit] of dueUnits) {
        // Most-urgent first (overdue before due_soon), then earliest EOL.
        unit.items.sort(
          (a, b) =>
            (EQUIPMENT_URGENCY[a.status] ?? 9) - (EQUIPMENT_URGENCY[b.status] ?? 9) ||
            a.eolDate.localeCompare(b.eolDate),
        );
        const dashboardUrl = `${APP_URL}/dashboard/properties/${propertyId}#equipment`;
        const earliestEol = unit.items
          .map((i) => i.eolDate)
          .sort((a, b) => a.localeCompare(b))[0];
        const vars: Record<string, string> = {
          org_name: org.name ?? "",
          property_address: unit.address,
          equipment_list: unit.items.map(equipmentLine).join("\n"),
          earliest_eol: earliestEol,
          dashboard_url: dashboardUrl,
        };
        const toStamp = unit.items.filter((i) => i.stampFor != null);

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
            property: propertyId,
            dry: true,
            actionable: unit.items.length,
            would_stamp: toStamp.map((i) => ({ id: i.row.id, eol: i.stampFor })),
            recipients,
            subject: rendered.subject,
            body: rendered.body,
          });
          continue;
        }

        // --- Real send via the substrate, then stamp each newly-due item ------
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
          action: { label: "Review the unit's equipment", url: dashboardUrl },
        });

        // Stamp regardless of whether the event ultimately had recipients — the
        // substrate short-circuits a disabled event, and we don't want to rebuild
        // this nudge every 15 min for the rest of the lifecycle.
        for (const i of toStamp) {
          await admin
            .from("unit_equipment")
            .update({ eol_nudged_for: i.stampFor })
            .eq("id", i.row.id);
        }

        summary.sent++;
        summary.details.push({
          org: org.id,
          property: propertyId,
          sent: true,
          actionable: unit.items.length,
          stamped: toStamp.map((i) => ({ id: i.row.id, eol: i.stampFor })),
        });
      }
    } catch (e: any) {
      summary.errors++;
      summary.details.push({ org: org?.id, error: String(e?.message ?? e) });
    }
  }

  return NextResponse.json(summary, { status: 200 });
}
