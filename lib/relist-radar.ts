import { channelByKey } from "./distribution-channels";

export const RELIST_RADAR_TEST_ORG_ID = "8ea1da48-0cd2-45a4-bfba-023b31a67884";
export const RELIST_RADAR_BLOCKED_ORG_IDS = new Set([
  "921f7c08-98af-428f-a238-36f4a781b0de",
]);

export type RelistRadarSettings = {
  notify_lead_days: number;
  refresh_now_semantics: "confirm_run_on_scheduled_day";
  free_skip_behavior: "last_chance_then_lapse";
  paid_lapse_followup: "nudge";
  execution_time: "expiry_day_morning";
  email_grouping: "combined_per_property";
  autopilot_receipt: "monthly";
};

export const RELIST_RADAR_DEFAULT_SETTINGS: RelistRadarSettings = {
  notify_lead_days: 3,
  refresh_now_semantics: "confirm_run_on_scheduled_day",
  free_skip_behavior: "last_chance_then_lapse",
  paid_lapse_followup: "nudge",
  execution_time: "expiry_day_morning",
  email_grouping: "combined_per_property",
  autopilot_receipt: "monthly",
};

export type RelistRadarClockUpdate = {
  external_posted_at?: string;
  external_expires_at?: string | null;
};

export type RelistRadarClassification =
  | {
      kind: "radar_candidate";
      daysToExpiry: number;
      cycleDate: string;
    }
  | {
      kind:
        | "leased"
        | "not_available"
        | "unknown_ttl"
        | "missing_expiry"
        | "invalid_expiry"
        | "out_of_window";
      daysToExpiry: number | null;
      cycleDate: string | null;
    };

function clean(value: string | null | undefined): string | null {
  const v = String(value ?? "").trim();
  return v || null;
}

function positiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.trunc(value);
  return rounded > 0 ? rounded : null;
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function exactString<T extends string>(
  value: unknown,
  expected: T,
): T {
  return value === expected ? expected : expected;
}

function parseTime(value: string | null | undefined): number | null {
  const cleanValue = clean(value);
  if (!cleanValue) return null;
  const time = Date.parse(cleanValue);
  return Number.isNaN(time) ? null : time;
}

export function resolveRelistRadarSettings(
  settingsJson: unknown,
): RelistRadarSettings {
  const raw = jsonObject(settingsJson);
  return {
    notify_lead_days:
      positiveInteger(raw.notify_lead_days) ??
      RELIST_RADAR_DEFAULT_SETTINGS.notify_lead_days,
    refresh_now_semantics: exactString(
      raw.refresh_now_semantics,
      RELIST_RADAR_DEFAULT_SETTINGS.refresh_now_semantics,
    ),
    free_skip_behavior: exactString(
      raw.free_skip_behavior,
      RELIST_RADAR_DEFAULT_SETTINGS.free_skip_behavior,
    ),
    paid_lapse_followup: exactString(
      raw.paid_lapse_followup,
      RELIST_RADAR_DEFAULT_SETTINGS.paid_lapse_followup,
    ),
    execution_time: exactString(
      raw.execution_time,
      RELIST_RADAR_DEFAULT_SETTINGS.execution_time,
    ),
    email_grouping: exactString(
      raw.email_grouping,
      RELIST_RADAR_DEFAULT_SETTINGS.email_grouping,
    ),
    autopilot_receipt: exactString(
      raw.autopilot_receipt,
      RELIST_RADAR_DEFAULT_SETTINGS.autopilot_receipt,
    ),
  };
}

export function relistRadarOrgAllowed(organizationId: string | null | undefined): boolean {
  const orgId = clean(organizationId);
  return orgId === RELIST_RADAR_TEST_ORG_ID && !RELIST_RADAR_BLOCKED_ORG_IDS.has(orgId);
}

export function addDaysISO(nowISO: string, days: number): string | null {
  const time = parseTime(nowISO);
  if (time == null || !Number.isFinite(days)) return null;
  return new Date(time + Math.trunc(days) * 86_400_000).toISOString();
}

export function relistRadarCycleDate(expiresAt: string | null | undefined): string | null {
  const time = parseTime(expiresAt);
  if (time == null) return null;
  return new Date(time).toISOString().slice(0, 10);
}

export function daysToExpiry({
  nowISO,
  externalExpiresAt,
}: {
  nowISO: string;
  externalExpiresAt: string | null | undefined;
}): number | null {
  const now = parseTime(nowISO);
  const expires = parseTime(externalExpiresAt);
  if (now == null || expires == null) return null;
  return Math.ceil((expires - now) / 86_400_000);
}

export function buildRelistRadarClockUpdate({
  enabled,
  channel,
  nowISO,
  existingExternalPostedAt,
  existingExternalUrl,
  nextExternalUrl,
}: {
  enabled: boolean;
  channel: string | null | undefined;
  nowISO: string;
  existingExternalPostedAt: string | null | undefined;
  existingExternalUrl: string | null | undefined;
  nextExternalUrl: string | null | undefined;
}): RelistRadarClockUpdate {
  if (!enabled) return {};
  const channelMeta = channelByKey(channel);
  const liveUrl = clean(nextExternalUrl);
  if (!channelMeta || !liveUrl) return {};

  const priorPostedAt = clean(existingExternalPostedAt);
  const priorUrl = clean(existingExternalUrl);
  const freshPost = !priorPostedAt || priorUrl !== liveUrl;
  if (!freshPost) return {};

  return {
    external_posted_at: nowISO,
    external_expires_at:
      channelMeta.ttlDays == null ? null : addDaysISO(nowISO, channelMeta.ttlDays),
  };
}

export function classifyRelistRadarCandidate({
  nowISO,
  propertyStatus,
  externalExpiresAt,
  channelTtlDays,
  notifyLeadDays,
}: {
  nowISO: string;
  propertyStatus: string | null | undefined;
  externalExpiresAt: string | null | undefined;
  channelTtlDays: number | null | undefined;
  notifyLeadDays: number;
}): RelistRadarClassification {
  const status = clean(propertyStatus)?.toLowerCase() ?? null;
  if (status === "leased") {
    return { kind: "leased", daysToExpiry: null, cycleDate: null };
  }
  if (status !== "available") {
    return { kind: "not_available", daysToExpiry: null, cycleDate: null };
  }
  if (channelTtlDays == null) {
    return { kind: "unknown_ttl", daysToExpiry: null, cycleDate: null };
  }
  if (!clean(externalExpiresAt)) {
    return { kind: "missing_expiry", daysToExpiry: null, cycleDate: null };
  }

  const days = daysToExpiry({ nowISO, externalExpiresAt });
  const cycleDate = relistRadarCycleDate(externalExpiresAt);
  if (days == null || !cycleDate) {
    return { kind: "invalid_expiry", daysToExpiry: null, cycleDate: null };
  }
  if (days <= notifyLeadDays) {
    return { kind: "radar_candidate", daysToExpiry: days, cycleDate };
  }
  return { kind: "out_of_window", daysToExpiry: days, cycleDate };
}
