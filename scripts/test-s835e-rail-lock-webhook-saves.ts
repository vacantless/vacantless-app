// S835e: REVIEW-S835 findings 7 and 9.
// Run: npx tsx scripts/test-s835e-rail-lock-webhook-saves.ts
import { readFileSync } from "node:fs";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error("FAIL:", name);
  }
}

// Finding 9: a failed save in the Stripe webhook is an error.
const hook = readFileSync("app/api/stripe/webhook/route.ts", "utf8");
ok("the webhook has one save check", /function mustSave\(/.test(hook) && /throw new Error\(`save_failed:/.test(hook));
ok("rent status, bank authorization and plan saves are checked", (hook.match(/mustSave\(/g) ?? []).length >= 5);
ok("a thrown save releases the event for Stripe's retry", /releaseStripeEvent\(admin, event\.id\)[\s\S]{0,160}status: 500/.test(hook));

// Finding 7: the two rail tables are written by the service role only.
const strip = (s: string) => s.replace(/\/\/.*$/gm, "");
for (const [file, table, cap] of [
  ["app/dashboard/settings/stripe-connect-actions.ts", "stripe_connect_accounts", "manage_rent"],
  ["app/dashboard/settings/rotessa-actions.ts", "rotessa_accounts", "manage_rotessa"],
] as const) {
  const src = strip(readFileSync(file, "utf8"));
  ok(`${table}: writes go through the service role`, /function railWriter\(\) \{\s*return createAdminClient\(\) \?\? createClient\(\);/.test(src));
  const writes = [...src.matchAll(new RegExp(`([A-Za-z()]+)\\s*\\.from\\("${table}"\\)\\s*\\.(upsert|update|delete|insert)\\(`, "g"))];
  ok(`${table}: found its writes`, writes.length === 3);
  ok(`${table}: no write uses the signed-in client`, writes.every((w) => w[1] === "railWriter()" || w[1] === "supabase"));
  ok(`${table}: every action checks ${cap}`, (src.match(new RegExp(`requireCapability\\("${cap}"`, "g")) ?? []).length >= 3);
  ok(`${table}: the account comes from the session`, !/formData\.get\("organization_id"\)/.test(src));
}
const sc = strip(readFileSync("app/dashboard/settings/stripe-connect-actions.ts", "utf8"));
ok("the Stripe writes that use a local client take it from railWriter", (sc.match(/const supabase = railWriter\(\);/g) ?? []).length === 2);

// No other file writes either table.
const others = [
  "app/dashboard/tenancies/stripe-rent-actions.ts",
  "app/dashboard/tenancies/rotessa-actions.ts",
  "lib/stripe-rent-stop.ts",
  "lib/rotessa-rent.ts",
  "app/dashboard/rent/stripe-export/route.ts",
  "app/dashboard/rent/export/route.ts",
];
for (const f of others) {
  const src = strip(readFileSync(f, "utf8"));
  ok(`${f} only reads the rail tables`, !/from\("(stripe_connect_accounts|rotessa_accounts)"\)\s*\.(upsert|update|delete|insert)\(/.test(src));
}

const sql = readFileSync("supabase/migrations/0327_rail_tables_service_writes.sql", "utf8").replace(/^--.*$/gm, "");
ok("0327 refuses user writes on both tables", (sql.match(/as restrictive for (insert|update|delete) to authenticated/g) ?? []).length === 6);
ok("0327 leaves reads alone and drops nothing", !/for select|for all|\bdrop\b|\brevoke\b/i.test(sql));

console.log(`\ns835e rail lock and webhook saves: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
