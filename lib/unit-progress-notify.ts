// S788d: unit progress emails (PLAN-S788-UNIT-PROGRESS). Server only.
//   notifyLandlordOfTap   the landlord hears when the crew taps Tenant gave
//                         notice, Photos are in or Rented.
//   runUnitProgressSweep  every 15 minutes: crew reminders on Noam's cadence
//                         (lib/unit-progress-reminders) and the landlord's one
//                         copy when a reminder sat 3 days with no update.
// Every send goes through sendOrgNotification, so quiet test accounts and an
// event switched off in Settings send nothing; a reminder is only recorded
// when it was actually delivered.
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendOrgNotification, type NotifyOrg } from "@/lib/notifications-server";
import { getUserByIdCached } from "@/lib/auth-email-cache";
import { resolveLeadNotifyEmails } from "@/lib/leads-notify";
import type { NotifyMember } from "@/lib/incident-reports";
import { STAGE_LABEL, isCrewRole, stageDateLine, type Stage } from "@/lib/unit-progress";
import { unitCardsForOrg } from "@/lib/unit-progress-server";
import {
  emailFromContact,
  escalationsDue,
  remindersDue,
  type CrewLite,
  type EscalationRow,
  type SentRow,
  type UnitState,
} from "@/lib/unit-progress-reminders";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://app.vacantless.com").replace(/\/+$/, "");
const MAX_RECIPIENTS = 10;
export const TAP_NOTIFY_STAGES: readonly Stage[] = ["notice_given", "photos_in", "rented"];

type OrgRow = NotifyOrg & { public_contact_email: string | null; booking_timezone: string | null };

async function loadOrg(admin: SupabaseClient, orgId: string): Promise<OrgRow | null> {
  const { data } = await admin
    .from("organizations")
    .select("id, name, brand_color, logo_url, reply_to_email, public_contact_email, booking_timezone")
    .eq("id", orgId)
    .maybeSingle();
  return (data as OrgRow | null) ?? null;
}

async function operatorFallback(admin: SupabaseClient, org: OrgRow): Promise<string[]> {
  const { data: memberRows } = await admin.from("memberships").select("user_id, role").eq("organization_id", org.id);
  const members: NotifyMember[] = [];
  for (const m of (memberRows ?? []) as { user_id: string; role: string }[]) {
    const { data: u } = await getUserByIdCached(admin, m.user_id);
    members.push({ role: m.role, email: u?.user?.email ?? null });
  }
  return resolveLeadNotifyEmails(members, [org.reply_to_email, org.public_contact_email]).slice(0, MAX_RECIPIENTS);
}

/** Tell the landlord about a tap that needs them. Never throws. */
export async function notifyLandlordOfTap(args: {
  admin: SupabaseClient;
  organizationId: string;
  propertyId: string;
  crewName: string;
  stage: Stage;
  dueDate: string | null;
}): Promise<void> {
  if (!TAP_NOTIFY_STAGES.includes(args.stage)) return;
  try {
    const org = await loadOrg(args.admin, args.organizationId);
    if (!org) return;
    const { data: prop } = await args.admin.from("properties").select("address").eq("id", args.propertyId).maybeSingle();
    const address = (prop as { address: string | null } | null)?.address ?? "A unit";
    const extra =
      args.stage === "rented" ? "Its ads are coming down. If that was a mistake, relist it from the rental page." : stageDateLine(args.stage, args.dueDate);
    await sendOrgNotification({
      client: args.admin,
      org,
      eventKey: "leasing.unit_progress_update",
      vars: {
        org_name: org.name ?? "",
        property_address: address,
        crew_name: args.crewName,
        stage_label: STAGE_LABEL[args.stage].toLowerCase(),
        date_line: extra ? `${extra}.`.replace(/\.\.$/, ".") : "",
        dashboard_url: `${APP_URL}/dashboard/crew`,
      },
      operatorFallback: await operatorFallback(args.admin, org),
      action: { label: "See every unit", url: `${APP_URL}/dashboard/crew` },
    });
  } catch (err) {
    console.error("[unit-progress] tap notify failed", err instanceof Error ? err.message : String(err));
  }
}

export type UnitProgressSweepSummary = { ok: boolean; orgs: number; reminders: number; escalations: number; errors: number };

export async function runUnitProgressSweep(args: { admin: SupabaseClient; now?: Date }): Promise<UnitProgressSweepSummary> {
  const now = args.now ?? new Date();
  const summary: UnitProgressSweepSummary = { ok: true, orgs: 0, reminders: 0, escalations: 0, errors: 0 };
  const { admin } = args;
  const { data: crewRows, error } = await admin
    .from("crew_members")
    .select("id, organization_id, name, role, contact, link_token, active")
    .eq("active", true)
    .limit(2000);
  if (error) return { ...summary, ok: false, errors: 1 };
  const byOrg = new Map<string, Array<{ id: string; name: string; role: string; contact: string | null; link_token: string }>>();
  for (const r of (crewRows ?? []) as Array<{ id: string; organization_id: string; name: string; role: string; contact: string | null; link_token: string }>) {
    byOrg.set(r.organization_id, [...(byOrg.get(r.organization_id) ?? []), r]);
  }
  const since = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString();

  for (const [orgId, members] of byOrg) {
    try {
      const org = await loadOrg(admin, orgId);
      if (!org) continue;
      summary.orgs++;
      const cards = await unitCardsForOrg(admin, orgId);
      const units: UnitState[] = cards.map((c) => ({ id: c.id, address: c.address, status: c.status, stage: c.stage, stageAt: c.stageAt, stageDate: c.stageDate }));
      const crew: CrewLite[] = members
        .filter((m) => isCrewRole(m.role))
        .map((m) => ({ id: m.id, name: m.name, role: m.role as CrewLite["role"], email: emailFromContact(m.contact) }));
      const { data: sentData } = await admin
        .from("unit_progress_reminders")
        .select("id, crew_member_id, property_id, reason, sent_at, escalated_at")
        .eq("organization_id", orgId)
        .gte("sent_at", since)
        .limit(5000);
      const sentRows = (sentData ?? []) as EscalationRow[];

      // 1. Reminders to the crew.
      const due = remindersDue({ units, crew, sent: sentRows as SentRow[], now, timeZone: org.booking_timezone || "America/Toronto" });
      for (const r of due) {
        const person = members.find((m) => m.id === r.crewId);
        const c = crew.find((x) => x.id === r.crewId);
        if (!person || !c?.email) continue;
        const crewUrl = `${APP_URL}/crew/${person.link_token}`;
        const res = await sendOrgNotification({
          client: admin,
          org,
          eventKey: "leasing.crew_progress_reminder",
          vars: {
            org_name: org.name ?? "",
            property_address: "",
            crew_name: person.name,
            reminder_count: String(r.items.length),
            reminder_lines: r.items.map((i) => i.line).join("\n"),
            crew_url: crewUrl,
          },
          audienceEmail: c.email,
          action: { label: "Update my units", url: crewUrl },
        });
        if (!res.delivered) continue;
        summary.reminders++;
        await admin.from("unit_progress_reminders").insert(
          r.items.map((i) => ({
            organization_id: orgId,
            crew_member_id: r.crewId,
            property_id: i.propertyId,
            reason: i.reason,
            sent_at: now.toISOString(),
          })),
        );
      }

      // 2. The landlord's one copy when a reminder sat 3 days with no update.
      const stuck = escalationsDue(sentRows, units, now);
      if (stuck.length > 0) {
        const lines = new Map<string, string>();
        for (const s of stuck) {
          const u = units.find((x) => x.id === s.property_id);
          const who = members.find((m) => m.id === s.crew_member_id)?.name ?? "your crew";
          if (u && !lines.has(u.id)) {
            lines.set(u.id, `${u.address}: ${u.stage ? STAGE_LABEL[u.stage].toLowerCase() : "no stage yet"}. Asked: ${who}.`);
          }
        }
        const res = await sendOrgNotification({
          client: admin,
          org,
          eventKey: "leasing.unit_progress_stuck",
          vars: {
            org_name: org.name ?? "",
            property_address: "",
            unit_count: String(lines.size),
            unit_lines: [...lines.values()].join("\n"),
            dashboard_url: `${APP_URL}/dashboard/crew`,
          },
          operatorFallback: await operatorFallback(admin, org),
          action: { label: "See every unit", url: `${APP_URL}/dashboard/crew` },
        });
        // Mark them either way when the send was attempted, so a switched-off
        // event does not retry every 15 minutes; a quiet account stays unmarked.
        if (res.delivered || res.skipped === "event_disabled") {
          await admin
            .from("unit_progress_reminders")
            .update({ escalated_at: now.toISOString() })
            .in("id", stuck.map((s) => s.id));
          if (res.delivered) summary.escalations++;
        }
      }
    } catch (err) {
      summary.errors++;
      console.error("[unit-progress] sweep org failed", orgId, err instanceof Error ? err.message : String(err));
    }
  }
  return summary;
}
