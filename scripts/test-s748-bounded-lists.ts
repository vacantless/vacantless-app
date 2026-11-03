// S748d: the lists a 300-unit account opens stay right past the database's
// 1,000-row cap. Source checks (the pages need a signed-in session to run).
// Run: npx tsx scripts/test-s748-bounded-lists.ts
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

const props = readFileSync("app/dashboard/properties/page.tsx", "utf8");
ok("rentals list counts in the database", /rpc\("property_rollups", \{ p_org: org\.id \}\)/.test(props));
ok("rentals list no longer downloads every lead", !/from\("leads"\)\.select\("property_id"\)/.test(props));
ok("rentals list no longer downloads every photo", !/from\("property_photos"\)\s*\.select\("property_id"\)/.test(props));
ok("photo counts come from the rollup", /photoCounts\.set\(r\.property_id, n\(r\.photos\)\)/.test(props));

const show = readFileSync("app/dashboard/showings/page.tsx", "utf8");
ok("viewings: recent window read in full, oldest first", /\.gte\("scheduled_at", recentFrom\)\s*\.order\("scheduled_at", \{ ascending: true \}\)\s*\.limit\(1000\)/.test(show));
ok("viewings: older ones newest first, capped", /scheduled_at\.lt\.\$\{recentFrom\},scheduled_at\.is\.null[\s\S]{0,120}ascending: false[\s\S]{0,60}\.limit\(PAST_LIMIT\)/.test(show));
ok("viewings: window covers the agent week", /RECENT_WINDOW_DAYS = 8/.test(show));
ok("viewings: no unbounded read left", !/\.order\("scheduled_at", \{ ascending: true \}\);\s*\n\s*const all = \(data/.test(show));

const rec = readFileSync("app/dashboard/money/reconcile/page.tsx", "utf8");
ok("reconcile: newest transactions first, capped", /from\("bank_transactions"\)[\s\S]{0,400}ascending: false \}\)\s*\.limit\(TXN_LIMIT\)/.test(rec));
ok("reconcile: shown oldest first", /\(txnDesc \?\? \[\]\) as BankTxnRow\[\]\)\]\.reverse\(\)/.test(rec));
ok("reconcile: linked rows by id chunk", /\.in\("bank_transaction_id", ids\)/.test(rec) && /ID_CHUNK = 150/.test(rec));
ok("reconcile: unlinked expenses near in date", /\.is\("bank_transaction_id", null\)\s*\.gte\("incurred_on", unlinkedFrom\)/.test(rec));

const sql = readFileSync("supabase/migrations/0271_property_rollups_and_list_indexes.sql", "utf8");
ok("rollup runs as the signed-in user", /security invoker/.test(sql));
ok("rollup closed to anon", /revoke all on function public\.property_rollups\(uuid\) from public, anon/.test(sql));
ok("indexes for the bounded reads", /showings_org_scheduled_idx/.test(sql) && /bank_transactions_org_posted_idx/.test(sql) && /leads_property_id_idx/.test(sql));

console.log(`\ns748 bounded lists: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
