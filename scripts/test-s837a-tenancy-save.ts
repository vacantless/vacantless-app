// S837a: a failed tenancy save leaves no orphan rental and says so
// (REVIEW-S835 finding 11). Run: npx tsx scripts/test-s837a-tenancy-save.ts
import { readFileSync } from "node:fs";
import { tenancyErrorMessage } from "../lib/tenancy";
import { scheduleStillRunning } from "../lib/stripe-connect";

let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) console.log(`ok   ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}`);
  }
}
const actions = readFileSync("app/dashboard/tenancies/actions.ts", "utf8");
const create = actions.slice(
  actions.indexOf("export async function createTenancy"),
  actions.indexOf("export async function watchLease"),
);
const made = create.indexOf("createdPropertyId = propertyId;");
ok("the rental made on the form is remembered", made > create.indexOf('status: "off_market"'));
ok("cleanup deletes only that rental in this account",
  /from\("properties"\)\s*\.delete\(\)\s*\.eq\("id", createdPropertyId\)\s*\.eq\("organization_id", org\.id\)/.test(create));
const after = create.slice(made);
ok("no plain guardFail after the rental exists", !/\bguardFail\(/.test(after));
ok("every later check cleans up", (after.match(/await failAndClean\(/g) ?? []).length === 4);
ok("failed tenancy insert goes back to the form", create.includes('if (!tenancyId) return failAndClean("tenancy_save");'));
ok("no silent drop on the list", !create.includes('if (!tenancyId) redirect("/dashboard/tenancies");'));
ok("tenant insert is checked", create.includes("const { error: tenantsError } = await supabase.from(\"tenants\").insert(tenantRows);"));
ok("tenant failure shown on the tenancy", create.includes('tenantsFailed ? "&err=tenants_save" : ""'));
ok("form message", (tenancyErrorMessage("tenancy_save") ?? "").includes("nothing was kept"));
ok("tenancy page message", (tenancyErrorMessage("tenants_save") ?? "").includes("Add the tenant on this page"));
ok("no em dashes in the new lines", !/—/.test(tenancyErrorMessage("tenancy_save")! + tenancyErrorMessage("tenants_save")!));

// Second-year rent increase: a released schedule is replaced, not updated.
ok("active schedule is reused", scheduleStillRunning("active") && scheduleStillRunning("not_started"));
ok("released, completed, canceled are not", !scheduleStillRunning("released") && !scheduleStillRunning("completed") && !scheduleStillRunning("canceled") && !scheduleStillRunning(null));
const rent = readFileSync("app/dashboard/tenancies/stripe-rent-actions.ts", "utf8");
const upd = rent.slice(rent.indexOf("export async function updateStripeRentAmount"));
ok("a stopped schedule falls through to a fresh one",
  /if \(!scheduleStillRunning\(storedSched\.status\)\) \{\s*storedSched = null;\s*scheduleId = null;/.test(upd)
  && upd.indexOf("scheduleStillRunning(") < upd.indexOf("subscriptionSchedules.create("));
ok("the fresh schedule id is saved", upd.includes("stripe_subscription_schedule_id: scheduleId,"));

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall passed");
