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
  applianceTypeLabel,
  appliancePurchaseAnchor,
  warrantyExpiryDate,
  consumableDueDate,
  dateStatus,
  WARRANTY_LEAD_DAYS,
  CONSUMABLE_LEAD_DAYS,
  APPLIANCE_URGENCY,
  type ApplianceType,
  type ApplianceStatus,
} from "@/lib/appliance-care";
import { decideApplianceNudge } from "@/lib/appliance-care-sweep";

// Appliance-care reminder sweep — the asset-tracked, per-record sibling of the
// detector + equipment sweeps (S362). Each appliance logged in unit_appliances
// (0082) can carry TWO date-anchored reminders, each its own opt-in event:
//   * WARRANTY (one-shot): purchase anchor + warranty length => an expiry date;
//     when it nears, ONE email per UNIT lists the appliances whose warranty is
//     lapsing, so the landlord registers/uses the coverage in time.
//   * CONSUMABLE (RECURRING): a labelled consumable (e.g. a fridge water filter)
//     with an interval in months, anchored to the last replacement; when the next
//     due date nears, ONE email per UNIT lists the due consumables. A one-tap
//     "Mark replaced" on the unit page rolls the anchor => the next-due date
//     advances => the reminder re-arms. This is the recurrence the once-per-
//     lifecycle detector/equipment sweep doesn't cover.
//
// Both kinds: anchored per record (NOT the seasonal calendar), grouped by unit
// (one email per unit per kind so the trip combines), and self-gate to once per
// target via a stable *_nudged_for stamp (the warranty expiry / the consumable
// next-due — see appliance-care-sweep.ts). Copy/recipients/on-off + branding ride
// the notification substrate exactly like every other event.
//
// SHIP DARK: opt-in per org AND per kind (each event has its own
// isDripEnqueueEnabled) — nothing fires until the org turns the relevant event on
// in Settings -> Notifications, and nothing exists to fire until a landlord logs
// an appliance with a warranty / consumable.
//
// Auth: CRON_SECRET (Bearer or ?secret=). Test affordances (CRON_SECRET-gated):
//   ?org=<id>   limit the sweep to one org
//   ?force=1    bypass the already-nudged gate (still sends + stamps)
//   ?dry=1      build + return the rendered reminders WITHOUT sending or stamping
//
// Reads unit_appliances across all orgs via the service-role client (RLS hides
// them from anon/user sessions); see lib/supabase/admin.ts.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://vacantless-app.vercel.app";
const MAX_RECIPIENTS = 10;

const WARRANTY_EVENT = "leasing.landlord_appliance_warranty";
const CONSUMABLE_EVENT = "leasing.landlord_appliance_consumable";

type Summary = {
  ok: boolean;
  reason?: string;
  scanned: number; // orgs scanned
  sent: number; // unit reminders sent (or "would send" in dry mode), across both kinds
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

type ApplianceRow = {
  id: string;
  property_id: string | null;
  appliance_type: ApplianceType;
  make: string | null;
  model: string | null;
  location: string | null;
  purchase_date: string | null;
  install_year: number | null;
  quantity: number | null;
  warranty_months: number | null;
  warranty_nudged_for: string | null;
  consumable_label: string | null;
  consumable_interval_months: number | null;
  consumable_anchor_date: string | null;
  consumable_nudged_for: string | null;
  property: { address: string | null } | null;
};

type Actionable = {
  row: ApplianceRow;
  targetDate: string;
  status: "due_soon" | "overdue";
  stampFor: string | null; // non-null only when this item should be (re)stamped
};

// A reminder "kind" = one event + how to read its target/stamp off a row. The two
// kinds share all the grouping/sending/stamping machinery below.
type Kind = {
  eventKey: string;
  stampColumn: "warranty_nudged_for" | "consumable_nudged_for";
  // The target date for this kind (null = not configured / unknown anchor).
  targetDate: (r: ApplianceRow) => string | null;
  // The lead window for this kind.
  leadDays: number;
  // The row's existing stamp for this kind.
  lastNudgedFor: (r: ApplianceRow) => string | null;
  // One human line for the email's {{appliance_list}} token.
  line: (a: Actionable) => string;
};

function ident(r: ApplianceRow): string {
  const id = [r.make, r.model].filter((s) => (s ?? "").trim()).join(" ").trim();
  return id ? ` (${id})` : "";
}

const WARRANTY_KIND: Kind = {
  eventKey: WARRANTY_EVENT,
  stampColumn: "warranty_nudged_for",
  targetDate: (r) => warrantyExpiryDate(r),
  leadDays: WARRANTY_LEAD_DAYS,
  lastNudgedFor: (r) => r.warranty_nudged_for ?? null,
  line: (a) => {
    const r = a.row;
    const type = applianceTypeLabel(r.appliance_type);
    const where = (r.location ?? "").trim();
    const loc = where ? ` — ${where}` : "";
    const state = a.status === "overdue" ? "WARRANTY LAPSED" : "warranty ending";
    return `- ${type}${ident(r)}${loc} — warranty ends ${a.targetDate} (${state})`;
  },
};

const CONSUMABLE_KIND: Kind = {
  eventKey: CONSUMABLE_EVENT,
  stampColumn: "consumable_nudged_for",
  targetDate: (r) => consumableDueDate(r),
  leadDays: CONSUMABLE_LEAD_DAYS,
  lastNudgedFor: (r) => r.consumable_nudged_for ?? null,
  line: (a) => {
    const r = a.row;
    const type = applianceTypeLabel(r.appliance_type);
    const where = (r.location ?? "").trim();
    const loc = where ? ` — ${where}` : "";
    const what = (r.consumable_label ?? "Consumable").trim();
    const state = a.status === "overdue" ? "OVERDUE" : "due soon";
    return `- ${type}${loc} — ${what} due ${a.targetDate} (${state})`;
  },
};

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

  // Both events must be registered (each ships in lib/notifications.ts).
  const warrantyEvent = getNotificationEvent(WARRANTY_EVENT);
  const consumableEvent = getNotificationEvent(CONSUMABLE_EVENT);
  if (!warrantyEvent || !consumableEvent) {
    return NextResponse.json(
      { ok: false, reason: "event_not_registered", scanned: 0, sent: 0, skipped: 0, errors: 1, details: [] } satisfies Summary,
      { status: 200 },
    );
  }
  const eventByKey: Record<string, typeof warrantyEvent> = {
    [WARRANTY_EVENT]: warrantyEvent,
    [CONSUMABLE_EVENT]: consumableEvent,
  };

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

      // Which kinds has this org opted into? Each event gates independently, so a
      // landlord can want warranty nudges but not consumable ones (or vice versa).
      const settingByEvent = new Map<string, NotificationSettingRow | null>();
      const enabledKinds: Kind[] = [];
      for (const kind of [WARRANTY_KIND, CONSUMABLE_KIND]) {
        const { data: settingRow } = await admin
          .from("notification_settings")
          .select("event_key, enabled, subject_template, body_template, recipients, accent_color")
          .eq("organization_id", org.id)
          .eq("event_key", kind.eventKey)
          .maybeSingle();
        const setting = (settingRow as NotificationSettingRow | null) ?? null;
        settingByEvent.set(kind.eventKey, setting);
        if (isDripEnqueueEnabled(setting)) enabledKinds.push(kind);
      }
      if (enabledKinds.length === 0) {
        summary.skipped++;
        continue;
      }

      // All appliances for the org (RLS bypassed via the admin client; we filter
      // by org explicitly). Fetched ONCE and reused across the enabled kinds.
      const { data: applianceRows } = await admin
        .from("unit_appliances")
        .select(
          "id, property_id, appliance_type, make, model, location, purchase_date, install_year, " +
            "quantity, warranty_months, warranty_nudged_for, consumable_label, " +
            "consumable_interval_months, consumable_anchor_date, consumable_nudged_for, " +
            "property:properties(address)",
        )
        .eq("organization_id", org.id);
      const rows = (applianceRows ?? []) as any[] as ApplianceRow[];

      // Operator fallback recipients — resolved lazily (only when something is due
      // for this org) and memoized across kinds.
      let operatorFallback: string[] | null = null;
      const resolveOperators = async (): Promise<string[]> => {
        if (operatorFallback) return operatorFallback;
        const { data: memberRows } = await admin
          .from("memberships")
          .select("user_id, role")
          .eq("organization_id", org.id);
        const members: NotifyMember[] = [];
        for (const m of (memberRows ?? []) as { user_id: string; role: string }[]) {
          const { data: u } = await admin.auth.admin.getUserById(m.user_id);
          members.push({ role: m.role, email: u?.user?.email ?? null });
        }
        operatorFallback = resolveLeadNotifyEmails(members, [
          org.reply_to_email,
          org.public_contact_email,
        ]).slice(0, MAX_RECIPIENTS);
        return operatorFallback;
      };

      for (const kind of enabledKinds) {
        const event = eventByKey[kind.eventKey];
        const setting = settingByEvent.get(kind.eventKey) ?? null;

        // Group actionable items by unit; track which ones to (re)stamp.
        const byUnit = new Map<string, { address: string; items: Actionable[] }>();
        for (const r of rows) {
          if (!r.property_id) continue;
          const targetDate = kind.targetDate(r);
          const status = dateStatus(targetDate, today, kind.leadDays);
          if (status !== "due_soon" && status !== "overdue") continue; // not actionable
          const decision = decideApplianceNudge({
            targetDate,
            status,
            lastNudgedFor: kind.lastNudgedFor(r),
            force,
          });
          const prop = one<{ address: string | null }>(r.property as any);
          const address = prop?.address?.trim() || "your rental unit";
          const bucket = byUnit.get(r.property_id) ?? { address, items: [] };
          bucket.items.push({
            row: { ...r, property: prop },
            targetDate: targetDate!, // non-null: due_soon/overdue implies a real date
            status,
            stampFor: decision.nudge ? decision.stampFor : null,
          });
          byUnit.set(r.property_id, bucket);
        }

        // A unit is emailed only when it has at least one NEWLY due item for this
        // kind; already-nudged-only units stay silent. The email still lists EVERY
        // actionable item of this kind in the unit so the work can be combined.
        const dueUnits = Array.from(byUnit.entries()).filter(([, u]) =>
          u.items.some((i) => i.stampFor != null),
        );
        if (dueUnits.length === 0) {
          summary.details.push({ org: org.id, kind: kind.eventKey, due_units: 0 });
          continue;
        }

        const operators = await resolveOperators();

        for (const [propertyId, unit] of dueUnits) {
          // Most-urgent first (overdue before due_soon), then earliest target.
          unit.items.sort(
            (a, b) =>
              (APPLIANCE_URGENCY[a.status] ?? 9) - (APPLIANCE_URGENCY[b.status] ?? 9) ||
              a.targetDate.localeCompare(b.targetDate),
          );
          const dashboardUrl = `${APP_URL}/dashboard/properties/${propertyId}#appliances`;
          const earliest = unit.items
            .map((i) => i.targetDate)
            .sort((a, b) => a.localeCompare(b))[0];
          const vars: Record<string, string> = {
            org_name: org.name ?? "",
            property_address: unit.address,
            appliance_list: unit.items.map(kind.line).join("\n"),
            earliest_date: earliest,
            dashboard_url: dashboardUrl,
          };
          const toStamp = unit.items.filter((i) => i.stampFor != null);

          // --- Dry run: render + report, never send, never stamp ---------------
          if (dry) {
            const rendered = renderNotification(event, setting, vars);
            const recipients = resolveNotificationRecipients({
              audience: event.audience,
              configured: setting?.recipients ?? [],
              operatorFallback: operators,
            });
            summary.sent++; // "would send"
            summary.details.push({
              org: org.id,
              kind: kind.eventKey,
              property: propertyId,
              dry: true,
              actionable: unit.items.length,
              would_stamp: toStamp.map((i) => ({ id: i.row.id, target: i.stampFor })),
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
            eventKey: kind.eventKey,
            vars,
            operatorFallback: operators,
            action: { label: "Review the unit's appliances", url: dashboardUrl },
          });

          for (const i of toStamp) {
            await admin
              .from("unit_appliances")
              .update({ [kind.stampColumn]: i.stampFor })
              .eq("id", i.row.id);
          }

          summary.sent++;
          summary.details.push({
            org: org.id,
            kind: kind.eventKey,
            property: propertyId,
            sent: true,
            actionable: unit.items.length,
            stamped: toStamp.map((i) => ({ id: i.row.id, target: i.stampFor })),
          });
        }
      }
    } catch (e: any) {
      summary.errors++;
      summary.details.push({ org: org?.id, error: String(e?.message ?? e) });
    }
  }

  return NextResponse.json(summary, { status: 200 });
}
