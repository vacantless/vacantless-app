// Focused tests for S575b lease-up take-down dispatch isolation + notify wiring.
// Run: npx tsx scripts/test-leaseup-takedown.ts

import { readFileSync } from "node:fs";
import {
  leaseupTakedownDashboardUrl,
  shouldNotifyLeaseupTakedown,
} from "../lib/leaseup-takedown";

let pass = 0;
let fail = 0;

function ok(name: string, condition: boolean) {
  if (condition) pass++;
  else {
    fail++;
    console.error(`  x ${name}`);
  }
}

ok(
  "operator take-down branch notifies while dark flag is on",
  shouldNotifyLeaseupTakedown({
    featureEnabled: true,
    automatedDelete: false,
    decisionAction: "takedown",
  }),
);
ok(
  "automated delete branch does not notify",
  !shouldNotifyLeaseupTakedown({
    featureEnabled: true,
    automatedDelete: true,
    decisionAction: "takedown",
  }),
);
ok(
  "non-takedown decisions do not notify",
  !shouldNotifyLeaseupTakedown({
    featureEnabled: true,
    automatedDelete: false,
    decisionAction: "steer_to_pool",
  }),
);
ok(
  "flag off does not notify",
  !shouldNotifyLeaseupTakedown({
    featureEnabled: false,
    automatedDelete: false,
    decisionAction: "takedown",
  }),
);
ok(
  "dashboard URL targets Distribute",
  leaseupTakedownDashboardUrl("prop 1") ===
    "https://app.vacantless.com/dashboard/properties/prop%201#distribute-header",
);

const leaseupSource = readFileSync("lib/leaseup-takedown.ts", "utf8");
ok(
  "lease-up items use take-down transport marker",
  leaseupSource.includes("transport: TAKEDOWN_TRANSPORT"),
);
ok(
  "operator branch emits the registered event",
  leaseupSource.includes('eventKey: "leasing.distribution_takedown_needed"'),
);
ok(
  "notification is gated away from automated delete",
  leaseupSource.includes("!args.automatedDelete") &&
    leaseupSource.includes("sendLeaseupTakedownNeededNotification"),
);

const migration = readFileSync(
  "supabase/migrations/0188_distribution_run_items_takedown_transport.sql",
  "utf8",
);
ok("migration allows takedown transport", migration.includes("'takedown'"));

if (fail > 0) {
  console.error(`leaseup-takedown: ${pass}/${pass + fail} passed`);
  process.exit(1);
}

console.log(`leaseup-takedown: ${pass}/${pass + fail} passed`);
