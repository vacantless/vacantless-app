import { sisterFillPatch, sameBuilding, needsSisterFill } from "../lib/sister-unit-fill";
let pass = 0, fail = 0;
function ok(n: string, c: boolean) { if (c) pass++; else { fail++; console.log("FAIL", n); } }
const src = { rent_cents: 122500, beds: 1, baths: 1, sqft: 500, description: "Bright one bedroom", ac_type: "sleeve", amenities: ["storage_locker"], laundry: "shared", heat_included: false };
const p = sisterFillPatch({ rent_cents: null, beds: null, description: "", amenities: [], heat_included: null }, src);
ok("fills empty", p.rent_cents === 122500 && p.beds === 1 && p.description === "Bright one bedroom");
ok("fills empty array", Array.isArray(p.amenities));
ok("copies false booleans", p.heat_included === false);
const q = sisterFillPatch({ rent_cents: 145000, sqft: 600 }, src);
ok("never overwrites", q.rent_cents === undefined && q.sqft === undefined);
ok("no unit-specific fields", !("floor" in sisterFillPatch({}, { ...src, floor: "3", balcony: true } as never)));
ok("same building", sameBuilding("833 Pillette Rd, Unit 3, Windsor, ON", "833 Pillette Rd, Unit 33, Windsor, ON"));
ok("other building", !sameBuilding("833 Pillette Rd, Unit 3, Windsor, ON", "1551 Assumption St, Unit 9, Windsor, ON"));
ok("null address", !sameBuilding(null, "833 Pillette Rd, Unit 3"));
ok("needs fill", needsSisterFill({ rent_cents: null }) && !needsSisterFill({ rent_cents: 1, beds: 1, description: "x", sqft: 500 }));
console.log(`test-sister-unit-fill: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
