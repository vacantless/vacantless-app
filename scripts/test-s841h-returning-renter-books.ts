// S841h: a returning renter can book. Migration 0334 lets book_public_showing
// accept a record that submit_public_lead just attached the renter to.
// Run: npx tsx scripts/test-s841h-returning-renter-books.ts
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

const mig = readFileSync("supabase/migrations/0334_returning_renter_can_book.sql", "utf8");
ok("keeps the 15-minute rule for a new record", mig.includes("and (l.created_at > now() - interval '15 minutes'"));
ok("accepts a record the renter was just attached to", mig.includes("m.body like 'Wrote again via %'") && mig.includes("m.created_at > now() - interval '15 minutes'"));
ok("only an inbound note counts", mig.includes("m.channel = 'note'") && mig.includes("m.direction = 'inbound'"));
ok("patches exactly one line or stops", mig.includes("was not found exactly once"));
ok("safe to run twice", mig.includes("already applied"));
ok("additive: nothing is dropped", !/\bdrop\s+(function|table|column|policy)\b/i.test(mig));

// The note's wording is the key the booking function looks for: keep them in step.
const submit = readFileSync("supabase/migrations/0238_returning_renter_same_lead.sql", "utf8");
ok("submit_public_lead writes that note", submit.includes("'Wrote again via '"));

const actions = readFileSync("app/r/[propertyId]/actions.ts", "utf8");
ok("a refused booking is logged with its reason", actions.includes('console.error("[public-booking] refused"'));
ok("the log line carries no renter details", !/\[public-booking\] refused"[^)]*(email|name|phone)/.test(actions));

console.log(`s841h returning renter books: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
