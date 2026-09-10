// Tests for lib/address-unit.ts (lifted from scripts/test-listing-fill-sheet.ts
// in S695, assertions unchanged).
import { splitAddressUnit } from "../lib/address-unit";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  x ${name}`);
  }
}

// --- splitAddressUnit (S264 finding #2) ------------------------------------
{
  const a = splitAddressUnit("123 Spadina Ave, Unit 808, Toronto, Ontario M5V 2K4");
  ok("split: unit extracted", a.unit === "808");
  ok(
    "split: street drops the unit segment + tidies commas",
    a.street === "123 Spadina Ave, Toronto, Ontario M5V 2K4",
  );
}
ok("split: 'Suite 12B'", splitAddressUnit("5 King St, Suite 12B").unit === "12B");
ok("split: 'Apt 4'", splitAddressUnit("5 King St Apt 4").unit === "4");
ok("split: 'Apartment 9'", splitAddressUnit("5 King St, Apartment 9").unit === "9");
ok("split: '#808'", splitAddressUnit("123 Spadina Ave #808").unit === "808");
{
  const a = splitAddressUnit("833 Pillette Road, Windsor, ON");
  ok("split: no unit -> street unchanged", a.street === "833 Pillette Road, Windsor, ON");
  ok("split: no unit -> unit null", a.unit === null);
}
{
  const a = splitAddressUnit(null);
  ok("split: null in -> both null", a.street === null && a.unit === null);
}
// --- unit-adjacent parenthetical alias (S433, mirrors migration 0112) ------
{
  // "Unit 1 (Main)" is one unit designation: the alias strips WITH the token so
  // the triplex's three units land on one building street label.
  const a = splitAddressUnit("506 Manning Avenue, Unit 1 (Main), Toronto, ON M6G 2V7");
  ok("split: unit-adjacent (Main) stripped from street", a.street === "506 Manning Avenue, Toronto, ON M6G 2V7");
  ok("split: unit token still extracted alongside alias", a.unit === "1");
}
ok(
  "split: (Upper) alias variant collapses to the same street",
  splitAddressUnit("506 Manning Avenue, Unit 2 (Upper), Toronto, ON M6G 2V7").street ===
    "506 Manning Avenue, Toronto, ON M6G 2V7",
);
ok(
  "split: STANDALONE parenthetical (no unit token) is left intact",
  splitAddressUnit("123 Main St (North Tower), Toronto").street === "123 Main St (North Tower), Toronto",
);

// --- summary ---------------------------------------------------------------
console.log(`\naddress-unit: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
