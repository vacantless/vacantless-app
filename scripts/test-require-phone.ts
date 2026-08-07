// S629 Lane B — pure test for the inquiry phone-gate logic.
//
// The gate is intentionally trivial and lives inline in submitLead
// (app/r/[propertyId]/actions.ts): when an org has inquiry_require_phone = true
// and the submitted phone is blank, the lead is NOT inserted (the renter is
// redirected to ?error=1, mirroring the client-side `required`). This test pins
// that truth table so the behavior can't silently regress.
//
// Run: npx tsx scripts/test-require-phone.ts

function phoneGateBlocks(requirePhone: boolean, phone: string): boolean {
  // Mirrors submitLead: only blocks when the org requires a phone AND the
  // submitted phone is empty/whitespace. Phone is trimmed before this check.
  return requirePhone && phone.trim().length === 0;
}

let failures = 0;
function check(label: string, got: boolean, want: boolean) {
  if (got !== want) {
    failures++;
    console.error(`FAIL: ${label} — got ${got}, want ${want}`);
  } else {
    console.log(`ok: ${label}`);
  }
}

// Flag ON: blank/whitespace phone is blocked; a real phone passes.
check("require + empty -> block", phoneGateBlocks(true, ""), true);
check("require + whitespace -> block", phoneGateBlocks(true, "   "), true);
check("require + present -> allow", phoneGateBlocks(true, "416-555-0199"), false);

// Flag OFF (every org that never flips it): never blocks, blank or not.
check("optional + empty -> allow", phoneGateBlocks(false, ""), false);
check("optional + present -> allow", phoneGateBlocks(false, "416-555-0199"), false);

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nAll phone-gate tests passed.");
