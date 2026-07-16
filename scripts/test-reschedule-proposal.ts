// Unit tests for S497 suggest-a-new-time proposal helpers.
// Run: npx tsx scripts/test-reschedule-proposal.ts
import { readFileSync } from "node:fs";
import {
  canAcceptRescheduleProposal,
  normalizeProposedSlots,
  proposedSlotMatches,
} from "../lib/reschedule-proposals";
import {
  buildingKey,
  generateSlots,
  type Availability,
} from "../lib/booking";

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

type SqlFlow = "accept" | "book";

function utcDayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function utcDow(ms: number): number {
  return new Date(ms).getUTCDay();
}

function utcMinuteOfDay(ms: number): number {
  const d = new Date(ms);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function slotRange(startIso: string, endIso: string, stepMin = 30): string[] {
  const out: string[] = [];
  for (
    let t = new Date(startIso).getTime();
    t <= new Date(endIso).getTime();
    t += stepMin * 60_000
  ) {
    out.push(new Date(t).toISOString());
  }
  return out;
}

function sqlContractAcceptsSlot(
  av: Availability,
  slotIso: string,
  nowAt: Date,
  opts: {
    flow: SqlFlow;
    excludeShowingId?: string | null;
  },
): boolean {
  const t = new Date(slotIso).getTime();
  if (Number.isNaN(t)) return false;
  if (t <= nowAt.getTime()) return false;

  const slotDate = new Date(t);
  if (
    slotDate.getUTCSeconds() !== 0 ||
    slotDate.getUTCMilliseconds() !== 0
  ) {
    return false;
  }

  const slotMin = av.slot_minutes > 0 ? av.slot_minutes : 30;
  const leadMs = av.lead_hours * 3_600_000;
  const horizonDays = av.horizon_days > 0 ? av.horizon_days : 14;
  if (t > nowAt.getTime() + (horizonDays + 1) * 86_400_000) return false;

  const dayKey = utcDayKey(t);
  const dow = utcDow(t);
  const minOfDay = utcMinuteOfDay(t);
  if ((av.days_off ?? []).includes(dayKey)) return false;

  const booked = new Set((av.booked ?? []).map((iso) => new Date(iso).getTime()));
  if (booked.has(t)) return false;

  const targetKey = buildingKey(av.target_address);
  const cap =
    av.showing_block_capacity != null && av.showing_block_capacity > 0
      ? av.showing_block_capacity
      : 6;
  const anchors = av.clustering_enabled && targetKey
    ? (av.cluster_candidates ?? [])
        .filter((c) => !opts.excludeShowingId || c.id !== opts.excludeShowingId)
        .filter((c) => buildingKey(c.address) === targetKey)
        .map((c) => new Date(c.scheduled_at).getTime())
        .filter((ms) => !Number.isNaN(ms))
        .filter((ms) => ms >= nowAt.getTime() && utcDayKey(ms) === dayKey)
    : [];
  const isAnchored = Boolean(
    av.clustering_enabled &&
      targetKey &&
      anchors.length >= 1 &&
      anchors.length < cap,
  );

  if (opts.flow === "book" || !isAnchored) {
    if (t < nowAt.getTime() + leadMs) return false;
  }

  const overrides = (av.overrides ?? []).filter((o) => o.day === dayKey);
  const weeklyRules = (av.rules ?? []).filter((r) => r.weekday === dow);
  const isSynth =
    isAnchored && overrides.length === 0 && weeklyRules.length === 0;

  if (overrides.length > 0) {
    const inOverride = overrides.some(
      (o) =>
        minOfDay >= o.start_minute &&
        minOfDay + slotMin <= o.end_minute &&
        (minOfDay - o.start_minute) % slotMin === 0,
    );
    if (!inOverride) return false;
  } else if (!isSynth) {
    const inRule = weeklyRules.some(
      (r) =>
        minOfDay >= r.start_minute &&
        minOfDay + slotMin <= r.end_minute &&
        (minOfDay - r.start_minute) % slotMin === 0,
    );
    if (!inRule) return false;
  }

  if (av.clustering_enabled && targetKey && anchors.length > 0) {
    if (anchors.length >= cap) return false;
    const bufferMs = Math.max(0, av.clustering_buffer_minutes ?? 60) * 60_000;
    const lo = Math.min(...anchors) - bufferMs;
    const hi = Math.max(...anchors) + bufferMs;
    if (t < lo || t > hi) return false;
    if (isSynth && (t - lo) % (slotMin * 60_000) !== 0) return false;
  }

  return true;
}

const parityNow = new Date("2026-07-01T05:30:00.000Z");
const paritySynthAv: Availability = {
  timezone: "UTC",
  slot_minutes: 30,
  lead_hours: 12,
  horizon_days: 0,
  rules: [],
  booked: ["2026-07-01T18:00:00.000Z"],
  clustering_enabled: true,
  clustering_buffer_minutes: 60,
  showing_block_capacity: 6,
  target_address: "833 Pillette Rd Unit 27",
  cluster_candidates: [
    {
      id: "anchor",
      address: "833 Pillette Rd Unit 22",
      scheduled_at: "2026-07-01T18:00:00.000Z",
    },
  ],
};
const parityCandidates = slotRange(
  "2026-07-01T16:30:00.000Z",
  "2026-07-01T19:30:00.000Z",
);
const jsOperatorGrid = generateSlots(paritySynthAv, parityNow, {
  relaxLeadForAnchoredDays: true,
}).flatMap((d) => d.slots.map((s) => s.iso));
const sqlAcceptGrid = parityCandidates.filter((slot) =>
  sqlContractAcceptsSlot(paritySynthAv, slot, parityNow, { flow: "accept" }),
);
ok("S503 SQL contract: accept RPC accepts every operator-grid synth slot",
  jsOperatorGrid.every((slot) => sqlAcceptGrid.includes(slot)));
ok("S503 SQL contract: accept RPC rejects off-grid synth slot",
  !sqlContractAcceptsSlot(paritySynthAv, "2026-07-01T17:15:00.000Z", parityNow, {
    flow: "accept",
  }));
ok("S503 SQL contract: accept RPC rejects out-of-window synth slot",
  !sqlContractAcceptsSlot(paritySynthAv, "2026-07-01T16:30:00.000Z", parityNow, {
    flow: "accept",
  }));
ok("S503 SQL contract: accept RPC rejects day-off synth slot",
  !sqlContractAcceptsSlot(
    { ...paritySynthAv, days_off: ["2026-07-01"] },
    "2026-07-01T17:30:00.000Z",
    parityNow,
    { flow: "accept" },
  ));
ok("S503 SQL contract: accept RPC rejects over-cap synth day",
  !sqlContractAcceptsSlot(
    {
      ...paritySynthAv,
      booked: [],
      showing_block_capacity: 2,
      cluster_candidates: [
        {
          id: "anchor-a",
          address: "833 Pillette Rd Unit 22",
          scheduled_at: "2026-07-01T17:30:00.000Z",
        },
        {
          id: "anchor-b",
          address: "833 Pillette Rd Unit 24",
          scheduled_at: "2026-07-01T18:00:00.000Z",
        },
      ],
    },
    "2026-07-01T17:30:00.000Z",
    parityNow,
    { flow: "accept" },
  ));
const jsRenterGrid = generateSlots(paritySynthAv, parityNow)
  .flatMap((d) => d.slots.map((s) => s.iso));
const sqlBookGrid = parityCandidates.filter((slot) =>
  sqlContractAcceptsSlot(paritySynthAv, slot, parityNow, { flow: "book" }),
);
ok("S503 SQL contract: book RPC accepts every renter-grid synth slot",
  jsRenterGrid.every((slot) => sqlBookGrid.includes(slot)));
ok("S503 SQL contract: book RPC rejects inside lead window",
  !sqlContractAcceptsSlot(paritySynthAv, "2026-07-01T17:00:00.000Z", parityNow, {
    flow: "book",
  }));
ok("S503 SQL contract: JS synth operator grid equals accept RPC accepted set",
  JSON.stringify(jsOperatorGrid) === JSON.stringify(sqlAcceptGrid));
ok("S503 SQL contract: JS synth renter grid equals book RPC accepted set",
  JSON.stringify(jsRenterGrid) === JSON.stringify(sqlBookGrid));
ok("S503 SQL contract: normal non-synth accept still works",
  sqlContractAcceptsSlot(
    {
      timezone: "UTC",
      slot_minutes: 30,
      lead_hours: 0,
      horizon_days: 7,
      rules: [{ weekday: 3, start_minute: 600, end_minute: 660 }],
      booked: [],
    },
    "2026-07-01T10:00:00.000Z",
    now,
    { flow: "accept" },
  ));

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
const migration0152 = readFileSync(
  "supabase/migrations/0152_clustering_open_covered_day.sql",
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
ok("0152 recreates exactly the two write RPCs",
  migration0152.includes("create or replace function public.accept_reschedule_proposal") &&
    migration0152.includes("create or replace function public.book_public_showing") &&
    !migration0152.includes("create or replace function public.get_reschedule_proposal"));
ok("0152 accept self-excludes the moving showing in anchor selection",
  /create or replace function public\.accept_reschedule_proposal[\s\S]*select count\(\*\), min\(s\.scheduled_at\), max\(s\.scheduled_at\)[\s\S]*and s\.id <> v_showing_id[\s\S]*cp\.building_key = v_building/i.test(migration0152));
ok("0152 public booking does not use the move-only self-exclude",
  /create or replace function public\.book_public_showing[\s\S]*select count\(\*\), min\(s\.scheduled_at\), max\(s\.scheduled_at\)[\s\S]*cp\.building_key = v_building/i.test(migration0152) &&
    !/create or replace function public\.book_public_showing[\s\S]*and s\.id <> v_showing_id/i.test(migration0152));
ok("0152 derives synthesized days from anchored plus no override/no weekly rule",
  (migration0152.match(/v_is_synth_day := v_is_anchored_day/g) ?? []).length === 2 &&
    (migration0152.match(/coalesce\(v_override_count, 0\) = 0/g) ?? []).length >= 2 &&
    (migration0152.match(/not exists \(\s*select 1\s*from public\.availability_rules/g) ?? []).length >= 2);
ok("0152 bypasses weekly rejection only on synthesized days",
  (migration0152.match(/elsif not v_is_synth_day and not exists/g) ?? []).length === 2);
ok("0152 relaxes lead only for accept_reschedule_proposal",
  /create or replace function public\.accept_reschedule_proposal[\s\S]*if p_slot < now\(\) \+ make_interval\(hours => coalesce\(v_lead_hours, 0\)\)\s+and not v_is_anchored_day/i.test(migration0152) &&
    /create or replace function public\.book_public_showing[\s\S]*if p_slot < now\(\) \+ make_interval\(hours => coalesce\(v_lead_hours, 0\)\) then\s+raise exception 'Slot is no longer available'/i.test(migration0152));
ok("0152 enforces synth-only step alignment in both RPCs",
  (migration0152.match(/extract\(epoch from \(p_slot - v_synth_lo\)\)::bigint % \(v_slot_min \* 60\)/g) ?? []).length === 2);
ok("0152 preserves anon/authenticated grants for both RPCs",
  /grant execute on function public\.accept_reschedule_proposal\(uuid, timestamptz\)\s+to anon, authenticated/i.test(migration0152) &&
    /grant execute on function public\.book_public_showing\(uuid, uuid, timestamptz\)\s+to anon, authenticated/i.test(migration0152));

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
