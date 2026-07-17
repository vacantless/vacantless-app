// Unit tests for the pure dashboard assigned-view resolver.
// Run: npx tsx scripts/test-dashboard-assigned.ts
import { resolveAssignedView } from "../lib/dashboard-assigned";

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

ok(
  "unlinked defaults to team with no param",
  resolveAssignedView({ hasLinkedAgent: false, param: undefined }) === "team",
);
ok(
  "unlinked ignores mine param",
  resolveAssignedView({ hasLinkedAgent: false, param: "mine" }) === "team",
);
ok(
  "unlinked ignores team param",
  resolveAssignedView({ hasLinkedAgent: false, param: "team" }) === "team",
);
ok(
  "linked defaults to mine",
  resolveAssignedView({ hasLinkedAgent: true, param: undefined }) === "mine",
);
ok(
  "linked team param selects team",
  resolveAssignedView({ hasLinkedAgent: true, param: "team" }) === "team",
);
ok(
  "linked mine param selects mine",
  resolveAssignedView({ hasLinkedAgent: true, param: "mine" }) === "mine",
);
ok(
  "linked unknown param falls back to mine",
  resolveAssignedView({ hasLinkedAgent: true, param: "banana" }) === "mine",
);
ok(
  "linked array param uses first value",
  resolveAssignedView({ hasLinkedAgent: true, param: ["team", "mine"] }) ===
    "team",
);
ok(
  "unlinked ignores preferred mine",
  resolveAssignedView({
    hasLinkedAgent: false,
    param: undefined,
    preferred: "mine",
  }) === "team",
);
ok(
  "unlinked ignores preferred team",
  resolveAssignedView({
    hasLinkedAgent: false,
    param: "mine",
    preferred: "team",
  }) === "team",
);
ok(
  "linked uses preferred team when no param",
  resolveAssignedView({
    hasLinkedAgent: true,
    param: undefined,
    preferred: "team",
  }) === "team",
);
ok(
  "linked uses preferred mine when no param",
  resolveAssignedView({
    hasLinkedAgent: true,
    param: undefined,
    preferred: "mine",
  }) === "mine",
);
ok(
  "linked preferred null falls back to mine",
  resolveAssignedView({
    hasLinkedAgent: true,
    param: undefined,
    preferred: null,
  }) === "mine",
);
ok(
  "linked preferred omitted falls back to mine",
  resolveAssignedView({ hasLinkedAgent: true, param: undefined }) === "mine",
);
ok(
  "linked explicit mine wins over preferred team",
  resolveAssignedView({
    hasLinkedAgent: true,
    param: "mine",
    preferred: "team",
  }) === "mine",
);
ok(
  "linked explicit team wins over preferred mine",
  resolveAssignedView({
    hasLinkedAgent: true,
    param: "team",
    preferred: "mine",
  }) === "team",
);

console.log(`\ndashboard-assigned: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
