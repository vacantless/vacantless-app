// Run: npx tsx scripts/test-availability-reopen.ts

import {
  isReopenLeadEligible,
  REOPEN_NOTIFY_MAX_PER_ORG,
  reopenLeadsToNotify,
} from "../lib/availability-reopen";
import { NURTURE_MAX_AGE_MS } from "../lib/nurture";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${name}`);
  }
}

const nowMs = Date.parse("2026-07-18T16:00:00.000Z");
const createdAtMs = nowMs - 3 * 24 * 3_600_000;
const reopenedAtMs = nowMs - 60_000;

function eligible(
  overrides: Partial<Parameters<typeof isReopenLeadEligible>[0]> = {},
) {
  return isReopenLeadEligible({
    noSuitableTime: true,
    status: "new",
    propertyStatus: "available",
    createdAtMs,
    nowMs,
    reopenNotifiedAtMs: null,
    reopenedAtMs,
    ...overrides,
  });
}

ok("eligible: positive waiting lead", eligible());
ok("eligible: rejects normal inquiry", !eligible({ noSuitableTime: false }));
ok("eligible: rejects booked lead", !eligible({ status: "booked" }));
ok("eligible: rejects lost lead", !eligible({ status: "lost" }));
ok(
  "eligible: rejects unavailable property",
  !eligible({ propertyStatus: "leased" }),
);
ok(
  "eligible: rejects stale lead",
  !eligible({ createdAtMs: nowMs - NURTURE_MAX_AGE_MS - 1 }),
);
ok(
  "eligible: rejects org with no reopen stamp",
  !eligible({ reopenedAtMs: null }),
);
ok(
  "eligible: rejects already notified lead",
  !eligible({ reopenNotifiedAtMs: reopenedAtMs }),
);
ok(
  "eligible: accepts lead notified before this reopen",
  eligible({ reopenNotifiedAtMs: reopenedAtMs - 1 }),
);

{
  const stampedMs = reopenedAtMs + 1;
  ok(
    "once-per-reopen: stamped lead is ineligible for same reopen",
    !eligible({ reopenNotifiedAtMs: stampedMs }),
  );
  ok(
    "once-per-reopen: newer reopen makes lead eligible again",
    eligible({ reopenNotifiedAtMs: stampedMs, reopenedAtMs: stampedMs + 1 }),
  );
}

const sample = Array.from({ length: 40 }, (_, i) => i + 1);
ok(
  "open guard: no open slots returns nothing",
  reopenLeadsToNotify(0, sample).length === 0,
);
ok(
  "open guard: open slots returns eligible leads",
  reopenLeadsToNotify(5, sample).length === REOPEN_NOTIFY_MAX_PER_ORG,
);
ok(
  "cap: forty eligible leads caps at max per org",
  reopenLeadsToNotify(5, sample).length === REOPEN_NOTIFY_MAX_PER_ORG,
);
ok(
  "cap: fewer than max keeps all eligible leads",
  reopenLeadsToNotify(5, sample.slice(0, 3)).length === 3,
);

console.log(`\navailability-reopen: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
