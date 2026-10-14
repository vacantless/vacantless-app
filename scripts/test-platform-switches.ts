import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { builtInSwitchOn, orgHasSwitch, orgsWithSwitch } from "../lib/platform-switches";

const AGILE = "921f7c08-98af-428f-a238-36f4a781b0de";
const fake = (rows: unknown[] | null, error: unknown = null) => ({
  from: () => ({ select: () => ({ eq: () => ({ in: async () => ({ data: rows, error }) }) }) }),
});

async function main() {
  assert.ok(builtInSwitchOn("shared_sms_number", AGILE));
  assert.ok(!builtInSwitchOn("shared_sms_number", "other"));
  // Built in works with no database at all.
  assert.ok(await orgHasSwitch(null, "shared_sms_number", AGILE));
  assert.ok(!(await orgHasSwitch(null, "shared_sms_number", "other")));
  // A staff row turns another account on; a disabled row does not.
  assert.ok(await orgHasSwitch(fake([{ organization_id: "o2", enabled: true }]), "shared_sms_number", "o2"));
  assert.ok(!(await orgHasSwitch(fake([{ organization_id: "o2", enabled: false }]), "shared_sms_number", "o2")));
  // Table missing: built in only, never throws.
  assert.ok(!(await orgHasSwitch(fake(null, { code: "42P01" }), "answers_own_enquiries", "o2")));
  const set = await orgsWithSwitch(fake([{ organization_id: "o3", enabled: true }]), "shared_sms_number", [AGILE, "o3", "o4", null]);
  assert.deepEqual([...set].sort(), [AGILE, "o3"].sort());
  // The table is staff-only: no grant to authenticated or anon.
  const mig = readFileSync("supabase/migrations/0247_platform_org_switches.sql", "utf8");
  assert.ok(/revoke all on public\.platform_org_switches from anon, authenticated/.test(mig));
  assert.ok(!/grant[^;]*platform_org_switches[^;]*to authenticated/.test(mig));
  console.log("platform-switches: all checks passed");
}
main();
