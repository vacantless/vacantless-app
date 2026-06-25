// Unit tests for the pure leasing.new_lead recipient resolver.
// Run: npx tsx scripts/test-leads-notify.ts
import { resolveLeadNotifyEmails, formatLeadScreeningBlock } from "../lib/leads-notify";
import type { NotifyMember } from "../lib/incident-reports";
import type { CustomAnswerSnapshot } from "../lib/screening-questions";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

// Real roles: owner_admin + operator hold manage_leads; showing_helper does not.
const owner: NotifyMember = { role: "owner_admin", email: "Owner@Agile.ca" };
const operator: NotifyMember = { role: "operator", email: "op@agile.ca" };
const helper: NotifyMember = { role: "showing_helper", email: "helper@agile.ca" };

// owner_admin/operator hold manage_leads; resolved, lowercased, deduped.
ok(
  "includes leasing roles, lowercased",
  JSON.stringify(resolveLeadNotifyEmails([owner, operator])) ===
    JSON.stringify(["owner@agile.ca", "op@agile.ca"]),
);

// a showing_helper (no manage_leads) is excluded.
ok(
  "excludes showing_helper",
  !resolveLeadNotifyEmails([helper]).includes("helper@agile.ca"),
);

// dedupe identical addresses across members.
ok(
  "dedupes",
  resolveLeadNotifyEmails([
    { role: "owner_admin", email: "x@agile.ca" },
    { role: "operator", email: "X@agile.ca" },
  ]).length === 1,
);

// no qualifying member -> first usable fallback only.
ok(
  "falls back to first usable address",
  JSON.stringify(
    resolveLeadNotifyEmails([helper], [null, "  ", "rentals@agile.ca", "second@agile.ca"]),
  ) === JSON.stringify(["rentals@agile.ca"]),
);

// members present -> fallbacks ignored.
ok(
  "fallbacks ignored when members resolve",
  JSON.stringify(resolveLeadNotifyEmails([owner], ["rentals@agile.ca"])) ===
    JSON.stringify(["owner@agile.ca"]),
);

// junk / blank emails dropped.
ok(
  "drops blank/invalid member emails",
  resolveLeadNotifyEmails([
    { role: "owner_admin", email: "" },
    { role: "owner_admin", email: "notanemail" },
    { role: "owner_admin", email: null },
  ]).length === 0,
);

// nothing at all -> empty (caller skips the send).
ok("empty when no members and no fallback", resolveLeadNotifyEmails([]).length === 0);

// unknown/missing role floors to showing_helper -> never qualifies.
ok(
  "unknown role excluded",
  resolveLeadNotifyEmails([{ role: null, email: "ghost@agile.ca" }]).length === 0,
);

// --- formatLeadScreeningBlock (S332 notification parity) --------------------
const employment: CustomAnswerSnapshot = {
  question_id: "q1", prompt: "Employment", qtype: "choice", answer: "Employed full-time",
};
const otherUnits: CustomAnswerSnapshot = {
  question_id: "q2", prompt: "Other units of interest", qtype: "units", answer: "2419 Mercer Street",
};
const yesnoRef: CustomAnswerSnapshot = {
  question_id: "q3", prompt: "Have references?", qtype: "yesno", answer: "yes",
};

// Full snapshot: order = occupants, pets, income, then custom answers; matches
// the lead-detail page labels.
{
  const block = formatLeadScreeningBlock({
    screen_income_cents: 450000,
    screen_occupants: 3,
    screen_has_pets: true,
    screen_pets_detail: "one cat",
    screen_custom_answers: [employment, otherUnits, yesnoRef],
  });
  ok("screening: starts with header", block.startsWith("Screening\n"));
  ok("screening: occupants first", block.includes("Occupants: 3"));
  ok("screening: pets uses detail", block.includes("Pets: one cat"));
  ok("screening: income formatted", block.includes("Stated monthly income: $4,500"));
  ok("screening: custom prompt + answer", block.includes("Employment: Employed full-time"));
  ok("screening: units answer", block.includes("Other units of interest: 2419 Mercer Street"));
  ok("screening: yesno -> Yes", block.includes("Have references?: Yes"));
  // Order: occupants before pets before income before custom.
  ok(
    "screening: ordered",
    block.indexOf("Occupants") < block.indexOf("Pets") &&
      block.indexOf("Pets") < block.indexOf("income") &&
      block.indexOf("income") < block.indexOf("Employment"),
  );
}

// Pets boolean with no detail -> Yes / No.
ok(
  "screening: pets boolean No",
  formatLeadScreeningBlock({
    screen_income_cents: null, screen_occupants: null,
    screen_has_pets: false, screen_pets_detail: null, screen_custom_answers: [],
  }) === "Screening\nPets: No",
);

// Nothing collected -> "" (so the template's blank lines collapse).
ok(
  "screening: empty -> empty string",
  formatLeadScreeningBlock({
    screen_income_cents: null, screen_occupants: null,
    screen_has_pets: null, screen_pets_detail: null, screen_custom_answers: [],
  }) === "",
);
ok("screening: null snapshot -> empty string", formatLeadScreeningBlock(null) === "");

// A custom answer that is blank/whitespace is dropped, not shown as an empty line.
ok(
  "screening: drops blank custom answer",
  formatLeadScreeningBlock({
    screen_income_cents: null, screen_occupants: 2,
    screen_has_pets: null, screen_pets_detail: null,
    screen_custom_answers: [{ question_id: "qx", prompt: "Notes", qtype: "text", answer: "   " }],
  }) === "Screening\nOccupants: 2",
);

console.log(`\nleads-notify: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
