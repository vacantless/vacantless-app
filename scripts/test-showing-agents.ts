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

// --- summary ----------------------------------------------------------------
if (failed === 0) console.log(`✓ showing-agents: ${passed} passed`);
else {
  console.error(`✗ showing-agents: ${failed} failed, ${passed} passed`);
  process.exit(1);
}
