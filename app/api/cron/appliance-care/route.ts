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
  consumableNextDue,
  dateStatus,
  WARRANTY_LEAD_DAYS,
  CONSUMABLE_LEAD_DAYS,
  APPLIANCE_URGENCY,
  type ApplianceType,
  type ApplianceStatus,
} from "@/lib/appliance-care";
import { decideApplianceNudge } from "@/lib/appliance-care-sweep";

// Appliance-care reminder sweep — the asset-tracked, per-record sibling of the
// detector + equipment sweeps (S362; S389). Two date-anchored reminders ride a
// unit's appliances, each its own opt-in event:
//   * WARRANTY (one-shot, per appliance): purchase anchor + warranty length => an
//     expiry date; when it nears, ONE email per UNIT lists the appliances whose
//     warranty is lapsing, so the landlord registers/uses the coverage in time.
//     Reads unit_appliances (0082), stamps unit_appliances.warranty_nudged_for.
//   * CONSUMABLE (RECURRING, per consumable): a labelled consumable (a fridge
//     water filter, an air filter, a range-hood charcoal filter) with an interval
//     in months, anchored to the last replacement. S389: an appliance can carry
//     MANY consumables, so this pass reads the appliance_consumables CHILD table
//     (0096), not the appliance row; when a next-due date nears, ONE email per
//     UNIT lists the due consumables. A one-tap "Mark replaced" rolls that
//     consumable's anchor => its next-due advances => the reminder re-arms. This
//     is the recurrence the once-per-lifecycle detector/equipment sweep doesn't
//     cover. Stamps appliance_consumables.nudged_for.
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
// an appliance with a warranty / a consumable.
//
// Auth: CRON_SECRET (Bearer or ?secret=). Test affordances (CRON_SECRET-gated):
//   ?org=<id>   limit the sweep to one org
//   ?force=1    bypass the already-nudged gate (still sends + stamps)
//   ?dry=1      build + return the rendered reminders WITHOUT sending or stamping
//
// Reads unit_appliances + appliance_consumables across all orgs via the
// service-role client (RLS hides them from anon/user sessions); see
// lib/supabase/admin.ts.

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

// --- Row shapes --------------------------------------------------------------

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
  property: { address: string | null } | null;
};

// A consumable child row (0096) joined to its appliance (for type/location +
// purchase anchor fallback) and its unit (for the email address).
type ConsumableRow = {
  id: string;
  property_id: string | null;
  appliance_id: string;
  label: string | null;
  interval_months: number | null;
  anchor_date: string | null;
  nudged_for: string | null;
  appliance: {
    appliance_type: ApplianceType;
    location: string | null;
    make: string | null;
    model: string | null;
    purchase_date: string | null;
    install_year: number | null;
  } | null;
  property: { address: string | null } | null;
};

// One actionable item to emit: the row id + which table/column to stamp, the
// target date + status, whether it should be (re)stamped this tick, and a fully
// rendered human line for the email's {{appliance_list}} token.
type EmitItem = {
  stampId: string;
  status: "due_soon" | "overdue";
  targetDate: string;
  stampFor: string | null; // non-null only when this item should be (re)stamped
  line: string;
};

function ident(make: string | null, model: string | null): string {
  const id = [make, model].filter((s) => (s ?? "").trim()).join(" ").trim();
  return id ? ` (${id})` : "";
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

  // Both events must be registered (each ships in lib/notifications.ts).
  const warrantyEvent = getNotificationEvent(WARRANTY_EVENT);
  const consumableEvent = getNotificationEvent(CONSUMABLE_EVENT);
  if (!warrantyEvent || !consumableEvent) {
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

      // Which kinds has this org opted into? Each event gates independently, so a
      // landlord can want warranty nudges but not consumable ones (or vice versa).
      const getSetting = async (eventKey: string): Promise<NotificationSettingRow | null> => {
        const { data: settingRow } = await admin
          .from("notification_settings")
          .select("event_key, enabled, subject_template, body_template, recipients, accent_color")
          .eq("organization_id", org.id)
          .eq("event_key", eventKey)
          .maybeSingle();
        return (settingRow as NotificationSettingRow | null) ?? null;
      };
      const warrantySetting = await getSetting(WARRANTY_EVENT);
      const consumableSetting = await getSetting(CONSUMABLE_EVENT);
      const warrantyOn = isDripEnqueueEnabled(warrantySetting);
      const consumableOn = isDripEnqueueEnabled(consumableSetting);
      if (!warrantyOn && !consumableOn) {
        summary.skipped++;
        continue;
      }

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

      // Shared emit: from a by-unit grouping of actionable items, email each unit
      // that has at least one NEWLY due item for this kind (already-nudged-only
      // units stay silent), then stamp each newly-due item on its own table.
      const emitKind = async (args: {
        eventKey: string;
        event: NonNullable<ReturnType<typeof getNotificationEvent>>;
        setting: NotificationSettingRow | null;
        stampTable: "unit_appliances" | "appliance_consumables";
        stampColumn: "warranty_nudged_for" | "nudged_for";
        byUnit: Map<string, { address: string; items: EmitItem[] }>;
      }) => {
        const dueUnits = Array.from(args.byUnit.entries()).filter(([, u]) =>
          u.items.some((i) => i.stampFor != null),
        );
        if (dueUnits.length === 0) {
          summary.details.push({ org: org.id, kind: args.eventKey, due_units: 0 });
          return;
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
            appliance_list: unit.items.map((i) => i.line).join("\n"),
            earliest_date: earliest,
            dashboard_url: dashboardUrl,
          };
          const toStamp = unit.items.filter((i) => i.stampFor != null);

          // --- Dry run: render + report, never send, never stamp ---------------
          if (dry) {
            const rendered = renderNotification(args.event, args.setting, vars);
            const recipients = resolveNotificationRecipients({
              audience: args.event.audience,
              configured: args.setting?.recipients ?? [],
              operatorFallback: operators,
            });
            summary.sent++; // "would send"
            summary.details.push({
              org: org.id,
              kind: args.eventKey,
              property: propertyId,
              dry: true,
              actionable: unit.items.length,
              would_stamp: toStamp.map((i) => ({ id: i.stampId, target: i.stampFor })),
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
            eventKey: args.eventKey,
            vars,
            operatorFallback: operators,
            action: { label: "Review the unit's appliances", url: dashboardUrl },
          });

          for (const i of toStamp) {
            await admin
              .from(args.stampTable)
              .update({ [args.stampColumn]: i.stampFor })
              .eq("id", i.stampId);
          }

          summary.sent++;
          summary.details.push({
            org: org.id,
            kind: args.eventKey,
            property: propertyId,
            sent: true,
            actionable: unit.items.length,
            stamped: toStamp.map((i) => ({ id: i.stampId, target: i.stampFor })),
          });
        }
      };

      // --- WARRANTY pass (per appliance) -------------------------------------
      if (warrantyOn) {
        const { data: applianceRows } = await admin
          .from("unit_appliances")
          .select(
            "id, property_id, appliance_type, make, model, location, purchase_date, install_year, " +
              "quantity, warranty_months, warranty_nudged_for, property:properties(address)",
          )
          .eq("organization_id", org.id);
        const rows = (applianceRows ?? []) as any[] as ApplianceRow[];

        const byUnit = new Map<string, { address: string; items: EmitItem[] }>();
        for (const r of rows) {
          if (!r.property_id) continue;
          const targetDate = warrantyExpiryDate(r);
          const status = dateStatus(targetDate, today, WARRANTY_LEAD_DAYS);
          if (status !== "due_soon" && status !== "overdue") continue;
          const decision = decideApplianceNudge({
            targetDate,
            status,
            lastNudgedFor: r.warranty_nudged_for ?? null,
            force,
          });
          const prop = one<{ address: string | null }>(r.property as any);
          const address = prop?.address?.trim() || "your rental unit";
          const type = applianceTypeLabel(r.appliance_type);
          const where = (r.location ?? "").trim();
          const loc = where ? ` — ${where}` : "";
          const state = status === "overdue" ? "WARRANTY LAPSED" : "warranty ending";
          const line = `- ${type}${ident(r.make, r.model)}${loc} — warranty ends ${targetDate!} (${state})`;
          const bucket = byUnit.get(r.property_id) ?? { address, items: [] };
          bucket.items.push({
            stampId: r.id,
            status,
            targetDate: targetDate!,
            stampFor: decision.nudge ? decision.stampFor : null,
            line,
          });
          byUnit.set(r.property_id, bucket);
        }

        await emitKind({
          eventKey: WARRANTY_EVENT,
          event: warrantyEvent,
          setting: warrantySetting,
          stampTable: "unit_appliances",
          stampColumn: "warranty_nudged_for",
          byUnit,
        });
      }

      // --- CONSUMABLE pass (per consumable child row, S389) -------------------
      if (consumableOn) {
        const { data: consumableRows } = await admin
          .from("appliance_consumables")
          .select(
            "id, property_id, appliance_id, label, interval_months, anchor_date, nudged_for, " +
              "appliance:unit_appliances(appliance_type, location, make, model, purchase_date, install_year), " +
              "property:properties(address)",
          )
          .eq("organization_id", org.id);
        const rows = (consumableRows ?? []) as any[] as ConsumableRow[];

        const byUnit = new Map<string, { address: string; items: EmitItem[] }>();
        for (const r of rows) {
          if (!r.property_id) continue;
          const appliance = one<NonNullable<ConsumableRow["appliance"]>>(r.appliance as any);
          const fallbackAnchor = appliance
            ? appliancePurchaseAnchor({
                purchase_date: appliance.purchase_date,
                install_year: appliance.install_year,
              })
            : null;
          const targetDate = consumableNextDue(
            { interval_months: r.interval_months, anchor_date: r.anchor_date },
            fallbackAnchor,
          );
          const status = dateStatus(targetDate, today, CONSUMABLE_LEAD_DAYS);
          if (status !== "due_soon" && status !== "overdue") continue;
          const decision = decideApplianceNudge({
            targetDate,
            status,
            lastNudgedFor: r.nudged_for ?? null,
            force,
          });
          const prop = one<{ address: string | null }>(r.property as any);
          const address = prop?.address?.trim() || "your rental unit";
          const type = appliance ? applianceTypeLabel(appliance.appliance_type) : "Appliance";
          const where = (appliance?.location ?? "").trim();
          const loc = where ? ` — ${where}` : "";
          const what = (r.label ?? "Consumable").trim();
          const state = status === "overdue" ? "OVERDUE" : "due soon";
          const line = `- ${type}${loc} — ${what} due ${targetDate!} (${state})`;
          const bucket = byUnit.get(r.property_id) ?? { address, items: [] };
          bucket.items.push({
            stampId: r.id,
            status,
            targetDate: targetDate!,
            stampFor: decision.nudge ? decision.stampFor : null,
            line,
          });
          byUnit.set(r.property_id, bucket);
        }

        await emitKind({
          eventKey: CONSUMABLE_EVENT,
          event: consumableEvent,
          setting: consumableSetting,
          stampTable: "appliance_consumables",
          stampColumn: "nudged_for",
          byUnit,
        });
      }
    } catch (e: any) {
      summary.errors++;
      summary.details.push({ org: org?.id, error: String(e?.message ?? e) });
    }
  }

  return NextResponse.json(summary, { status: 200 });
}
