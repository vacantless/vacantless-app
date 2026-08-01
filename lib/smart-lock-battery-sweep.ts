import type { SupabaseClient } from "@supabase/supabase-js";
import { sendOrgNotification } from "./notifications-server";
import {
  getNotificationEvent,
  isDripEnqueueEnabled,
  renderNotification,
  resolveNotificationRecipients,
  type NotificationEvent,
  type NotificationSettingRow,
} from "./notifications";
import { resolveLeadNotifyEmails } from "./leads-notify";
import type { NotifyMember } from "./incident-reports";
import {
  isSmartLockBatteryReminderDue,
  nextSmartLockBatteryReminderDueAt,
  SMART_LOCK_BATTERY_INTERVAL_MONTHS,
} from "./smart-lock-battery";

export const SMART_LOCK_BATTERY_EVENT_KEY = "leasing.landlord_smart_lock_battery";

const MAX_RECIPIENTS = 10;

export type SmartLockBatterySummary = {
  ok: boolean;
  reason?: string;
  scanned: number;
  sent: number;
  skipped: number;
  errors: number;
  details: Array<Record<string, unknown>>;
};

type OrgRow = {
  id: string;
  name: string | null;
  brand_color: string | null;
  logo_url: string | null;
  reply_to_email: string | null;
  public_contact_email: string | null;
};

export type SmartLockUnitRow = {
  id: string;
  organization_id?: string | null;
  address: string | null;
  has_smart_lock: boolean | null;
  last_smart_lock_battery_reminder_at: string | null;
};

export type SmartLockBatteryDecision = {
  nudge: boolean;
  reason: "not_flagged" | "already_sent" | "due";
  stampAt: string | null;
  nextDueAt: string | null;
};

export function decideSmartLockBatteryReminder(args: {
  unit: Pick<
    SmartLockUnitRow,
    "has_smart_lock" | "last_smart_lock_battery_reminder_at"
  >;
  now: string | Date;
  force?: boolean;
}): SmartLockBatteryDecision {
  const lastSentAt = args.unit.last_smart_lock_battery_reminder_at ?? null;
  const nextDue = nextSmartLockBatteryReminderDueAt(lastSentAt);
  const nextDueAt = nextDue?.toISOString() ?? null;

  if (args.unit.has_smart_lock !== true) {
    return { nudge: false, reason: "not_flagged", stampAt: null, nextDueAt };
  }

  if (
    !args.force &&
    !isSmartLockBatteryReminderDue({
      lastSentAt,
      now: args.now,
      intervalMonths: SMART_LOCK_BATTERY_INTERVAL_MONTHS,
    })
  ) {
    return { nudge: false, reason: "already_sent", stampAt: null, nextDueAt };
  }

  const nowDate = args.now instanceof Date ? args.now : new Date(args.now);
  return {
    nudge: true,
    reason: "due",
    stampAt: nowDate.toISOString(),
    nextDueAt,
  };
}

export function smartLockBatteryLine(unit: SmartLockUnitRow): string {
  const address = unit.address?.trim() || "your rental unit";
  const last = unit.last_smart_lock_battery_reminder_at
    ? `last reminded ${unit.last_smart_lock_battery_reminder_at.slice(0, 10)}`
    : "no prior battery reminder";
  return `- ${address} - replace the smart-lock batteries (${last})`;
}

async function loadSetting(
  client: SupabaseClient,
  orgId: string,
): Promise<NotificationSettingRow | null> {
  const { data } = await client
    .from("notification_settings")
    .select("event_key, enabled, subject_template, body_template, recipients, accent_color")
    .eq("organization_id", orgId)
    .eq("event_key", SMART_LOCK_BATTERY_EVENT_KEY)
    .maybeSingle();
  return (data as NotificationSettingRow | null) ?? null;
}

async function operatorFallbackForOrg(
  client: SupabaseClient,
  org: OrgRow,
): Promise<string[]> {
  const { data: memberRows } = await client
    .from("memberships")
    .select("user_id, role")
    .eq("organization_id", org.id);
  const members: NotifyMember[] = [];
  for (const m of (memberRows ?? []) as { user_id: string; role: string }[]) {
    const { data: u } = await client.auth.admin.getUserById(m.user_id);
    members.push({ role: m.role, email: u?.user?.email ?? null });
  }
  return resolveLeadNotifyEmails(members, [
    org.reply_to_email,
    org.public_contact_email,
  ]).slice(0, MAX_RECIPIENTS);
}

export async function runSmartLockBatterySweep(args: {
  client: SupabaseClient;
  appUrl: string;
  onlyOrg?: string | null;
  force?: boolean;
  dry?: boolean;
  now?: string | Date;
}): Promise<SmartLockBatterySummary> {
  const event = getNotificationEvent(SMART_LOCK_BATTERY_EVENT_KEY);
  if (!event) {
    return {
      ok: false,
      reason: "event_not_registered",
      scanned: 0,
      sent: 0,
      skipped: 0,
      errors: 1,
      details: [],
    };
  }

  let orgQuery = args.client
    .from("organizations")
    .select(
      "id, name, brand_color, logo_url, reply_to_email, public_contact_email",
    );
  if (args.onlyOrg) orgQuery = orgQuery.eq("id", args.onlyOrg);
  const { data: orgs, error: orgErr } = await orgQuery;
  if (orgErr) {
    return {
      ok: false,
      reason: `org_query_error:${orgErr.message}`,
      scanned: 0,
      sent: 0,
      skipped: 0,
      errors: 1,
      details: [],
    };
  }

  const now = args.now ?? new Date();
  const summary: SmartLockBatterySummary = {
    ok: true,
    scanned: (orgs ?? []).length,
    sent: 0,
    skipped: 0,
    errors: 0,
    details: [],
  };

  for (const org of (orgs ?? []) as OrgRow[]) {
    try {
      const setting = await loadSetting(args.client, org.id);
      if (!isDripEnqueueEnabled(setting)) {
        summary.skipped++;
        continue;
      }

      const { data: propertyRows, error: propertyErr } = await args.client
        .from("properties")
        .select(
          "id, organization_id, address, has_smart_lock, last_smart_lock_battery_reminder_at",
        )
        .eq("organization_id", org.id)
        .eq("has_smart_lock", true);

      if (propertyErr) {
        summary.errors++;
        summary.details.push({
          org: org.id,
          error: `property_query_error:${propertyErr.message}`,
        });
        continue;
      }

      const dueUnits = ((propertyRows ?? []) as SmartLockUnitRow[])
        .map((unit) => ({
          unit,
          decision: decideSmartLockBatteryReminder({
            unit,
            now,
            force: args.force,
          }),
        }))
        .filter((row) => row.decision.nudge && row.decision.stampAt);

      if (dueUnits.length === 0) {
        summary.details.push({
          org: org.id,
          flagged_units: (propertyRows ?? []).length,
          due_units: 0,
        });
        continue;
      }

      const operatorFallback = await operatorFallbackForOrg(args.client, org);

      for (const { unit, decision } of dueUnits) {
        const dashboardUrl = `${args.appUrl}/dashboard/properties/${unit.id}#rental-details`;
        const nextDue = nextSmartLockBatteryReminderDueAt(decision.stampAt);
        const vars: Record<string, string> = {
          org_name: org.name ?? "",
          property_address: unit.address?.trim() || "your rental unit",
          smart_lock_list: smartLockBatteryLine(unit),
          interval_months: String(SMART_LOCK_BATTERY_INTERVAL_MONTHS),
          next_due_date: nextDue ? nextDue.toISOString().slice(0, 10) : "",
          dashboard_url: dashboardUrl,
        };

        if (args.dry) {
          const rendered = renderNotification(event as NotificationEvent, setting, vars);
          const recipients = resolveNotificationRecipients({
            audience: event.audience,
            configured: setting?.recipients ?? [],
            operatorFallback,
          });
          summary.sent++;
          summary.details.push({
            org: org.id,
            property: unit.id,
            dry: true,
            would_stamp: decision.stampAt,
            recipients,
            subject: rendered.subject,
            body: rendered.body,
          });
          continue;
        }

        await sendOrgNotification({
          client: args.client,
          org: {
            id: org.id,
            name: org.name,
            brand_color: org.brand_color,
            logo_url: org.logo_url,
            reply_to_email: org.reply_to_email,
          },
          eventKey: SMART_LOCK_BATTERY_EVENT_KEY,
          vars,
          operatorFallback,
          action: { label: "Review this rental's smart lock", url: dashboardUrl },
        });

        await args.client
          .from("properties")
          .update({ last_smart_lock_battery_reminder_at: decision.stampAt })
          .eq("organization_id", org.id)
          .eq("id", unit.id);

        summary.sent++;
        summary.details.push({
          org: org.id,
          property: unit.id,
          sent: true,
          stamped: decision.stampAt,
        });
      }
    } catch (e: any) {
      summary.errors++;
      summary.details.push({ org: org.id, error: String(e?.message ?? e) });
    }
  }

  return summary;
}
