// Unit tests for the pure document-retention purge model.
// Run: npx tsx scripts/test-document-retention.ts
import {
  RETENTION_GRACE_DAYS,
  retentionUntil,
  effectiveRetentionUntilMs,
  isDueForPurge,
  dueForPurge,
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

// ---------------------------------------------------------------------------
console.log(`\ndocument-retention: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
