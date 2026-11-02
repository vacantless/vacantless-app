// Run with: npx tsx scripts/test-standard-lease.ts
// S743: the Ontario Standard Lease (2229E) placements, address parsing and form reading.
import {
  parseCanadianAddress, splitName, formDate, formMoney, parseMoneyCents, standardLeasePlacements,
  standardLeaseMissing, standardLeaseProblems, overflowLines, detailsFromForm, isOntarioRental,
  carryForwardDetails, type StandardLeaseInput,
} from "../lib/standard-lease";
import { pdfSafe } from "../lib/standard-lease-pdf";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => (c ? pass++ : (fail++, console.error(`FAIL: ${n}`)));

const a = parseCanadianAddress("1551 Assumption St, Unit 9, Windsor, ON N9A 3E2");
ok("unit", a.unit === "9"); ok("number", a.streetNumber === "1551"); ok("street", a.streetName === "Assumption St");
ok("city", a.city === "Windsor"); ok("province", a.province === "Ontario"); ok("postal", a.postalCode === "N9A 3E2");
const b = parseCanadianAddress("12-34 King St W, Toronto, Ontario, M5V1A1");
ok("dash unit", b.unit === "12" && b.streetNumber === "34" && b.streetName === "King St W");
ok("postal spaced", b.postalCode === "M5V 1A1" && b.city === "Toronto" && b.province === "Ontario");
ok("blank address", parseCanadianAddress(null).streetName === "");
ok("ontario default", isOntarioRental("50 Glenrose Ave, Toronto") && !isOntarioRental("1 Main St, Calgary, AB T2P 1J9"));

ok("split two", splitName("Avani Shah").first === "Avani" && splitName("Avani Shah").last === "Shah");
ok("split one", splitName("Cher").last === "Cher" && splitName("Cher").first === "");
ok("date", formDate("2026-12-01") === "2026/12/01" && formDate(null) === "");
ok("money", formMoney(109500) === "1,095.00" && formMoney(null) === "");
ok("parse money", parseMoneyCents("$1,095.5") === 109550 && parseMoneyCents("abc") === null);
ok("pdf safe", pdfSafe("It\u2019s \u2014 fine\u2026") === "It's - fine...");

const base: StandardLeaseInput = {
  landlordName: "Agile Real Estate Group Inc.", tenantNames: ["Avani Shah", "Rez Joseph", "A B", "C D", "E F"],
  propertyAddress: "1551 Assumption St, Unit 9, Windsor, ON N9A 3E2", startDate: "2026-12-01", endDate: null,
  termMonths: null, rentCents: 109500, depositCents: 109500, hasAdditionalTerms: true, details: {},
};
const p = standardLeasePlacements(base);
const texts = p.filter((x) => x.kind === "text").map((x) => (x as { text: string }).text);
ok("landlord printed", texts.includes("Agile Real Estate Group Inc."));
ok("4 tenants on the form", texts.includes("Shah") && texts.includes("D") && !texts.includes("F"));
ok("5th tenant overflows", overflowLines(base)[0]?.includes("E F") === true);
ok("province not printed again", !texts.includes("Ontario"));
ok("monthly checked when no end", p.some((x) => x.kind === "check" && x.page === 2 && x.y === 367));
ok("deposit checked", p.some((x) => x.kind === "check" && x.page === 4 && x.y === 193) && texts.includes("1,095.00"));
ok("terms attached", p.some((x) => x.kind === "check" && x.page === 6 && x.y === 153));
ok("payable to defaults to landlord", p.some((x) => x.kind === "text" && x.page === 3 && (x as { text: string }).text === "Agile Real Estate Group Inc."));
const fixed = standardLeasePlacements({ ...base, endDate: "2027-11-30" });
ok("fixed term", fixed.some((x) => x.kind === "text" && (x as { text: string }).text === "2027/11/30"));
const withCharges = standardLeasePlacements({ ...base, details: { parkingRentCents: 5000, otherCharges: [{ label: "Locker", cents: 2500 }] } });
ok("total adds charges", withCharges.some((x) => x.kind === "text" && (x as { text: string }).text === "1,170.00"));
ok("missing lists answers", standardLeaseMissing(base).includes("how rent is paid"));
ok("nsf cap", standardLeaseProblems({ ...base, details: { nsfChargeCents: 2500 } }).length === 1);
ok("deposit cap", standardLeaseProblems({ ...base, depositCents: 200000 }).length === 1);

const form: Record<string, string> = { is_condo: "no", email_notices: "yes", email_addresses: "a@b.ca", gas: "yes", heat: "landlord", nsf_charge: "20", charge1_label: "Locker", charge1_amount: "25" };
const d = detailsFromForm((n) => form[n] ?? null);
ok("form condo", d.isCondo === false && d.emailNotices === true && d.gas === "yes" && d.heat === "landlord");
ok("form unknown stays null", d.water === null && d.tenantInsuranceRequired === null);
ok("form money", d.nsfChargeCents === 2000 && d.otherCharges?.[0].cents === 2500);
ok("carry drops rental parts", carryForwardDetails({ parking: "x", heat: "tenant" }).parking === undefined);

console.log(`\nstandard-lease: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
