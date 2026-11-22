// S829d: a rental's missing postal code is filled at save (KI1752).
// Run: npx tsx scripts/test-s829d-postal-fill.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { addressWithoutUnit, postalFromText } from "../lib/postal-fill";

let passed = 0;
const ok = (fn: () => void) => {
  fn();
  passed++;
};
ok(() => assert.equal(postalFromText("251 Manitoba St, Suite 124, Toronto, ON M8Y 0C7"), "M8Y 0C7"));
ok(() => assert.equal(postalFromText("x m4t1k4 y"), "M4T 1K4"));
ok(() => assert.equal(postalFromText("50 Glenrose Ave, Unit B, Toronto, ON"), null));
ok(() => assert.equal(postalFromText(null, "50 Glenrose Avenue, Toronto, ON M4T 1K4, Canada"), "M4T 1K4"));
// Not a postal code: D, F, I, O, Q, U never appear; a unit like "B2B 2B2" style is fine but "Unit 1A2" is not six characters.
ok(() => assert.equal(postalFromText("Unit 1A2, 5 Main St"), null));
ok(() => assert.equal(postalFromText("D1A 1A1"), null));
ok(() => assert.equal(addressWithoutUnit("50 Glenrose Ave, Unit B, Toronto, ON"), "50 Glenrose Ave, Toronto, ON"));
ok(() => assert.equal(addressWithoutUnit("251 Manitoba St, Suite 124, Toronto, ON M8Y 0C7"), "251 Manitoba St, Toronto, ON M8Y 0C7"));
ok(() => assert.equal(addressWithoutUnit("88 Lakeview Ave"), "88 Lakeview Ave"));
const src = readFileSync("app/dashboard/properties/actions.ts", "utf8");
ok(() => assert.equal(src.split("await fillMissingPostalCode(supabase,").length, 3));
ok(() => assert.ok(src.includes('.is("postal_code", null)')));
console.log(`test-s829d-postal-fill: ${passed} passed`);
