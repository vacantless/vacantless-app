// Pure tenant-comms outbox domain helpers. The scheduler itself lives in
// server actions and cron; this module mirrors the DB status checks and keeps
// the flag reader tiny and explicit.

export const UNDO_WINDOW_SECONDS = 30;
export const MAX_SCHEDULE_HORIZON_DAYS = 90;

export const SCHEDULED_MESSAGE_STATUSES = [
  "scheduled",
  "sending",
  "sent",
  "canceled",
  "failed",
] as const;
export type ScheduledMessageStatus = (typeof SCHEDULED_MESSAGE_STATUSES)[number];

const HORIZON_MS = MAX_SCHEDULE_HORIZON_DAYS * 24 * 60 * 60 * 1000;
const MIN_FUTURE_SKEW_MS = 1000;

export function tenantCommsOutboxEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.TENANT_COMMS_OUTBOX_ENABLED === "true";
}

export function canCancel(status: ScheduledMessageStatus): boolean {
  return status === "scheduled";
}

export function isDue(scheduledSendAtMs: number, nowMs: number): boolean {
  return scheduledSendAtMs <= nowMs;
}

export function validateScheduledSendAt(
  input: string | null | undefined,
  nowMs: number,
):
  | { ok: true; value: { atMs: number } }
  | { ok: false; code: "invalid" | "in_past" | "too_far" } {
  const raw = (input ?? "").trim();
  if (!raw) return { ok: false, code: "invalid" };

  const atMs = new Date(raw).getTime();
  if (!Number.isFinite(atMs)) return { ok: false, code: "invalid" };
  if (atMs < nowMs + MIN_FUTURE_SKEW_MS) return { ok: false, code: "in_past" };
  if (atMs > nowMs + HORIZON_MS) return { ok: false, code: "too_far" };

  return { ok: true, value: { atMs } };
}
