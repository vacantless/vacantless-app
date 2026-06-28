// Unit tests for the pure document-retention purge model.
// Run: npx tsx scripts/test-document-retention.ts
import {
  RETENTION_GRACE_DAYS,
  retentionUntil,
  effectiveRetentionUntilMs,
  isDueForPurge,
  dueForPurge,
  PENDING_CAPTURE_GRACE_HOURS,
  pendingCaptureUntil,
  isReapablePendingCapture,
  dueForReapPendingCaptures,
} from "../lib/document-retention";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date("2026-06-01T00:00:00.000Z");
const t0 = T0.getTime();

// --- retentionUntil ---------------------------------------------------------
ok("grace window is 30 days", RETENTION_GRACE_DAYS === 30);
ok(
  "retentionUntil = deletedAt + 30d",
  retentionUntil(T0) === new Date(t0 + 30 * DAY).toISOString(),
);
ok(
  "retentionUntil accepts ISO string",
  retentionUntil(T0.toISOString()) === new Date(t0 + 30 * DAY).toISOString(),
);
ok(
  "retentionUntil custom grace",
  retentionUntil(T0, 7) === new Date(t0 + 7 * DAY).toISOString(),
);
ok(
  "retentionUntil negative grace falls back to default",
  retentionUntil(T0, -5) === new Date(t0 + 30 * DAY).toISOString(),
);

// --- effectiveRetentionUntilMs ----------------------------------------------
ok(
  "live doc (no deleted_at) has no anchor",
  effectiveRetentionUntilMs({ deleted_at: null, retention_until: null }) === null,
);
ok(
  "live doc ignores stray retention_until",
  effectiveRetentionUntilMs({ deleted_at: null, retention_until: T0.toISOString() }) === null,
);
ok(
  "explicit retention_until wins",
  effectiveRetentionUntilMs({
    deleted_at: T0.toISOString(),
    retention_until: new Date(t0 + 5 * DAY).toISOString(),
  }) === t0 + 5 * DAY,
);
ok(
  "null retention_until falls back to deleted_at + grace",
  effectiveRetentionUntilMs({ deleted_at: T0.toISOString(), retention_until: null }) ===
    t0 + 30 * DAY,
);
ok(
  "garbage retention_until falls back to deleted_at + grace",
  effectiveRetentionUntilMs({ deleted_at: T0.toISOString(), retention_until: "not-a-date" }) ===
    t0 + 30 * DAY,
);

// --- isDueForPurge ----------------------------------------------------------
const deletedAtT0 = { deleted_at: T0.toISOString(), retention_until: null };

ok(
  "not due one day before the window closes",
  !isDueForPurge(deletedAtT0, new Date(t0 + 29 * DAY)),
);
ok(
  "due exactly at the window edge (<=)",
  isDueForPurge(deletedAtT0, new Date(t0 + 30 * DAY)),
);
ok(
  "due well past the window",
  isDueForPurge(deletedAtT0, new Date(t0 + 100 * DAY)),
);
ok(
  "live doc is never due",
  !isDueForPurge({ deleted_at: null, retention_until: null }, new Date(t0 + 1000 * DAY)),
);
ok(
  "explicit retention_until in the future blocks purge",
  !isDueForPurge(
    { deleted_at: T0.toISOString(), retention_until: new Date(t0 + 90 * DAY).toISOString() },
    new Date(t0 + 31 * DAY),
  ),
);
ok(
  "explicit retention_until already past => due",
  isDueForPurge(
    { deleted_at: T0.toISOString(), retention_until: new Date(t0 + 1 * DAY).toISOString() },
    new Date(t0 + 2 * DAY),
  ),
);

// --- dueForPurge (batch) ----------------------------------------------------
const batch = [
  { id: "live", deleted_at: null, retention_until: null },
  { id: "fresh", deleted_at: new Date(t0 - 1 * DAY).toISOString(), retention_until: null },
  { id: "ripe", deleted_at: new Date(t0 - 40 * DAY).toISOString(), retention_until: null },
  {
    id: "held",
    deleted_at: new Date(t0 - 40 * DAY).toISOString(),
    retention_until: new Date(t0 + 10 * DAY).toISOString(),
  },
];
const due = dueForPurge(batch, T0).map((d) => d.id);
ok("batch selects only the ripe doc", due.length === 1 && due[0] === "ripe");

// --- Pending scan-capture reap (S365 Phase 2) -------------------------------
const HOUR = 60 * 60 * 1000;
ok("pending grace is 6 hours", PENDING_CAPTURE_GRACE_HOURS === 6);
ok(
  "pendingCaptureUntil = storedAt + 6h",
  pendingCaptureUntil(T0) === new Date(t0 + 6 * HOUR).toISOString(),
);
ok(
  "pendingCaptureUntil honours override hours",
  pendingCaptureUntil(T0, 1) === new Date(t0 + 1 * HOUR).toISOString(),
);

// A fresh capture (pending, unlinked, not deleted) is NOT yet reapable.
ok(
  "fresh pending capture not reapable",
  !isReapablePendingCapture(
    { pending_until: pendingCaptureUntil(T0), appliance_id: null, deleted_at: null },
    new Date(t0 + 1 * HOUR),
  ),
);
// Past its window => reapable.
ok(
  "elapsed pending capture is reapable",
  isReapablePendingCapture(
    { pending_until: pendingCaptureUntil(T0), appliance_id: null, deleted_at: null },
    new Date(t0 + 7 * HOUR),
  ),
);
// Promoted (pending_until null) => never reapable, even past any time.
ok(
  "promoted receipt never reapable",
  !isReapablePendingCapture(
    { pending_until: null, appliance_id: "app1", deleted_at: null },
    new Date(t0 + 100 * HOUR),
  ),
);
// Linked but pending_until somehow still set => not reapable (guard on appliance_id).
ok(
  "linked capture not reapable",
  !isReapablePendingCapture(
    { pending_until: pendingCaptureUntil(T0), appliance_id: "app1", deleted_at: null },
    new Date(t0 + 7 * HOUR),
  ),
);
// S366: linked to an EXPENSE (not an appliance) but pending_until still set =>
// not reapable (guard on expense_id, the second confirm path).
ok(
  "expense-linked capture not reapable",
  !isReapablePendingCapture(
    { pending_until: pendingCaptureUntil(T0), appliance_id: null, expense_id: "exp1", deleted_at: null },
    new Date(t0 + 7 * HOUR),
  ),
);
// Soft-deleted => the purge's job, not the reaper's.
ok(
  "soft-deleted pending row not reapable (purge handles it)",
  !isReapablePendingCapture(
    { pending_until: pendingCaptureUntil(T0), appliance_id: null, deleted_at: T0.toISOString() },
    new Date(t0 + 7 * HOUR),
  ),
);
// A non-pending row (pending_until null, no link) => not reapable.
ok(
  "non-pending live doc not reapable",
  !isReapablePendingCapture(
    { pending_until: null, appliance_id: null, deleted_at: null },
    new Date(t0 + 7 * HOUR),
  ),
);

// Batch: only the elapsed, unlinked, not-deleted pending capture is reaped.
const pendBatch = [
  { id: "fresh", pending_until: pendingCaptureUntil(T0), appliance_id: null, deleted_at: null },
  { id: "ripe", pending_until: pendingCaptureUntil(new Date(t0 - 10 * HOUR)), appliance_id: null, deleted_at: null },
  { id: "promoted", pending_until: null, appliance_id: "a1", deleted_at: null },
  { id: "expense-linked", pending_until: pendingCaptureUntil(new Date(t0 - 10 * HOUR)), appliance_id: null, expense_id: "e1", deleted_at: null },
  { id: "deleted", pending_until: pendingCaptureUntil(new Date(t0 - 10 * HOUR)), appliance_id: null, deleted_at: T0.toISOString() },
];
const reap = dueForReapPendingCaptures(pendBatch, T0).map((d) => d.id);
ok("batch reaps only the ripe unconfirmed capture", reap.length === 1 && reap[0] === "ripe");

// ---------------------------------------------------------------------------
console.log(`\ndocument-retention: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
