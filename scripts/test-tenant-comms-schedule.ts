import {
  SCHEDULED_MESSAGE_STATUSES,
  UNDO_WINDOW_SECONDS,
  canCancel,
  isDue,
  tenantCommsOutboxEnabled,
  validateScheduledSendAt,
} from "../lib/tenant-comms-schedule";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  x ${name}`);
  }
}

const now = Date.parse("2026-08-01T12:00:00.000Z");

ok("undo window is 30 seconds", UNDO_WINDOW_SECONDS === 30);
ok(
  "statuses mirror DB check",
  SCHEDULED_MESSAGE_STATUSES.join(",") === "scheduled,sending,sent,canceled,failed",
);

ok("env flag true only", tenantCommsOutboxEnabled({ TENANT_COMMS_OUTBOX_ENABLED: "true" }));
ok("env flag false when unset", !tenantCommsOutboxEnabled({}));
ok("env flag false for 1", !tenantCommsOutboxEnabled({ TENANT_COMMS_OUTBOX_ENABLED: "1" }));

ok("can cancel scheduled", canCancel("scheduled"));
ok("cannot cancel sending", !canCancel("sending"));
ok("cannot cancel sent", !canCancel("sent"));
ok("cannot cancel canceled", !canCancel("canceled"));
ok("cannot cancel failed", !canCancel("failed"));

ok("isDue at exact instant", isDue(now, now));
ok("isDue after instant", isDue(now - 1, now));
ok("not due before instant", !isDue(now + 1, now));

{
  const r = validateScheduledSendAt("not-a-date", now);
  ok("invalid date rejected", !r.ok && r.code === "invalid");
}
{
  const r = validateScheduledSendAt("", now);
  ok("blank date rejected", !r.ok && r.code === "invalid");
}
{
  const r = validateScheduledSendAt(new Date(now).toISOString(), now);
  ok("now rejected as past", !r.ok && r.code === "in_past");
}
{
  const r = validateScheduledSendAt(new Date(now + 999).toISOString(), now);
  ok("less than skew rejected", !r.ok && r.code === "in_past");
}
{
  const r = validateScheduledSendAt(new Date(now + 1000).toISOString(), now);
  ok("future at skew accepted", r.ok && r.value.atMs === now + 1000);
}
{
  const ninetyDays = 90 * 24 * 60 * 60 * 1000;
  const r = validateScheduledSendAt(new Date(now + ninetyDays).toISOString(), now);
  ok("90 day horizon accepted", r.ok);
}
{
  const ninetyDays = 90 * 24 * 60 * 60 * 1000;
  const r = validateScheduledSendAt(new Date(now + ninetyDays + 1).toISOString(), now);
  ok("beyond horizon rejected", !r.ok && r.code === "too_far");
}

if (failed > 0) {
  console.error(`tenant-comms-schedule: ${passed} passed, ${failed} failed`);
  process.exit(1);
}

console.log(`tenant-comms-schedule: ${passed} passed, 0 failed`);
