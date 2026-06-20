// Unit tests for the rent-collection "active" signal (IA Step 1, S274).
// Run: npx tsx scripts/test-rent-status.ts
import { isRentCollectionActive, ROTESSA_CONNECTED } from "../lib/rent-status";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

ok("ROTESSA_CONNECTED is 'connected'", ROTESSA_CONNECTED === "connected");

// --- active when Stripe charges enabled -------------------------------------
ok(
  "Stripe charges_enabled=true -> active",
  isRentCollectionActive({ stripeChargesEnabled: true }) === true,
);
ok(
  "Stripe charges_enabled=true even if Rotessa absent -> active",
  isRentCollectionActive({
    stripeChargesEnabled: true,
    rotessaConnectionStatus: null,
  }) === true,
);

// --- active when Rotessa connected ------------------------------------------
ok(
  "Rotessa connected -> active",
  isRentCollectionActive({ rotessaConnectionStatus: "connected" }) === true,
);
ok(
  "Rotessa connected even if Stripe not enabled -> active",
  isRentCollectionActive({
    stripeChargesEnabled: false,
    rotessaConnectionStatus: "connected",
  }) === true,
);

// --- inactive cases ---------------------------------------------------------
ok("nothing set -> inactive", isRentCollectionActive({}) === false);
ok(
  "both rails absent (null) -> inactive",
  isRentCollectionActive({
    stripeChargesEnabled: null,
    rotessaConnectionStatus: null,
  }) === false,
);
ok(
  "Stripe charges_enabled=false -> inactive",
  isRentCollectionActive({ stripeChargesEnabled: false }) === false,
);
ok(
  "Rotessa not_connected -> inactive",
  isRentCollectionActive({ rotessaConnectionStatus: "not_connected" }) === false,
);
ok(
  "Rotessa error -> inactive",
  isRentCollectionActive({ rotessaConnectionStatus: "error" }) === false,
);
ok(
  "Stripe false + Rotessa error -> inactive",
  isRentCollectionActive({
    stripeChargesEnabled: false,
    rotessaConnectionStatus: "error",
  }) === false,
);

// Guard against a truthy-but-not-true charges value (we compare === true).
ok(
  "charges_enabled truthy non-boolean not treated as active",
  isRentCollectionActive({
    stripeChargesEnabled: 1 as unknown as boolean,
  }) === false,
);

console.log(
  `\ntest-rent-status: ${passed} passed, ${failed} failed (${passed + failed} total)`,
);
if (failed > 0) process.exit(1);
