// Pure tests for the near-100% Launch coverage map.
// Run: npx tsx scripts/test-distribution-launch-coverage.ts

import { DISTRIBUTION_CHANNELS } from "../lib/distribution-channels";
import {
  WORKER_SCRIPT_BY_CHANNEL,
  launchCoverageRows,
  summarizeLaunchCoverage,
} from "../lib/distribution-launch-coverage";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${name}`, detail ?? "");
  }
}

function sameArray(
  name: string,
  actual: readonly string[],
  expected: readonly string[],
) {
  ok(
    `${name}: expected ${expected.join(",")} got ${actual.join(",")}`,
    actual.length === expected.length &&
      actual.every((value, index) => value === expected[index]),
  );
}

const rows = launchCoverageRows();
const byKey = new Map(rows.map((row) => [row.key, row]));
const summary = summarizeLaunchCoverage(rows);
type CoverageKey = (typeof rows)[number]["key"];

ok("coverage row for every distribution channel", rows.length === DISTRIBUTION_CHANNELS.length);
ok("operator coverage reaches every catalog channel", summary.operatorCoveragePercent === 100, summary);
ok("coverage does not pretend every channel is unattended", summary.unattendedLiveCandidates < summary.total, summary);

sameArray(
  "machine-backed channels are the current API/worker-backed set",
  rows.filter((row) => row.machineBacked).map((row) => row.key),
  [
    "kijiji",
    "rentals_ca",
    "rentfaster",
    "zumper",
    "viewit",
    "facebook_feed",
    "instagram",
  ],
);

sameArray(
  "unattended live candidates exclude paid stops and manual proof lanes",
  rows.filter((row) => row.unattendedLiveCandidate).map((row) => row.key),
  ["kijiji", "rentals_ca", "zumper", "facebook_feed", "instagram"],
);

ok(
  "Facebook Marketplace is operator-ready through co-pilot, not silent automation",
  byKey.get("facebook")?.mechanism === "browser_copilot" &&
    byKey.get("facebook")?.level === "operator_ready" &&
    byKey.get("facebook")?.requiresHumanReview === true &&
    byKey.get("facebook")?.machineBacked === false,
);

ok(
  "Kijiji is backed by the free worker script",
  byKey.get("kijiji")?.mechanism === "headless_worker" &&
    byKey.get("kijiji")?.workerScript === WORKER_SCRIPT_BY_CHANNEL.kijiji,
);

ok(
  "RentFaster and Viewit stop at payment gate",
  byKey.get("rentfaster")?.mechanism === "paid_worker_stop" &&
    byKey.get("rentfaster")?.requiresPaymentGate === true &&
    byKey.get("viewit")?.mechanism === "paid_worker_stop" &&
    byKey.get("viewit")?.requiresPaymentGate === true,
);

ok(
  "commercial portals stay assist-gated",
  byKey.get("spacelist")?.mechanism === "commercial_assist" &&
    byKey.get("costar_loopnet")?.mechanism === "commercial_assist" &&
    byKey.get("costar_loopnet")?.requiresPaymentGate === true,
);

ok(
  "Realtor.ca remains broker handoff",
  byKey.get("realtor_ca")?.mechanism === "broker_handoff" &&
    byKey.get("realtor_ca")?.requiresBroker === true,
);

ok(
  "share/social planned lanes still produce tracked tasks",
  (["whatsapp", "linkedin", "snapchat"] as CoverageKey[]).every(
    (key) => byKey.get(key)?.mechanism === "share_task",
  ),
);

ok("three payment-gated coverage rows", summary.paymentGated === 3, summary);
ok("one broker handoff", summary.brokerHandoffs === 1, summary);

if (failed > 0) {
  console.error(`${passed} passed, ${failed} failed`);
  process.exit(1);
}

console.log(`distribution-launch-coverage: ${passed} passed, ${failed} failed`);
