// Unit tests for S497 suggest-a-new-time proposal helpers.
// Run: npx tsx scripts/test-reschedule-proposal.ts
import { readFileSync } from "node:fs";
import {
  canAcceptRescheduleProposal,
  normalizeProposedSlots,
  proposedSlotMatches,
} from "../lib/reschedule-proposals";
import type { Availability } from "../lib/booking";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${name}`);
  }
}

function reasonOf(result: ReturnType<typeof canAcceptRescheduleProposal>): string | null {
  return result.ok ? null : result.reason;
}

const now = new Date("2026-07-01T09:00:00.000Z");
const baseAv: Availability = {
  timezone: "UTC",
  slot_minutes: 30,
  lead_hours: 0,
  horizon_days: 7,
  rules: [{ weekday: 3, start_minute: 600, end_minute: 660 }],
  booked: [],
};

const normalized = normalizeProposedSlots([
  "2026-07-01T10:00:00.000Z",
  "2026-07-01T10:00:00.000Z",
  "bad",
  "2026-07-01T10:30:00.000Z",
  "2026-07-02T10:00:00.000Z",
  "2026-07-03T10:00:00.000Z",
]);
ok("normalize keeps unique valid slots capped at three", normalized.length === 3);
ok("chosen slot must be a member of proposed slots",
  proposedSlotMatches(normalized, "2026-07-01T10:30:00.000Z") &&
    !proposedSlotMatches(normalized, "2026-07-01T11:00:00.000Z"));

ok("pending proposal accepts a proposed currently valid slot",
  canAcceptRescheduleProposal({
    status: "pending",
    proposedSlots: normalized,
    slot: "2026-07-01T10:00:00.000Z",
    availability: baseAv,
    now,
  }).ok);
ok("accepted proposal cannot be accepted again",
  reasonOf(canAcceptRescheduleProposal({
    status: "accepted",
    proposedSlots: normalized,
    slot: "2026-07-01T10:00:00.000Z",
    availability: baseAv,
    now,
  })) === "not_pending");
ok("unproposed slot is rejected even when availability allows it",
  reasonOf(canAcceptRescheduleProposal({
    status: "pending",
    proposedSlots: ["2026-07-01T10:00:00.000Z"],
    slot: "2026-07-01T10:30:00.000Z",
    availability: baseAv,
    now,
  })) === "slot_not_proposed");

const overrideAv: Availability = {
  ...baseAv,
  overrides: [{ day: "2026-07-01", start_minute: 780, end_minute: 840 }],
};
ok("accept check honors override replacing the weekly slot",
  reasonOf(canAcceptRescheduleProposal({
    status: "pending",
    proposedSlots: ["2026-07-01T10:00:00.000Z"],
    slot: "2026-07-01T10:00:00.000Z",
    availability: overrideAv,
    now,
  })) === "slot_not_available");
ok("accept check accepts the override slot",
  canAcceptRescheduleProposal({
    status: "pending",
    proposedSlots: ["2026-07-01T13:00:00.000Z"],
    slot: "2026-07-01T13:00:00.000Z",
    availability: overrideAv,
    now,
  }).ok);
ok("day off beats an otherwise valid proposed override",
  reasonOf(canAcceptRescheduleProposal({
    status: "pending",
    proposedSlots: ["2026-07-01T13:00:00.000Z"],
    slot: "2026-07-01T13:00:00.000Z",
    availability: { ...overrideAv, days_off: ["2026-07-01"] },
    now,
  })) === "slot_not_available");

const moveAtCapAv: Availability = {
  ...baseAv,
  rules: [{ weekday: 3, start_minute: 600, end_minute: 720 }],
  clustering_enabled: true,
  clustering_buffer_minutes: 60,
  showing_block_capacity: 3,
  target_address: "833 Pillette Rd Unit 27",
  cluster_candidates: [
    { id: "moving", address: "833 Pillette Rd Unit 22", scheduled_at: "2026-07-01T10:00:00.000Z" },
    { id: "anchor-a", address: "833 Pillette Rd Unit 24", scheduled_at: "2026-07-01T10:30:00.000Z" },
    { id: "anchor-b", address: "833 Pillette Rd Unit 26", scheduled_at: "2026-07-01T11:00:00.000Z" },
  ],
};
ok("new booking into a full building/day block is still rejected",
  reasonOf(canAcceptRescheduleProposal({
    status: "pending",
    proposedSlots: ["2026-07-01T11:30:00.000Z"],
    slot: "2026-07-01T11:30:00.000Z",
    availability: moveAtCapAv,
    now,
  })) === "slot_not_available");
ok("move at capacity accepts an in-block slot after excluding the moving showing",
  canAcceptRescheduleProposal({
    status: "pending",
    proposedSlots: ["2026-07-01T11:30:00.000Z"],
    slot: "2026-07-01T11:30:00.000Z",
    availability: moveAtCapAv,
    excludeShowingId: "moving",
    now,
  }).ok);

const migration = readFileSync(
  "supabase/migrations/0149_showing_reschedule_proposals.sql",
  "utf8",
);
const migration0148 = readFileSync(
  "supabase/migrations/0148_availability_overrides.sql",
  "utf8",
);
const migration0150 = readFileSync(
  "supabase/migrations/0150_reschedule_move_capacity_self_exclude.sql",
  "utf8",
);
ok("migration creates the proposal RPCs",
  migration.includes("create or replace function public.get_reschedule_proposal") &&
    migration.includes("create or replace function public.accept_reschedule_proposal"));
ok("accept RPC is granted to anon",
  /grant execute on function public\.accept_reschedule_proposal\(uuid, timestamptz\)\s+to anon/i.test(migration));
ok("accept SQL preserves day-off before override before weekly precedence", (() => {
  const dayOff = migration.indexOf("availability_days_off");
  const override = migration.indexOf("availability_overrides");
  const weekly = migration.indexOf("availability_rules");
  return dayOff >= 0 && override > dayOff && weekly > override;
})());
ok("proposal get RPC only exposes pending tokens",
  migration.includes("if v_status <> 'pending' then"));
ok("0150 recreates only the accept RPC",
  migration0150.includes("create or replace function public.accept_reschedule_proposal") &&
    !migration0150.includes("create or replace function public.get_reschedule_proposal"));
ok("0150 self-excludes the moving showing in the clustering anchor select",
  /select count\(\*\), min\(s\.scheduled_at\), max\(s\.scheduled_at\)[\s\S]*and s\.id <> v_showing_id[\s\S]*cp\.building_key = v_building/i.test(migration0150));
ok("0148 insert guard remains untouched by the move-only self-exclusion",
  !migration0148.includes("v_showing_id"));

const emailSource = readFileSync("lib/email.ts", "utf8");
const pageSource = readFileSync("app/showing/reschedule/[token]/page.tsx", "utf8");
ok("proposal email adopts BrokerBay subject and opener",
  emailSource.includes("Time change suggestion —") &&
    emailSource.includes("Would it be possible to adjust your viewing on this property to the following?"));
ok("proposal surfaces use Original Showing and green New Suggested Time options",
  emailSource.includes("Original Showing") &&
    emailSource.includes("New Suggested Time") &&
    pageSource.includes("Original Showing") &&
    pageSource.includes("New Suggested Time"));
ok("none-work path avoids BrokerBay deny cancellation copy",
  emailSource.includes("None of these work — see all available times") &&
    pageSource.includes("None of these work — see all available times") &&
    !emailSource.includes("Deny") &&
    !pageSource.includes("Deny"));
ok("accept confirmation says successfully modified and confirmed",
  emailSource.includes("successfully modified and is now confirmed") &&
    pageSource.includes("successfully modified and is now confirmed"));

console.log(`
reschedule-proposal: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
