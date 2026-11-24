// S840e: migration 0332 keeps what a returning renter wrote.
// Applied 2026-11-24 and proven by a rolled-back call on Lakeview 100: the
// second send saved "They wrote: <their note>" on the same record.
// Run: npx tsx scripts/test-s840e-returning-renter-message.ts
import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}

const sql = readFileSync("supabase/migrations/0332_returning_renter_keeps_message.sql", "utf8");
ok("reads the live function", sql.includes("pg_get_functiondef("));
ok("replaces the Wrote again line only", sql.includes("Same renter, so this stays on one record.") && sql.includes("replace(v_def, a_line, b_line)"));
ok("adds the renter's words", sql.includes("'They wrote: ' || nullif(btrim(p_notes), '')"));
ok("stops if the function changed", sql.includes("raise exception '0332:"));
ok("safe to run twice", sql.includes("already applied"));
ok("additive, no drop", !/\bdrop\s+(table|function|column|index|policy|trigger)/i.test(sql));

const actions = readFileSync("app/r/[propertyId]/actions.ts", "utf8");
ok("p_notes still carries the times that suit them", actions.includes("p_notes: notesWithAvailability(notes, availability)"));

console.log(`s840e returning renter message: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
