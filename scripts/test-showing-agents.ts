// Unit tests for the pure showing-agents domain model (S436, Slice 1 — multi-
// operator showing routing). Run:
//   node -r sucrase/register scripts/test-showing-agents.ts
import {
  PRODUCT_TYPES,
  isProductType,
  normalizeProductTypes,
  validateShowingAgent,
  MAX_AGENT_NAME_LEN,
  canAssignShowing,
  remainingCapacity,
  isAtCapacity,
  agentDisplayLabel,
  activeAgents,
  deriveCoordinationStatus,
  needsConfirmation,
  coordinationStatusLabel,
  canConfirmShowing,
  COORDINATION_STATUSES,
  orgWeekWindow,
  suggestShowingAgent,
  pickAutoAssignAgent,
  planBulkAssignments,
  type SuggestCandidate,
  type BulkAssignAgent,
} from "../lib/showing-agents";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

// --- product types ----------------------------------------------------------
ok("product types: five", PRODUCT_TYPES.length === 5);
ok("isProductType: rental", isProductType("rental"));
ok("isProductType: junk", !isProductType("boat"));
ok("isProductType: non-string", !isProductType(7));

ok(
  "normalizeProductTypes: keeps known, drops junk, dedupes",
  JSON.stringify(normalizeProductTypes(["rental", "RENTAL", "boat", "condo", null])) ===
    JSON.stringify(["rental", "condo"]),
);
ok("normalizeProductTypes: empty in", normalizeProductTypes(null).length === 0);
ok(
  "normalizeProductTypes: lowercases + trims",
  JSON.stringify(normalizeProductTypes([" House "])) === JSON.stringify(["house"]),
);

// --- validation -------------------------------------------------------------
const vNoName = validateShowingAgent({ name: "   " });
ok("validate: blank name rejected", !vNoName.ok && vNoName.code === "name_required");

const vLong = validateShowingAgent({ name: "x".repeat(MAX_AGENT_NAME_LEN + 1) });
ok("validate: long name rejected", !vLong.ok && vLong.code === "name_too_long");

const vBadEmail = validateShowingAgent({ name: "Odette", email: "not-an-email" });
ok("validate: bad email rejected", !vBadEmail.ok && vBadEmail.code === "email_invalid");

const vBadCap = validateShowingAgent({ name: "Peter", weekly_capacity: "-3" });
ok("validate: negative capacity rejected", !vBadCap.ok && vBadCap.code === "capacity_invalid");

const vFracCap = validateShowingAgent({ name: "Peter", weekly_capacity: "2.5" });
ok("validate: fractional capacity rejected", !vFracCap.ok && vFracCap.code === "capacity_invalid");

const vGood = validateShowingAgent({
  name: "  Odette  ",
  email: "  Odette@Example.COM ",
  phone: " 519-555-0100 ",
  tier: " associate ",
  service_area: " Moore Park ",
  product_types: ["rental", "condo", "boat"],
  weekly_capacity: "6",
  note: "  screens hard  ",
});
ok("validate: good input ok", vGood.ok);
if (vGood.ok) {
  ok("validate: name trimmed", vGood.value.name === "Odette");
  ok("validate: email lowercased+trimmed", vGood.value.email === "odette@example.com");
  ok("validate: phone trimmed", vGood.value.phone === "519-555-0100");
  ok("validate: tier trimmed", vGood.value.tier === "associate");
  ok("validate: service_area trimmed", vGood.value.service_area === "Moore Park");
  ok(
    "validate: product_types normalized",
    JSON.stringify(vGood.value.product_types) === JSON.stringify(["rental", "condo"]),
  );
  ok("validate: capacity parsed", vGood.value.weekly_capacity === 6);
  ok("validate: note trimmed", vGood.value.note === "screens hard");
}

const vEmptyOptionals = validateShowingAgent({ name: "Solo", email: "", phone: "  ", weekly_capacity: "" });
ok("validate: empty optionals -> null", vEmptyOptionals.ok);
if (vEmptyOptionals.ok) {
  ok("validate: email empty -> null", vEmptyOptionals.value.email === null);
  ok("validate: phone empty -> null", vEmptyOptionals.value.phone === null);
  ok("validate: capacity empty -> null", vEmptyOptionals.value.weekly_capacity === null);
  ok("validate: capacity 0 allowed via null default", vEmptyOptionals.value.weekly_capacity === null);
}

const vZeroCap = validateShowingAgent({ name: "Zero", weekly_capacity: 0 });
ok("validate: zero capacity allowed", vZeroCap.ok && vZeroCap.value.weekly_capacity === 0);

// --- assignment state -------------------------------------------------------
ok("canAssign: scheduled", canAssignShowing("scheduled"));
ok("canAssign: attended", canAssignShowing("attended"));
ok("canAssign: no_show", canAssignShowing("no_show"));
ok("canAssign: cancelled NO", !canAssignShowing("cancelled"));
ok("canAssign: null ok", canAssignShowing(null));

// --- capacity ---------------------------------------------------------------
ok("remaining: uncapped -> null", remainingCapacity(null, 5) === null);
ok("remaining: 6 cap, 2 booked -> 4", remainingCapacity(6, 2) === 4);
ok("remaining: over-booked floors at 0", remainingCapacity(3, 5) === 0);
ok("remaining: negative booked treated as 0", remainingCapacity(3, -2) === 3);
ok("atCapacity: uncapped never full", !isAtCapacity(null, 100));
ok("atCapacity: exactly full", isAtCapacity(4, 4));
ok("atCapacity: over full", isAtCapacity(4, 9));
ok("atCapacity: room left", !isAtCapacity(4, 1));

// --- view helpers -----------------------------------------------------------
ok("label: name + tier", agentDisplayLabel({ name: "Peter", tier: "lead" }) === "Peter (lead)");
ok("label: name only", agentDisplayLabel({ name: "Odette", tier: null }) === "Odette");
ok("label: blank name fallback", agentDisplayLabel({ name: "  ", tier: "" }) === "Unnamed agent");

const roster = [
  { id: "1", name: "A", archived: false },
  { id: "2", name: "B", archived: true },
  { id: "3", name: "C", archived: false },
];
ok(
  "activeAgents: drops archived, keeps order",
  JSON.stringify(activeAgents(roster).map((a) => a.id)) === JSON.stringify(["1", "3"]),
);

// --- coordination status (Slice 2) ------------------------------------------
ok("coord: 5 statuses", COORDINATION_STATUSES.length === 5);
ok(
  "coord: cancelled wins",
  deriveCoordinationStatus({ outcome: "cancelled", assignedAgentId: "a", confirmedAt: "x" }) === "cancelled",
);
ok(
  "coord: attended -> done",
  deriveCoordinationStatus({ outcome: "attended", assignedAgentId: "a", confirmedAt: null }) === "done",
);
ok(
  "coord: no_show -> done",
  deriveCoordinationStatus({ outcome: "no_show", assignedAgentId: null, confirmedAt: null }) === "done",
);
ok(
  "coord: scheduled + no agent -> unassigned",
  deriveCoordinationStatus({ outcome: "scheduled", assignedAgentId: null, confirmedAt: null }) === "unassigned",
);
ok(
  "coord: assigned + not confirmed -> awaiting",
  deriveCoordinationStatus({ outcome: "scheduled", assignedAgentId: "a", confirmedAt: null }) ===
    "awaiting_confirmation",
);
ok(
  "coord: assigned + confirmed -> confirmed",
  deriveCoordinationStatus({ outcome: "scheduled", assignedAgentId: "a", confirmedAt: "2026-07-09T00:00:00Z" }) ===
    "confirmed",
);
ok(
  "coord: null outcome + agent + no confirm -> awaiting",
  deriveCoordinationStatus({ outcome: null, assignedAgentId: "a", confirmedAt: null }) === "awaiting_confirmation",
);
ok("coord: needsConfirmation only for awaiting", needsConfirmation("awaiting_confirmation"));
ok("coord: needsConfirmation not for confirmed", !needsConfirmation("confirmed"));
ok("coord: needsConfirmation not for unassigned", !needsConfirmation("unassigned"));
ok("coord: canConfirm only awaiting", canConfirmShowing("awaiting_confirmation") && !canConfirmShowing("confirmed"));
ok("coord: label", coordinationStatusLabel("awaiting_confirmation") === "Awaiting confirmation");

// --- orgWeekWindow (S441) ----------------------------------------------------
// Wed 2026-07-08 12:00 EDT === 2026-07-08T16:00:00Z. Sunday-start week is
// Sun 2026-07-05 00:00 EDT (04:00Z) .. Sun 2026-07-12 00:00 EDT.
{
  const now = Date.parse("2026-07-08T16:00:00Z");
  const w = orgWeekWindow(now, "America/Toronto");
  ok("orgWeekWindow: start is local Sunday midnight", new Date(w.startMs).toISOString() === "2026-07-05T04:00:00.000Z");
  ok("orgWeekWindow: 7-day span", w.endMs - w.startMs === 7 * 24 * 3_600_000);
  ok("orgWeekWindow: now within window", now >= w.startMs && now < w.endMs);
}
{
  // Just after local midnight Sunday should already be in the NEW week.
  const sundayEarly = Date.parse("2026-07-12T04:30:00Z"); // 00:30 EDT Sunday
  const w = orgWeekWindow(sundayEarly, "America/Toronto");
  ok("orgWeekWindow: Sunday 00:30 starts a fresh week", new Date(w.startMs).toISOString() === "2026-07-12T04:00:00.000Z");
}
{
  // Monday-start variant: Wed 2026-07-08 -> week starts Mon 2026-07-06.
  const now = Date.parse("2026-07-08T16:00:00Z");
  const w = orgWeekWindow(now, "America/Toronto", 1);
  ok("orgWeekWindow: Monday-start", new Date(w.startMs).toISOString() === "2026-07-06T04:00:00.000Z");
}
{
  // Bad tz falls back to UTC parts without throwing.
  const now = Date.parse("2026-07-08T16:00:00Z");
  const w = orgWeekWindow(now, "Not/AZone");
  ok("orgWeekWindow: bad tz does not throw + 7-day span", w.endMs - w.startMs === 7 * 24 * 3_600_000);
}

// --- suggestShowingAgent (S441) ----------------------------------------------
const mk = (o: Partial<SuggestCandidate> & { id: string; name: string }): SuggestCandidate => ({
  tier: null,
  productTypes: [],
  weeklyCapacity: null,
  assignedThisWeek: 0,
  archived: false,
  ...o,
});

ok("suggest: empty roster -> null", suggestShowingAgent([]) === null);
ok("suggest: all archived -> null", suggestShowingAgent([mk({ id: "a", name: "A", archived: true })]) === null);

{
  // Uncapped agents -> load-balance by fewest viewings this week.
  const s = suggestShowingAgent([
    mk({ id: "p", name: "Peter", assignedThisWeek: 3 }),
    mk({ id: "o", name: "Odette", assignedThisWeek: 1 }),
  ]);
  ok("suggest: uncapped picks least-loaded", s?.agentId === "o");
  ok("suggest: reason names the load", s?.reason.includes("fewest viewings this week") === true);
  ok("suggest: least-loaded not at capacity", s?.atCapacity === false);
}
{
  // Everyone idle -> deterministic name tie-break.
  const s = suggestShowingAgent([
    mk({ id: "z", name: "Zed" }),
    mk({ id: "a", name: "Amy" }),
  ]);
  ok("suggest: idle roster tie-breaks by name", s?.agentId === "a");
  ok("suggest: idle reason = available", s?.reason === "available");
}
{
  // Capacity beats raw load: agent with more REMAINING capacity wins.
  const s = suggestShowingAgent([
    mk({ id: "p", name: "Peter", weeklyCapacity: 10, assignedThisWeek: 2 }), // 8 left
    mk({ id: "o", name: "Odette", weeklyCapacity: 3, assignedThisWeek: 0 }), // 3 left
  ]);
  ok("suggest: most remaining capacity wins", s?.agentId === "p");
  ok("suggest: capacity reason", s?.reason === "8 of 10 viewings left this week");
}
{
  // Capped-at-full still returns a suggestion but flags atCapacity.
  const s = suggestShowingAgent([
    mk({ id: "p", name: "Peter", weeklyCapacity: 2, assignedThisWeek: 2 }),
  ]);
  ok("suggest: full agent still suggested", s?.agentId === "p");
  ok("suggest: flags atCapacity", s?.atCapacity === true);
  ok("suggest: singular viewing wording", s?.reason === "0 of 2 viewings left this week");
}
{
  // Product-type fit narrows to specialists/generalists when it discriminates.
  const s = suggestShowingAgent(
    [
      mk({ id: "sale", name: "SaleOnly", productTypes: ["sale"], assignedThisWeek: 0 }),
      mk({ id: "rent", name: "RentPro", productTypes: ["rental"], assignedThisWeek: 5 }),
      mk({ id: "gen", name: "Generalist", productTypes: [], assignedThisWeek: 4 }),
    ],
    { productType: "rental" },
  );
  ok("suggest: product fit excludes the non-matching specialist", s?.agentId !== "sale");
  ok("suggest: among fit, load-balance picks generalist over busy rental pro", s?.agentId === "gen");
  // The generalist doesn't specifically "cover rental", so its reason is load-based.
  ok("suggest: generalist reason is load-based", s?.reason.includes("fewest viewings this week") === true);
}
{
  // When the winner IS the matching specialist, the reason names the coverage.
  const s = suggestShowingAgent(
    [
      mk({ id: "rent", name: "RentPro", productTypes: ["rental"], assignedThisWeek: 0 }),
      mk({ id: "sale", name: "SaleOnly", productTypes: ["sale"], assignedThisWeek: 0 }),
    ],
    { productType: "rental" },
  );
  ok("suggest: specialist winner", s?.agentId === "rent");
  ok("suggest: specialist reason names coverage", s?.reason.startsWith("covers rental") === true);
}
{
  // No specialist for the type -> everyone stays eligible (never suggest nobody).
  const s = suggestShowingAgent(
    [mk({ id: "a", name: "A", productTypes: ["sale"], assignedThisWeek: 1 })],
    { productType: "rental" },
  );
  ok("suggest: no fit -> still suggests someone", s?.agentId === "a");
}
{
  // Codex S441 P3: a generalist must beat a wrong-type specialist for a rental
  // even when NO rental specialist exists (drop wrong-type specialists whenever
  // that leaves someone).
  const s = suggestShowingAgent(
    [
      mk({ id: "gen", name: "Gen", productTypes: [], assignedThisWeek: 3 }),
      mk({ id: "sale", name: "SaleOnly", productTypes: ["sale"], assignedThisWeek: 0 }),
    ],
    { productType: "rental" },
  );
  ok("suggest: generalist beats wrong-type specialist (no matching specialist)", s?.agentId === "gen");
  ok("suggest: generalist winner does not claim coverage", s?.reason.includes("covers") === false);
}

// --- pickAutoAssignAgent (S443) ----------------------------------------------
ok("auto-assign: empty roster -> null", pickAutoAssignAgent([]) === null);
ok(
  "auto-assign: all archived -> null",
  pickAutoAssignAgent([mk({ id: "a", name: "A", archived: true })]) === null,
);
{
  // Uncapped agents are never "at capacity" -> auto-assign picks the load-
  // balanced winner just like the manual suggestion.
  const a = pickAutoAssignAgent([
    mk({ id: "busy", name: "Busy", assignedThisWeek: 3 }),
    mk({ id: "free", name: "Free", assignedThisWeek: 0 }),
  ]);
  ok("auto-assign: picks least-loaded uncapped agent", a?.agentId === "free");
}
{
  // The only candidate is at capacity -> auto-assign declines (leave unassigned
  // for manual routing) even though the manual suggestion would still surface it.
  const cands = [mk({ id: "full", name: "Full", weeklyCapacity: 2, assignedThisWeek: 2 })];
  ok("auto-assign: sole at-capacity agent -> null", pickAutoAssignAgent(cands) === null);
  ok(
    "suggest still surfaces the at-capacity agent (manual override)",
    suggestShowingAgent(cands)?.atCapacity === true,
  );
}
{
  // Everyone capped, all full -> auto-assign declines.
  const a = pickAutoAssignAgent([
    mk({ id: "x", name: "X", weeklyCapacity: 1, assignedThisWeek: 1 }),
    mk({ id: "y", name: "Y", weeklyCapacity: 3, assignedThisWeek: 5 }),
  ]);
  ok("auto-assign: all agents full -> null", a === null);
}
{
  // A capped-but-not-full agent beats a full one and gets auto-assigned.
  const a = pickAutoAssignAgent([
    mk({ id: "full", name: "Full", weeklyCapacity: 2, assignedThisWeek: 2 }),
    mk({ id: "room", name: "Room", weeklyCapacity: 5, assignedThisWeek: 1 }),
  ]);
  ok("auto-assign: picks the agent with room over the full one", a?.agentId === "room");
  ok("auto-assign: winner is not at capacity", a?.atCapacity === false);
}

// --- planBulkAssignments (S444 — "Assign all unassigned") --------------------
const mkAgent = (
  o: Partial<BulkAssignAgent> & { id: string; name: string },
): BulkAssignAgent => ({
  tier: null,
  productTypes: [],
  weeklyCapacity: null,
  archived: false,
  ...o,
});
// Two same-week instants (Toronto) used across the batch tests. 2026-07-13 is a
// Monday; both fall in the Sunday-start week of Jul 12–18.
const T = "America/Toronto";
const wk1a = Date.parse("2026-07-13T18:00:00-04:00");
const wk1b = Date.parse("2026-07-14T18:00:00-04:00");
const wk1c = Date.parse("2026-07-15T18:00:00-04:00");
const wk1d = Date.parse("2026-07-16T18:00:00-04:00");
// A different week (Jul 20 Monday, week of Jul 19–25).
const wk2a = Date.parse("2026-07-20T18:00:00-04:00");

{
  // Empty roster -> nothing assignable; every viewing is skipped, none assigned.
  const p = planBulkAssignments({
    unassigned: [{ id: "s1", scheduledAtMs: wk1a }],
    existing: [],
    agents: [],
    tz: T,
  });
  ok("bulk: empty roster assigns nothing", p.assignments.length === 0);
  ok("bulk: empty roster skips all", p.skipped.length === 1 && p.skipped[0] === "s1");
}
{
  // No viewings -> empty plan.
  const p = planBulkAssignments({
    unassigned: [],
    existing: [],
    agents: [mkAgent({ id: "a", name: "Amy" })],
    tz: T,
  });
  ok("bulk: no viewings -> empty plan", p.assignments.length === 0 && p.skipped.length === 0);
}
{
  // Two uncapped agents, four same-week viewings -> balanced 2/2, not 4/0.
  const p = planBulkAssignments({
    unassigned: [
      { id: "s1", scheduledAtMs: wk1a },
      { id: "s2", scheduledAtMs: wk1b },
      { id: "s3", scheduledAtMs: wk1c },
      { id: "s4", scheduledAtMs: wk1d },
    ],
    existing: [],
    agents: [mkAgent({ id: "a", name: "Amy" }), mkAgent({ id: "b", name: "Bob" })],
    tz: T,
  });
  ok("bulk: assigns every viewing when uncapped", p.assignments.length === 4);
  const counts = new Map<string, number>();
  for (const x of p.assignments) counts.set(x.agentId, (counts.get(x.agentId) ?? 0) + 1);
  ok("bulk: balances the batch 2/2 (running load counts)", counts.get("a") === 2 && counts.get("b") === 2);
}
{
  // Existing load tilts the batch: Bob already has 1 this week, so the two new
  // same-week viewings avoid piling onto him — the batch keeps the WEEK's total
  // load balanced across agents to within one (never all onto the pre-loaded one).
  const p = planBulkAssignments({
    unassigned: [
      { id: "s1", scheduledAtMs: wk1a },
      { id: "s2", scheduledAtMs: wk1b },
    ],
    existing: [{ agentId: "b", scheduledAtMs: wk1c }],
    agents: [mkAgent({ id: "a", name: "Amy" }), mkAgent({ id: "b", name: "Bob" })],
    tz: T,
  });
  ok("bulk: first viewing goes to the less-loaded agent", p.assignments[0].agentId === "a");
  // Total per-agent load = existing + this batch; balanced means max-min <= 1.
  const total = new Map<string, number>([["b", 1]]);
  for (const x of p.assignments) total.set(x.agentId, (total.get(x.agentId) ?? 0) + 1);
  const loads = [total.get("a") ?? 0, total.get("b") ?? 0];
  ok("bulk: keeps the week's total load balanced (max-min <= 1)", Math.max(...loads) - Math.min(...loads) <= 1);
  ok("bulk: never dumps the batch onto the already-loaded agent", (total.get("b") ?? 0) <= 2);
}
{
  // Per-agent weekly capacity is a hard gate for the batch: two capacity-1 agents,
  // three same-week viewings -> each takes exactly ONE, the third has nobody with
  // room and is left for manual routing (overflow-skip, not an overrun).
  const p = planBulkAssignments({
    unassigned: [
      { id: "s1", scheduledAtMs: wk1a },
      { id: "s2", scheduledAtMs: wk1b },
      { id: "s3", scheduledAtMs: wk1c },
    ],
    existing: [],
    agents: [
      mkAgent({ id: "capA", name: "CapA", weeklyCapacity: 1 }),
      mkAgent({ id: "capB", name: "CapB", weeklyCapacity: 1 }),
    ],
    tz: T,
  });
  ok("bulk: fills both capped agents to their cap", p.assignments.length === 2);
  const a1 = p.assignments.filter((x) => x.agentId === "capA").length;
  const b1 = p.assignments.filter((x) => x.agentId === "capB").length;
  ok("bulk: neither capped agent overruns capacity", a1 === 1 && b1 === 1);
  ok("bulk: the overflow viewing is skipped, not overrun", p.skipped.length === 1 && p.skipped[0] === "s3");
}
{
  // Everyone capped + already full this week -> nothing assignable, all skipped.
  const p = planBulkAssignments({
    unassigned: [
      { id: "s1", scheduledAtMs: wk1a },
      { id: "s2", scheduledAtMs: wk1b },
    ],
    existing: [
      { agentId: "x", scheduledAtMs: wk1c },
      { agentId: "y", scheduledAtMs: wk1d },
    ],
    agents: [
      mkAgent({ id: "x", name: "Ex", weeklyCapacity: 1 }),
      mkAgent({ id: "y", name: "Why", weeklyCapacity: 1 }),
    ],
    tz: T,
  });
  ok("bulk: all-full week assigns nothing", p.assignments.length === 0);
  ok("bulk: all-full week skips every viewing", p.skipped.length === 2);
}
{
  // Capacity is PER week: a capacity-1 agent full THIS week is still free NEXT week.
  const p = planBulkAssignments({
    unassigned: [
      { id: "thisWk", scheduledAtMs: wk1a },
      { id: "nextWk", scheduledAtMs: wk2a },
    ],
    existing: [{ agentId: "solo", scheduledAtMs: wk1b }], // fills week 1
    agents: [mkAgent({ id: "solo", name: "Solo", weeklyCapacity: 1 })],
    tz: T,
  });
  ok("bulk: this-week viewing skipped (agent full this week)", p.skipped.includes("thisWk"));
  ok("bulk: next-week viewing still assigned (fresh weekly capacity)", p.assignments.some((x) => x.showingId === "nextWk"));
}
{
  // Archived agents are ignored; a null-time viewing can't be week-bucketed so it
  // is skipped for manual routing.
  const p = planBulkAssignments({
    unassigned: [
      { id: "timed", scheduledAtMs: wk1a },
      { id: "notime", scheduledAtMs: null },
    ],
    existing: [],
    agents: [
      mkAgent({ id: "gone", name: "Gone", archived: true }),
      mkAgent({ id: "here", name: "Here" }),
    ],
    tz: T,
  });
  ok("bulk: routes to the non-archived agent", p.assignments.some((x) => x.agentId === "here"));
  ok("bulk: never routes to an archived agent", !p.assignments.some((x) => x.agentId === "gone"));
  ok("bulk: null-time viewing is skipped", p.skipped.includes("notime"));
}

// --- summary ----------------------------------------------------------------
if (failed === 0) console.log(`✓ showing-agents: ${passed} passed`);
else {
  console.error(`✗ showing-agents: ${failed} failed, ${passed} passed`);
  process.exit(1);
}
