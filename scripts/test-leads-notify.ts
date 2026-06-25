// Unit tests for the pure leasing.new_lead recipient resolver.
// Run: npx tsx scripts/test-leads-notify.ts
import { resolveLeadNotifyEmails } from "../lib/leads-notify";
import type { NotifyMember } from "../lib/incident-reports";

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

console.log(`\nleads-notify: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
