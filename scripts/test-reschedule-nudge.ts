// Unit tests for S504 reschedule proposal re-nudge.
// Run: npx tsx scripts/test-reschedule-nudge.ts
import { readFileSync } from "node:fs";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${name}`);
  }
}

const RESCHEDULE_NUDGE_AFTER_HOURS = 24;
const RESCHEDULE_NUDGE_AFTER_MS = RESCHEDULE_NUDGE_AFTER_HOURS * 3_600_000;

type RescheduleNudgeCandidateInput = {
  status: string | null;
  responded_at: string | null;
  reminded_at: string | null;
  created_at: string | null;
  org_enabled: boolean;
  showing_outcome: string | null;
  showing_scheduled_at: string | null;
};

function evaluateRescheduleNudgeCandidate(
  row: RescheduleNudgeCandidateInput,
  nowMs: number,
): { eligible: boolean; reason: string } {
  if (row.status !== "pending") return { eligible: false, reason: "not_pending" };
  if (row.responded_at) return { eligible: false, reason: "responded" };
  if (row.reminded_at) return { eligible: false, reason: "already_reminded" };
  if (!row.org_enabled) return { eligible: false, reason: "disabled" };
  if (!row.created_at) return { eligible: false, reason: "missing_created_at" };
  const createdMs = new Date(row.created_at).getTime();
  if (Number.isNaN(createdMs)) return { eligible: false, reason: "missing_created_at" };
  if (createdMs > nowMs - RESCHEDULE_NUDGE_AFTER_MS) {
    return { eligible: false, reason: "too_new" };
  }
  if (row.showing_outcome !== "scheduled") {
    return { eligible: false, reason: "showing_not_scheduled" };
  }
  if (!row.showing_scheduled_at) {
    return { eligible: false, reason: "missing_showing_time" };
  }
  const showingMs = new Date(row.showing_scheduled_at).getTime();
  if (Number.isNaN(showingMs)) {
    return { eligible: false, reason: "missing_showing_time" };
  }
  if (showingMs <= nowMs) return { eligible: false, reason: "showing_past" };
  return { eligible: true, reason: "eligible" };
}

function claimRescheduleNudgeForTest(
  row: { reminded_at: string | null },
  nowIso: string,
): boolean {
  if (row.reminded_at) return false;
  row.reminded_at = nowIso;
  return true;
}

const nowMs = Date.parse("2026-07-16T15:00:00.000Z");
const base: RescheduleNudgeCandidateInput = {
  status: "pending",
  responded_at: null,
  reminded_at: null,
  created_at: "2026-07-15T14:59:00.000Z",
  org_enabled: true,
  showing_outcome: "scheduled",
  showing_scheduled_at: "2026-07-17T15:00:00.000Z",
};

const reasonOf = (row: Partial<RescheduleNudgeCandidateInput>) =>
  evaluateRescheduleNudgeCandidate({ ...base, ...row }, nowMs).reason;

ok("candidate threshold is 24 hours",
  RESCHEDULE_NUDGE_AFTER_HOURS === 24);
ok("eligible pending unresponded unreminded aged upcoming enabled proposal is due",
  evaluateRescheduleNudgeCandidate(base, nowMs).eligible);
ok("responded proposal is skipped",
  reasonOf({ responded_at: "2026-07-16T10:00:00.000Z" }) === "responded");
ok("accepted proposal is skipped",
  reasonOf({ status: "accepted" }) === "not_pending");
ok("expired proposal is skipped",
  reasonOf({ status: "expired" }) === "not_pending");
ok("already-reminded proposal is skipped",
  reasonOf({ reminded_at: "2026-07-16T12:00:00.000Z" }) === "already_reminded");
ok("proposal created inside 24h is skipped",
  reasonOf({ created_at: "2026-07-16T14:00:00.000Z" }) === "too_new");
ok("showing outcome other than scheduled is skipped",
  reasonOf({ showing_outcome: "cancelled" }) === "showing_not_scheduled");
ok("showing in the past is skipped",
  reasonOf({ showing_scheduled_at: "2026-07-16T14:59:00.000Z" }) === "showing_past");
ok("disabled org is skipped",
  reasonOf({ org_enabled: false }) === "disabled");

const claimRow = { reminded_at: null as string | null };
ok("claim stamps an unclaimed proposal before send",
  claimRescheduleNudgeForTest(claimRow, "2026-07-16T15:00:00.000Z"));
ok("claimed proposal is not claimed again on a second pass",
  !claimRescheduleNudgeForTest(claimRow, "2026-07-16T15:01:00.000Z"));

const routeSource = readFileSync("app/api/cron/reschedule-nudge/route.ts", "utf8");
const migration = readFileSync("supabase/migrations/0153_reschedule_nudge.sql", "utf8");
const workflow = readFileSync(".github/workflows/reminders.yml", "utf8");
const detailBlocks = Array.from(
  routeSource.matchAll(/summary\.details\.push\(\{[\s\S]*?\n\s*\}\);/g),
  (match) => match[0],
);

ok("route reuses the existing direct reschedule email",
  routeSource.includes("sendRescheduleProposal") &&
    !routeSource.includes("sendOrgNotification") &&
    !routeSource.includes("NOTIFICATION_EVENTS"));
ok("route keeps the 24h nudge threshold in the route constant",
  routeSource.includes("const RESCHEDULE_NUDGE_AFTER_HOURS = 24;"));
ok("route candidate query filters pending unresponded unreminded proposals",
  routeSource.includes('.eq("status", "pending")') &&
    routeSource.includes('.is("responded_at", null)') &&
    routeSource.includes('.is("reminded_at", null)'));
ok("route candidate evaluator checks org opt-in, scheduled outcome, and future showing time",
  routeSource.includes("org_enabled: org?.reschedule_nudge_enabled === true") &&
    routeSource.includes('row.showing_outcome !== "scheduled"') &&
    routeSource.includes("showingMs <= nowMs"));
ok("route supports CRON_SECRET bearer/query auth",
  routeSource.includes("Bearer ${secret}") &&
    routeSource.includes('searchParams.get("secret")'));
ok("route supports dry org and force modes",
  routeSource.includes('params.get("dry") === "1"') &&
    routeSource.includes('params.get("org")') &&
    routeSource.includes('params.get("force") === "1"'));
ok("route claims reminded_at before it calls the email sender",
  routeSource.indexOf(".update({ reminded_at: nowIso })") >= 0 &&
    routeSource.indexOf(".update({ reminded_at: nowIso })") <
      routeSource.indexOf("sendRescheduleProposal({"));
ok("dry mode claims nothing and sends nothing",
  routeSource.includes("if (dry)") &&
    routeSource.indexOf("if (dry)") < routeSource.indexOf(".update({ reminded_at: nowIso })"));
ok("summary details do not include renter PII keys",
  detailBlocks.length > 0 &&
    detailBlocks.every(
      (block) => !/renter_(?:email|name)|lead_(?:email|name)/.test(block),
    ));
ok("route sanitizes direct email failure details before summary output",
  routeSource.includes("function safeSendFailureReason") &&
    routeSource.includes("error: safeSendFailureReason(result.reason)"));
ok("0153 migration is additive columns only",
  /alter table public\.showing_reschedule_proposals\s+add column if not exists reminded_at timestamptz;/i.test(migration) &&
    /alter table public\.organizations\s+add column if not exists reschedule_nudge_enabled boolean not null default false;/i.test(migration) &&
    !/create or replace function|drop column|alter column/i.test(migration));
ok("0153 documents both new columns",
  migration.includes("comment on column public.showing_reschedule_proposals.reminded_at") &&
    migration.includes("comment on column public.organizations.reschedule_nudge_enabled"));
ok("workflow pings the reschedule-nudge cron",
  workflow.includes("/api/cron/reschedule-nudge"));

console.log(`
reschedule-nudge: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
