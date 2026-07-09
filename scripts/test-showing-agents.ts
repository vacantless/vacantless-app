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
  type SuggestCandidate,
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

// --- summary ----------------------------------------------------------------
if (failed === 0) console.log(`✓ showing-agents: ${passed} passed`);
else {
  console.error(`✗ showing-agents: ${failed} failed, ${passed} passed`);
  process.exit(1);
}
