// Unit tests for the pure distribution-run helpers.
// Run: npx tsx scripts/test-distribution-run.ts
import {
  RUN_ITEM_STATUSES,
  runItemStatusLabel,
  isRunItemStatus,
  normalizeRunItemStatus,
  isResolvedRunStatus,
  buildRunSteps,
  runProgress,
  selectableRunChannels,
} from "../lib/distribution-run";
import { DISTRIBUTION_CHANNELS } from "../lib/distribution-channels";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

// --- status ----------------------------------------------------------------
ok("4 run-item statuses", RUN_ITEM_STATUSES.length === 4);
ok("label done", runItemStatusLabel("done") === "Done");
ok("label junk -> Not started", runItemStatusLabel("???") === "Not started");
ok("isRunItemStatus true", isRunItemStatus("in_progress"));
ok("isRunItemStatus false", !isRunItemStatus("nope"));
ok("normalize junk -> pending", normalizeRunItemStatus("x") === "pending");
ok("resolved: done", isResolvedRunStatus("done"));
ok("resolved: skipped", isResolvedRunStatus("skipped"));
ok("not resolved: pending", !isResolvedRunStatus("pending"));
ok("not resolved: in_progress", !isResolvedRunStatus("in_progress"));

// --- steps -----------------------------------------------------------------
{
  const fb = buildRunSteps("facebook", { guardrailCount: 5 });
  ok("facebook has an open step first", fb[0].key === "open");
  ok("facebook has a copy-title step", fb.some((s) => s.key === "title"));
  ok(
    "facebook photo step mentions duplicate/QR",
    fb.some((s) => s.key === "photos" && /duplicate|QR/.test(s.detail ?? "")),
  );
  ok(
    "facebook includes a gotchas step when guardrails > 0",
    fb.some((s) => s.key === "gotchas" && s.label.includes("5")),
  );
  ok("facebook ends with paste_url", fb[fb.length - 1].key === "paste_url");
}
{
  const fbNoGuard = buildRunSteps("facebook", { guardrailCount: 0 });
  ok(
    "no gotchas step when guardrailCount 0",
    !fbNoGuard.some((s) => s.key === "gotchas"),
  );
}
{
  const realtor = buildRunSteps("realtor_ca");
  ok("broker route: no copy-title step", !realtor.some((s) => s.key === "title"));
  ok("broker route: brief the agent", realtor[0].key === "brief_agent");
  ok(
    "broker route: confirm-live paste step",
    realtor.some((s) => s.key === "confirm_live"),
  );
}
{
  const other = buildRunSteps("other");
  ok("other uses generic portal label", other[0].label.includes("the portal"));
  ok("other ends with paste_url", other[other.length - 1].key === "paste_url");
}
{
  const vacantless = buildRunSteps("vacantless");
  ok("vacantless has public-page step", vacantless[0].key === "publish_page");
  ok(
    "vacantless step does not say portal",
    !vacantless.some((s) => /portal/i.test(`${s.label} ${s.detail ?? ""}`)),
  );
}
{
  const orgFeed = buildRunSteps("org_feed");
  ok("org feed has feed-ready step", orgFeed[0].key === "check_feed_ready");
}
{
  const noEmDash = buildRunSteps("kijiji", { guardrailCount: 2 })
    .flatMap((s) => [s.label, s.detail ?? ""])
    .join(" ");
  ok("no em dashes in step copy", !/[—–]/.test(noEmDash));
}

// --- progress --------------------------------------------------------------
{
  const p = runProgress([
    { status: "done" },
    { status: "skipped" },
    { status: "pending" },
    { status: "in_progress" },
  ]);
  ok("total 4", p.total === 4);
  ok("done 1", p.done === 1);
  ok("skipped 1", p.skipped === 1);
  ok("resolved 2", p.resolved === 2);
  ok("remaining 2", p.remaining === 2);
  ok("pct 50", p.pct === 50);
  ok("not allResolved", !p.allResolved);
}
{
  const p = runProgress([{ status: "done" }, { status: "skipped" }]);
  ok("allResolved when every item done/skipped", p.allResolved);
  ok("pct 100", p.pct === 100);
}
{
  const p = runProgress([
    { status: "pending", publishStatus: "submitted" },
    { status: "in_progress", publishStatus: "needs_login" },
    { status: "pending", publishStatus: "skipped" },
  ]);
  ok("publish progress counts submitted as done", p.done === 1);
  ok("publish progress counts skipped", p.skipped === 1);
  ok("publish progress leaves needs_login open", p.remaining === 1);
}
{
  const p = runProgress([]);
  ok("empty run pct 0", p.pct === 0);
  ok("empty run not allResolved", !p.allResolved);
}

// --- selectable channels ---------------------------------------------------
{
  const sel = selectableRunChannels(DISTRIBUTION_CHANNELS, new Set());
  ok("selectable includes all 7 matrix + other = 8", sel.length === 8);
  ok("selectable includes other", sel.some((c) => c.key === "other"));
}
{
  const sel = selectableRunChannels(
    DISTRIBUTION_CHANNELS,
    new Set(["facebook", "other"]),
  );
  ok("excludes already-in-run facebook", !sel.some((c) => c.key === "facebook"));
  ok("excludes already-in-run other", !sel.some((c) => c.key === "other"));
  ok("selectable now 6", sel.length === 6);
}

console.log(`\ndistribution-run: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
