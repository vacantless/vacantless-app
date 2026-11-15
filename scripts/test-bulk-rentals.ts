// S799d: add several rentals at once from pasted spreadsheet rows or a CSV.
// Run: npx tsx scripts/test-bulk-rentals.ts
import {
  addressKey,
  joinAddress,
  parseBulkRentals,
  parseCount,
  parseMoneyCents,
  parseSheetDate,
  summarizeBulkRentals,
  BULK_RENTALS_MAX_ROWS,
} from "../lib/bulk-rentals";

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean) => {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL", name);
  }
};

// money, counts, dates
ok("money plain", parseMoneyCents("1450") === 145000);
ok("money dressed", parseMoneyCents("$1,450.00 / mo") === 145000);
ok("money blank or zero", parseMoneyCents("") === null && parseMoneyCents("n/a") === null && parseMoneyCents("0") === null);
ok("count plain", parseCount("2") === 2 && parseCount("1.5") === 1.5);
ok("count worded", parseCount("2 bed") === 2 && parseCount("Studio") === 0 && parseCount("bachelor") === 0);
ok("count den", parseCount("1+1") === 1);
ok("count junk", parseCount("") === null && parseCount("tbd") === null);
ok("date iso", parseSheetDate("2026-02-01") === "2026-02-01");
ok("date slashes month first", parseSheetDate("2/1/2026") === "2026-02-01");
ok("date day first when it must be", parseSheetDate("15/3/2026") === "2026-03-15");
ok("date words", parseSheetDate("Feb 1, 2026") === "2026-02-01" && parseSheetDate("1 February 2026") === "2026-02-01");
ok("date two-digit year", parseSheetDate("3/1/25") === "2025-03-01");
ok("date impossible", parseSheetDate("2/30/2026") === null && parseSheetDate("soon") === null);

// addresses
ok("unit joined", joinAddress({ address: "12 King St", unit: "3" }) === "12 King St, Unit 3");
ok("unit hash", joinAddress({ address: "12 King St", unit: "#3" }) === "12 King St, Unit 3");
ok("unit word kept", joinAddress({ address: "12 King St", unit: "Basement" }) === "12 King St, Basement");
ok("unit already there", joinAddress({ address: "12 King St, Unit 3", unit: "3" }) === "12 King St, Unit 3");
ok("city added once", joinAddress({ address: "12 King St, Windsor", city: "Windsor", province: "ON" }) === "12 King St, Windsor, ON");
ok("key ignores style", addressKey("12 King Street, Apt 3") === addressKey("12 king st unit 3"));

// a sheet pasted from Excel: tabs, a header in any order, dressed values
const sheet = [
  "Unit\tAddress\tBR\tBath\tMonthly Rent\tTenant\tEmail\tLease Start\tLease End\tNotes",
  "1\t12 King St, Windsor ON\t2\t1\t$1,450.00\tAva Lee\tAva@Example.com\t2/1/2026\t1/31/2027\tok",
  "2\t12 King St, Windsor ON\t1\t1\t1,200\t\t\t\t\t",
  "",
  "3\t12 King St, Windsor ON\tStudio\t1\t950\tSam Roy\tnot-an-email\t\t\t",
  "\t\t\t\t800\t\t\t\t\t",
].join("\n");
const r = parseBulkRentals(sheet);
ok("header seen", r.hadHeader && r.unreadColumns.length === 1 && r.unreadColumns[0] === "Notes");
ok("four rows, blank line dropped", r.rows.length === 4);
const [a, b, c, d] = r.rows;
ok("row 1 address and unit", a.address === "12 King St, Windsor ON, Unit 1");
ok("row 1 numbers", a.rentCents === 145000 && a.beds === 2 && a.baths === 1);
ok("row 1 tenant", a.tenantName === "Ava Lee" && a.tenantEmail === "ava@example.com");
ok("row 1 lease", a.leaseStart === "2026-02-01" && a.leaseEnd === "2027-01-31" && a.problems.length === 0);
ok("row 2 vacant", b.tenantName === null && b.problems.length === 0 && b.rentCents === 120000);
ok("row 3 studio, bad email noted, no start noted", c.beds === 0 && c.tenantEmail === null && c.notes.length === 2 && c.problems.length === 0);
ok("row 4 no address is a problem", d.problems.includes("No address"));
ok("line numbers follow the paste", a.line === 2 && c.line === 5);
const sum = summarizeBulkRentals(r.rows);
ok("summary", sum.ready === 3 && sum.skipped === 1 && sum.withTenancy === 1 && sum.leasedNoTenancy === 1 && sum.drafts === 1);

// CSV with quoted commas; a rental already in the account; a repeat in the paste
const csv = [
  "Address,Rent,Beds,Baths",
  '"45 Elm Ave, Unit 2, Toronto",1800,2,1',
  '"45 Elm Avenue, Apt 2, Toronto",1800,2,1',
  "9 Oak Rd,2100,3,2",
  "Address,Rent,Beds,Baths",
].join("\n");
const r2 = parseBulkRentals(csv, { existingAddresses: ["9 oak road"] });
ok("csv rows, repeated header dropped", r2.rows.length === 3);
ok("quoted comma kept", r2.rows[0].address === "45 Elm Ave, Unit 2, Toronto");
ok("repeat in paste flagged", r2.rows[1].problems.includes("Same address as a row above"));
ok("existing rental flagged", r2.rows[2].problems.includes("You already have this rental"));

// no header: columns are read in the usual order
const r3 = parseBulkRentals("77 Pine St\t1500\t2\t1\n78 Pine St\t1600\t3\t1.5");
ok("no header, positional", !r3.hadHeader && r3.rows.length === 2 && r3.rows[1].rentCents === 160000 && r3.rows[1].baths === 1.5);

// an address with no number is not a rental we can save
ok("street number needed", parseBulkRentals("Address\nKing Street").rows[0].problems.includes("Address has no street number"));

// lease end before start is dropped, not saved wrong
const r4 = parseBulkRentals("Address\tTenant\tStart\tEnd\n5 Bay St\tKim\t2026-05-01\t2026-01-01");
ok("bad end left blank", r4.rows[0].leaseStart === "2026-05-01" && r4.rows[0].leaseEnd === null && r4.rows[0].notes.length === 1);

// the cap
const many = ["Address"].concat(Array.from({ length: BULK_RENTALS_MAX_ROWS + 5 }, (_, i) => `${i + 1} Long Rd`)).join("\n");
const r5 = parseBulkRentals(many);
ok("capped", r5.tooMany && r5.rows.length === BULK_RENTALS_MAX_ROWS);
ok("empty", parseBulkRentals("  \n ").rows.length === 0);

// no long dashes in anything a landlord reads
const words = r.rows.concat(r2.rows, r4.rows).flatMap((x) => x.problems.concat(x.notes)).join(" ");
ok("no long dashes", !/[–—]/.test(words));

console.log(`bulk rentals: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
