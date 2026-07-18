import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  Availability,
  AvailabilityOverride,
  AvailabilityRule,
} from "@/lib/booking";
import { countOpenBookableSlots } from "@/lib/availability-tripwire";
import {
  isReopenLeadEligible,
  reopenLeadsToNotify,
} from "@/lib/availability-reopen";
import {
  NURTURE_MAX_AGE_MS,
  NURTURABLE_STATUSES,
} from "@/lib/nurture";
import { sendViewingTimesOpenedEmail } from "@/lib/email";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_LOOKAHEAD_DAYS = 7;
const DAY_MS = 24 * 3_600_000;

type Summary = {
  ok: boolean;
  reason?: string;
  scanned: number;
  sent: number;
  skipped: number;
  errors: number;
  details: Array<Record<string, unknown>>;
};

type AvailabilityRuleRow = AvailabilityRule & { created_at: string | null };
type AvailabilityDayOffRow = { day: string; created_at: string | null };
type AvailabilityOverrideRow = AvailabilityOverride & {
  created_at: string | null;
};
type FutureShowingRow = { scheduled_at: string | null };

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  return req.nextUrl.searchParams.get("secret") === secret;
}

function positiveInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function parseTimeMs(value: unknown): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function safeErrorMessage(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "object" && err !== null && "message" in err
        ? (err as { message?: unknown }).message
        : typeof err === "string"
          ? err
          : null;
  if (typeof raw !== "string" || raw.trim() === "") return "unknown";
  return raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]");
}

function flag(value: boolean): "1" | "0" {
  return value ? "1" : "0";
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function logOrgReopenResult(input: {
  orgId: string;
  outcome: string;
  eligible: number;
  open: number;
  toNotify: number;
  sent: number;
  skipped: number;
  errors: number;
  force: boolean;
  dry: boolean;
}) {
  console.log(
    `[availability-reopened-notify] org=${input.orgId} outcome=${input.outcome} eligible=${input.eligible} open=${input.open} toNotify=${input.toNotify} sent=${input.sent} skipped=${input.skipped} errors=${input.errors} force=${flag(input.force)} dry=${flag(input.dry)}`,
  );
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

  const nowMs = Date.now();
  const now = new Date(nowMs);
  const oldestIso = new Date(nowMs - NURTURE_MAX_AGE_MS).toISOString();

  let leadQuery = admin
    .from("leads")
    .select(
      "id, created_at, organization_id, property_id, name, email, status, " +
        "no_suitable_time, reopen_notified_at, " +
        "properties(status, address, rent_cents), " +
        "organizations(id, name, brand_color, logo_url, reply_to_email, " +
        "availability_reopened_at, availability_tripwire_lookahead_days, " +
        "booking_timezone, booking_slot_minutes, booking_lead_hours, booking_horizon_days)",
    )
    .eq("no_suitable_time", true)
    .in("status", NURTURABLE_STATUSES as unknown as string[])
    .gt("created_at", oldestIso);
  if (onlyOrg) leadQuery = leadQuery.eq("organization_id", onlyOrg);

  const { data, error } = await leadQuery;
  if (error) {
    return NextResponse.json(
      { ok: false, reason: `query_error:${error.message}`, scanned: 0, sent: 0, skipped: 0, errors: 1, details: [] } satisfies Summary,
      { status: 200 },
    );
  }

  const rows = (data ?? []) as any[];
  const summary: Summary = { ok: true, scanned: rows.length, sent: 0, skipped: 0, errors: 0, details: [] };
  const groups = new Map<string, { org: any; leads: any[] }>();

  for (const row of rows) {
    const org = firstRelation(row.organizations);
    const orgId = row.organization_id ?? org?.id;
    if (!org || !orgId) {
      summary.skipped++;
      summary.details.push({ lead: row.id, skipped: "missing_org" });
      continue;
    }
    const existing = groups.get(orgId);
    if (existing) existing.leads.push(row);
    else groups.set(orgId, { org, leads: [row] });
  }

  for (const [orgId, group] of groups) {
    let stage = "start";
    let open = 0;
    let eligibleCount = 0;
    let toNotifyCount = 0;
    let sentCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    try {
      const org = group.org;
      const reopenedAtMs = parseTimeMs(org.availability_reopened_at);
      if (reopenedAtMs == null) {
        skippedCount = group.leads.length;
        summary.skipped += skippedCount;
        logOrgReopenResult({
          orgId,
          outcome: "no_reopen_stamp",
          eligible: 0,
          open,
          toNotify: 0,
          sent: 0,
          skipped: skippedCount,
          errors: 0,
          force,
          dry,
        });
        summary.details.push({ org: orgId, skipped: "no_reopen_stamp", leads: group.leads.length });
        continue;
      }

      stage = "filter_leads";
      const eligible = group.leads.filter((row) => {
        const property = firstRelation(row.properties);
        return isReopenLeadEligible({
          noSuitableTime: row.no_suitable_time === true,
          status: row.status ?? "",
          propertyStatus: property?.status ?? null,
          createdAtMs: parseTimeMs(row.created_at),
          nowMs,
          reopenNotifiedAtMs: force ? null : parseTimeMs(row.reopen_notified_at),
          reopenedAtMs,
        });
      });
      eligibleCount = eligible.length;
      skippedCount += group.leads.length - eligible.length;

      if (eligible.length === 0) {
        summary.skipped += group.leads.length;
        logOrgReopenResult({
          orgId,
          outcome: "no_eligible_leads",
          eligible: 0,
          open,
          toNotify: 0,
          sent: 0,
          skipped: group.leads.length,
          errors: 0,
          force,
          dry,
        });
        summary.details.push({ org: orgId, skipped: "no_eligible_leads", leads: group.leads.length });
        continue;
      }

      const lookaheadDays = positiveInt(
        org.availability_tripwire_lookahead_days,
        DEFAULT_LOOKAHEAD_DAYS,
      );
      const endIso = new Date(nowMs + lookaheadDays * DAY_MS).toISOString();

      stage = "load_availability";
      const [
        { data: ruleRows, error: ruleErr },
        { data: dayOffRows, error: dayOffErr },
        { data: overrideRows, error: overrideErr },
        { data: futureShowingRows, error: futureShowingErr },
      ] = await Promise.all([
        admin
          .from("availability_rules")
          .select("weekday, start_minute, end_minute, created_at")
          .eq("organization_id", orgId),
        admin
          .from("availability_days_off")
          .select("day, created_at")
          .eq("organization_id", orgId),
        admin
          .from("availability_overrides")
          .select("day, start_minute, end_minute, created_at")
          .eq("organization_id", orgId),
        admin
          .from("showings")
          .select("scheduled_at")
          .eq("organization_id", orgId)
          .gte("scheduled_at", now.toISOString())
          .lt("scheduled_at", endIso)
          .or("outcome.is.null,outcome.eq.scheduled")
          .order("scheduled_at", { ascending: true }),
      ]);
      if (ruleErr) throw new Error(`rules:${ruleErr.message}`);
      if (dayOffErr) throw new Error(`days_off:${dayOffErr.message}`);
      if (overrideErr) throw new Error(`overrides:${overrideErr.message}`);
      if (futureShowingErr) {
        throw new Error(`future_showings:${futureShowingErr.message}`);
      }

      stage = "compute";
      const rules = (ruleRows ?? []) as AvailabilityRuleRow[];
      const daysOff = (dayOffRows ?? []) as AvailabilityDayOffRow[];
      const overrides = (overrideRows ?? []) as AvailabilityOverrideRow[];
      const booked = ((futureShowingRows ?? []) as FutureShowingRow[])
        .map((r) => r.scheduled_at)
        .filter((iso): iso is string => typeof iso === "string" && iso !== "")
        .sort();
      const availability: Availability = {
        timezone: org.booking_timezone || "America/Toronto",
        slot_minutes: positiveInt(org.booking_slot_minutes, 30),
        lead_hours:
          typeof org.booking_lead_hours === "number" &&
          Number.isFinite(org.booking_lead_hours) &&
          org.booking_lead_hours >= 0
            ? org.booking_lead_hours
            : 12,
        horizon_days: positiveInt(org.booking_horizon_days, 14),
        rules: rules.map((r) => ({
          weekday: r.weekday,
          start_minute: r.start_minute,
          end_minute: r.end_minute,
        })),
        booked,
        days_off: daysOff.map((r) => String(r.day)),
        overrides: overrides.map((r) => ({
          day: String(r.day),
          start_minute: r.start_minute,
          end_minute: r.end_minute,
        })),
      };

      open = countOpenBookableSlots(availability, now, lookaheadDays);
      const toNotify = reopenLeadsToNotify(open, eligible);
      toNotifyCount = toNotify.length;
      skippedCount += eligible.length - toNotify.length;

      if (dry) {
        summary.sent += toNotify.length;
        summary.skipped += skippedCount;
        logOrgReopenResult({
          orgId,
          outcome: toNotify.length > 0 ? "dry_would_send" : "dry_skipped",
          eligible: eligibleCount,
          open,
          toNotify: toNotifyCount,
          sent: toNotify.length,
          skipped: skippedCount,
          errors: 0,
          force,
          dry,
        });
        summary.details.push({
          org: orgId,
          dry: true,
          force,
          reopened_at: org.availability_reopened_at,
          eligible: eligible.length,
          open,
          would_send: toNotify.length,
          lead_ids: toNotify.map((row) => row.id),
        });
        continue;
      }

      if (toNotify.length === 0) {
        summary.skipped += group.leads.length;
        logOrgReopenResult({
          orgId,
          outcome: open < 1 ? "no_open_slots" : "no_leads_after_cap",
          eligible: eligibleCount,
          open,
          toNotify: 0,
          sent: 0,
          skipped: group.leads.length,
          errors: 0,
          force,
          dry,
        });
        summary.details.push({
          org: orgId,
          skipped: open < 1 ? "no_open_slots" : "no_leads_after_cap",
          eligible: eligible.length,
          open,
        });
        continue;
      }

      stage = "send_leads";
      for (const row of toNotify) {
        try {
          const property = firstRelation(row.properties);
          if (!row.property_id || !property) {
            skippedCount++;
            summary.details.push({ lead: row.id, skipped: "missing_property" });
            continue;
          }

          const result = await sendViewingTimesOpenedEmail({
            lead_id: row.id,
            property_id: row.property_id,
            renter_name: row.name ?? null,
            renter_email: row.email ?? null,
            org_name: org.name ?? null,
            brand_color: org.brand_color ?? null,
            logo_url: org.logo_url ?? null,
            reply_to_email: org.reply_to_email ?? null,
            property_address: property.address ?? null,
            rent_cents: property.rent_cents ?? null,
          });

          if (!result.sent) {
            errorCount++;
            summary.errors++;
            summary.details.push({ lead: row.id, error: result.reason });
            continue;
          }

          const sentAt = new Date().toISOString();
          const { error: stampErr } = await admin
            .from("leads")
            .update({
              reopen_notified_at: sentAt,
              nurture_last_sent_at: sentAt,
            })
            .eq("id", row.id);

          if (stampErr) {
            errorCount++;
            summary.errors++;
            summary.details.push({ lead: row.id, error: `stamp_failed:${stampErr.message}` });
            continue;
          }

          const { error: messageErr } = await admin.from("messages").insert({
            organization_id: row.organization_id,
            lead_id: row.id,
            channel: "email",
            direction: "outbound",
            body: "Notified — new viewing times opened",
          });
          if (messageErr) {
            errorCount++;
            summary.errors++;
            summary.details.push({ lead: row.id, error: `timeline_failed:${messageErr.message}` });
          }

          sentCount++;
          summary.sent++;
          summary.details.push({
            lead: row.id,
            sent: true,
            subject: result.subject,
            stamped_reopen_notified_at: sentAt,
          });
        } catch (err) {
          const msg = safeErrorMessage(err);
          errorCount++;
          summary.errors++;
          summary.details.push({ lead: row.id, error: `lead_threw:${msg}` });
        }
      }

      summary.skipped += skippedCount;
      logOrgReopenResult({
        orgId,
        outcome: sentCount > 0 ? "sent" : "no_sends",
        eligible: eligibleCount,
        open,
        toNotify: toNotifyCount,
        sent: sentCount,
        skipped: skippedCount,
        errors: errorCount,
        force,
        dry,
      });
    } catch (err) {
      const msg = safeErrorMessage(err);
      console.error(
        `[availability-reopened-notify] org=${orgId} stage=${stage} threw=${msg}`,
      );
      summary.errors++;
      summary.details.push({ org: orgId, stage, error: `org_threw:${msg}` });
    }
  }

  console.log(
    `[availability-reopened-notify] summary scanned=${summary.scanned} sent=${summary.sent} skipped=${summary.skipped} errors=${summary.errors} orgIds=${Array.from(groups.keys()).join(",")}`,
  );

  return NextResponse.json(summary, { status: 200 });
}
