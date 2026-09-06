// Unit tests for the stuck-item backlog sweep (S681).
// Run: npx tsx scripts/test-distribution-stuck-sweep.ts
//
// The defect these lock down: leasing.distribution_job_needs_action only fired
// at the instant the cron moved an item to its gate, so nine already-parked
// items went unmentioned for up to 54 days, including a concierge request that
// could never be claimed at all.
import {
  daysParked,
  parkedSinceMs,
  selectStuckToAlert,
  shouldAlert,
  stuckKind,
  MAX_ALERTS_PER_SWEEP,
  RENAG_AFTER_DAYS,
  STUCK_AFTER_HOURS,
  STUCK_GATE_LABEL,
  STUCK_NEXT_STEP,
  type StuckCandidate,
} from "../lib/distribution-stuck-sweep";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${name}`);
  }
}

const NOW = Date.parse("2026-09-06T00:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

function row(over: Partial<StuckCandidate> = {}): StuckCandidate {
  return {
    id: "i1",
    organization_id: "o1",
    run_id: "r1",
    channel: "kijiji",
    publish_status: "needs_payment",
    mode: "concierge",
    created_at: daysAgo(10),
    updated_at: daysAgo(10),
    last_stuck_alerted_at: null,
    ...over,
  };
}

// --- stuckKind -------------------------------------------------------------
ok("needs_login is a gate", stuckKind(row({ publish_status: "needs_login" })) === "needs_login");
ok("needs_payment is a gate", stuckKind(row({ publish_status: "needs_payment" })) === "needs_payment");
ok("needs_operator is a gate", stuckKind(row({ publish_status: "needs_operator" })) === "needs_operator");
ok(
  "queued concierge is the unclaimed case (the 48-day one)",
  stuckKind(row({ publish_status: "queued", mode: "concierge" })) === "unclaimed_concierge",
);
ok(
  "queued in another mode is ordinary pipeline state, not stuck",
  stuckKind(row({ publish_status: "queued", mode: "automatic" })) === null,
);
ok("live is never stuck", stuckKind(row({ publish_status: "live" })) === null);
ok("failed is never stuck", stuckKind(row({ publish_status: "failed" })) === null);
ok("null status is never stuck", stuckKind(row({ publish_status: null })) === null);

// --- shouldAlert: age ------------------------------------------------------
ok(
  "an item parked under the threshold is in flight, not stuck",
  !shouldAlert(row({ updated_at: hoursAgo(STUCK_AFTER_HOURS - 1) }), NOW),
);
ok(
  "an item parked past the threshold alerts",
  shouldAlert(row({ updated_at: hoursAgo(STUCK_AFTER_HOURS + 1) }), NOW),
);

// --- shouldAlert: re-nag ---------------------------------------------------
ok(
  "never alerted means say it once",
  shouldAlert(row({ last_stuck_alerted_at: null }), NOW),
);
ok(
  "alerted yesterday stays quiet (no daily spam)",
  !shouldAlert(row({ last_stuck_alerted_at: daysAgo(1) }), NOW),
);
ok(
  "past the re-nag interval it speaks again",
  shouldAlert(row({ last_stuck_alerted_at: daysAgo(RENAG_AFTER_DAYS + 1) }), NOW),
);
ok(
  "exactly at the re-nag interval it speaks",
  shouldAlert(row({ last_stuck_alerted_at: daysAgo(RENAG_AFTER_DAYS) }), NOW),
);

// --- timestamps ------------------------------------------------------------
ok(
  "falls back to created_at when never updated",
  parkedSinceMs(row({ updated_at: null, created_at: daysAgo(5) })) === Date.parse(daysAgo(5)),
);
ok(
  "unparseable timestamps never alert rather than throwing",
  !shouldAlert(row({ updated_at: "not-a-date", created_at: "also-not" }), NOW),
);
ok("daysParked counts whole days", daysParked(row({ updated_at: daysAgo(54) }), NOW) === 54);

// --- selection: ordering and cap ------------------------------------------
{
  // Distinct orgs on purpose: this case tests ORDERING. The one-per-org rule is
  // tested separately below, and would otherwise collapse these to a single row.
  const rows: StuckCandidate[] = [
    row({ id: "new", organization_id: "o-new", updated_at: daysAgo(2) }),
    row({ id: "oldest", organization_id: "o-old", updated_at: daysAgo(54) }),
    row({ id: "mid", organization_id: "o-mid", updated_at: daysAgo(28) }),
  ];
  const picked = selectStuckToAlert(rows, NOW).map((r) => r.id);
  ok("oldest parked is reported first", picked[0] === "oldest");
  ok("then the middle one", picked[1] === "mid");
  ok("all three are due", picked.length === 3);
}

{
  const many: StuckCandidate[] = Array.from({ length: 20 }, (_, i) =>
    row({ id: `i${i}`, organization_id: `org${i}`, updated_at: daysAgo(30 + i) }),
  );
  ok(
    "one sweep can never blast an inbox",
    selectStuckToAlert(many, NOW).length === MAX_ALERTS_PER_SWEEP,
  );
  ok("an explicit cap is honoured", selectStuckToAlert(many, NOW, 2).length === 2);
  ok("a zero cap sends nothing", selectStuckToAlert(many, NOW, 0).length === 0);
}

// --- one alert per org: the real-backlog bug the first audit caught ---------
{
  // Shaped like production on 2026-09-06: one org owns the nine oldest items,
  // and three other orgs sit behind it. Oldest-first alone would spend the whole
  // cap on the noisy org and never mention the others.
  const noisy: StuckCandidate[] = Array.from({ length: 9 }, (_, i) =>
    row({ id: `qa${i}`, organization_id: "qa-org", updated_at: daysAgo(54) }),
  );
  const rows: StuckCandidate[] = [
    ...noisy,
    row({ id: "abbas", organization_id: "abbas-org", updated_at: daysAgo(48) }),
    row({ id: "agile", organization_id: "agile-org", updated_at: daysAgo(28) }),
    row({ id: "growth", organization_id: "growth-org", updated_at: daysAgo(31) }),
  ];
  const picked = selectStuckToAlert(rows, NOW);
  const orgs = picked.map((r) => r.organization_id);

  ok("every affected org is surfaced on the FIRST run", orgs.length === 4);
  ok("no org appears twice in one sweep", new Set(orgs).size === orgs.length);
  ok("the noisy org gets exactly one slot, not nine", orgs.filter((o) => o === "qa-org").length === 1);
  ok("a real customer is reached on run one", orgs.includes("abbas-org"));
  ok("and so is Agile", orgs.includes("agile-org"));
  ok("orgs are still ordered oldest-first", orgs[0] === "qa-org" && orgs[1] === "abbas-org");
  ok(
    "the item chosen for an org is that org's OLDEST",
    picked.find((r) => r.organization_id === "qa-org")?.id === "qa0",
  );
}

ok(
  "a live item is never selected however old",
  selectStuckToAlert([row({ publish_status: "live", updated_at: daysAgo(99) })], NOW).length === 0,
);

// --- copy ------------------------------------------------------------------
ok(
  "every kind has a next step and a gate label",
  (["needs_login", "needs_payment", "needs_operator", "unclaimed_concierge"] as const).every(
    (k) => STUCK_NEXT_STEP[k].length > 0 && STUCK_GATE_LABEL[k].length > 0,
  ),
);
ok(
  "the unclaimed case names the real cause rather than blaming the operator",
  /nobody has picked this up/i.test(STUCK_NEXT_STEP.unclaimed_concierge) &&
    /authoriz/i.test(STUCK_NEXT_STEP.unclaimed_concierge),
);

console.log(`\ndistribution-stuck-sweep: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
