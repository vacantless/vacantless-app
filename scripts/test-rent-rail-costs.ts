import { stripeFeeCents, monthlyRailCosts, rotessaCheaperFrom, dollars, RAIL_TABLE_RENT_CENTS } from "../lib/rent-rail-costs";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) { if (cond) pass++; else { fail++; console.log("FAIL", name); } }

ok("stripe: $300 rent = 1% + 40c", stripeFeeCents(30000) === 340);
ok("stripe: capped at $5", stripeFeeCents(150000) === 500);
ok("stripe: cap starts at $460", stripeFeeCents(46000) === 500 && stripeFeeCents(45000) === 490);
ok("one rental", monthlyRailCosts(1, RAIL_TABLE_RENT_CENTS).stripeCents === 500 && monthlyRailCosts(1, RAIL_TABLE_RENT_CENTS).rotessaCents === 2550);
ok("ten rentals", monthlyRailCosts(10, RAIL_TABLE_RENT_CENTS).stripeCents === 5000 && monthlyRailCosts(10, RAIL_TABLE_RENT_CENTS).rotessaCents === 3000);
ok("zero rentals cost nothing", monthlyRailCosts(0, RAIL_TABLE_RENT_CENTS).rotessaCents === 0);
ok("rotessa cheaper from 6 rentals", rotessaCheaperFrom(RAIL_TABLE_RENT_CENTS) === 6);
ok("dollars", dollars(2550) === "$25.50" && dollars(500) === "$5" && dollars(12500) === "$125");

console.log(`test-rent-rail-costs: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
