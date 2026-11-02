// S745a: plan, subscription and Stripe columns are locked against signed-in
// writes (migration 0266). These checks keep the app writing them only through
// the service role, and keep the lock list in the migration.
import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log(`FAIL ${name}`);
  }
}
const read = (p: string) => readFileSync(p, "utf8");
const fnBody = (src: string, name: string) => {
  const i = src.indexOf(name);
  if (i < 0) return "";
  const j = src.indexOf("\nexport async function", i + 10);
  const k = src.indexOf("\nasync function", i + 10);
  const ends = [j, k].filter((x) => x > 0);
  return src.slice(i, ends.length ? Math.min(...ends) : undefined);
};

const mig = read("supabase/migrations/0266_lock_billing_columns.sql");
for (const col of [
  "plan",
  "subscription_status",
  "current_period_end",
  "subscription_cancel_at",
  "stripe_customer_id",
  "stripe_subscription_id",
  "pilot_started_at",
  "pilot_deposit_status",
  "concierge",
  "closed_at",
]) {
  ok(`migration locks ${col}`, mig.includes(`new.${col} is distinct from old.${col}`));
}
ok("migration only lets trial move down to free", mig.includes("old.plan = 'trial' and new.plan = 'free'"));
ok("migration skips the service role", mig.includes("current_user not in ('authenticated', 'anon')"));
ok("migration takes landlord writes off feature flags", /revoke insert, update, delete on public\.organization_feature_flags from authenticated/.test(mig));

const billing = read("app/dashboard/billing/actions.ts");
const pilot = fnBody(billing, "export async function startPilot");
ok("startPilot writes through the service role", pilot.includes("createAdminClient()") && !pilot.includes("createClient()"));
ok("startPilot stays owner-only", pilot.includes('requireCapability("manage_billing"'));
const cust = fnBody(billing, "async function ensureCustomer");
ok("ensureCustomer saves the Stripe id through the service role", cust.includes("createAdminClient()") && !cust.includes("createClient()"));

const settings = read("app/dashboard/settings/actions.ts");
const flag = fnBody(settings, "export async function updateOrganizationFeatureFlag");
ok("staff feature switch writes through the service role", flag.includes("const supabase = createAdminClient();"));
ok("staff feature switch still checks staff", flag.includes("isAdminEmail(who?.email, adminEmails())"));

console.log(`\nbilling-columns-locked: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
