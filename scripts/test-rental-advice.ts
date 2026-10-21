// Run with: npx tsx scripts/test-rental-advice.ts
// S727: per-rental advice from the landlord's own enquiries.
import { buildRentalAdvice, rentalRates, shortAddress, type RentalLite } from "../lib/rental-advice";
import type { LeadLite } from "../lib/reports";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, info?: unknown) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`, info ?? "");
  }
}
const now = Date.parse("2026-10-20T18:00:00Z");
const daysAgo = (d: number) => new Date(now - d * 86400000).toISOString();
const rental = (id: string, address: string, listedDaysAgo: number, status = "available"): RentalLite => ({
  id, address, status, created_at: daysAgo(listedDaysAgo + 5), available_since: daysAgo(listedDaysAgo),
});
let n = 0;
const leadsFor = (pid: string, count: number, status = "new", ageDays = 3): LeadLite[] =>
  Array.from({ length: count }, () => ({
    id: `l${n++}`, source: "Kijiji", status: status as LeadLite["status"], created_at: daysAgo(ageDays), leased_date: null, property_id: pid,
  }));

ok("short address keeps unit", shortAddress("833 Pillette Rd, Unit 3, Windsor, ON N8Y 3B4") === "833 Pillette Rd, Unit 3");
ok("short address no unit", shortAddress("100 Lakeview Ave, Windsor, ON") === "100 Lakeview Ave");

// Agile on 2026-10-20 (from SQL): Bruce 5/0 booked, Assumption 9/1, P3 3, P33 0, P36 1.
const agile = [
  rental("bruce", "1195 Bruce Ave, Unit 303, Windsor, ON", 25),
  rental("assum", "1551 Assumption St, Unit 9, Windsor, ON", 22),
  rental("p3", "833 Pillette Rd, Unit 3, Windsor, ON", 68),
  rental("p33", "833 Pillette Rd, Unit 33, Windsor, ON", 100),
  rental("p36", "833 Pillette Rd, Unit 36, Windsor, ON", 46),
];
const agileLeads = [
  ...leadsFor("bruce", 5), ...leadsFor("assum", 8), ...leadsFor("assum", 1, "booked"),
  ...leadsFor("p3", 3), ...leadsFor("p36", 1),
];
const a = buildRentalAdvice(agile, agileLeads, now);
ok("agile: three lines", a.length === 3, a);
ok("agile: Unit 33 flagged first", a[0]?.propertyId === "p33" && a[0].text.startsWith("833 Pillette Rd, Unit 33 got 0 inquiries in the last 14 days."), a[0]);
ok("agile: Unit 36 flagged", a[1]?.propertyId === "p36", a[1]);
ok("agile: Bruce no bookings", a[2]?.propertyId === "bruce" && a[2].text.includes("no viewing booked"), a[2]);
ok("agile: Unit 3 not flagged", !a.some((x) => x.propertyId === "p3"));
ok("no em dashes", !a.some((x) => x.text.includes("—")));

ok("one rental, no advice", buildRentalAdvice([agile[0]], leadsFor("bruce", 9), now).length === 0);
ok("all quiet, no advice", buildRentalAdvice(agile, [], now).length === 0);
ok("new rental not judged", rentalRates([rental("new", "1 New St", 3)], [], now).length === 0);
ok("leased rental skipped", rentalRates([rental("x", "1 X St", 30, "leased")], [], now).length === 0);
const old = leadsFor("p33", 6, "new", 20);
ok("enquiries older than 14 days ignored", rentalRates([agile[3]], old, now)[0].enquiries === 0);
const fresh = [rental("f", "2 Fresh St", 7), rental("g", "3 Good St", 30)];
const r = rentalRates(fresh, [...leadsFor("f", 2), ...leadsFor("g", 4)], now);
ok("short listing uses its own days", r[0].days === 7 && Math.abs(r[0].perWeek - 2) < 0.01, r);

// Best rental line appears only alongside a slow one.
const three = [rental("a", "1 A St", 30), rental("b", "2 B St", 30), rental("c", "3 C St", 30)];
const b = buildRentalAdvice(three, [...leadsFor("a", 10), ...leadsFor("b", 6), ...leadsFor("c", 0)], now);
ok("good line names the best", b.some((x) => x.tone === "good" && x.propertyId === "a"), b);

console.log(`rental-advice: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
