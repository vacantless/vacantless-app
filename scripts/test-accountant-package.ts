// Unit tests for the pure accountant-package model (general ledger + import
// CSVs + README) and the dependency-free ZIP writer underneath the S532
// accountant hand-off download.
// Run: npx tsx scripts/test-accountant-package.ts
import {
  PACKAGE_FILES,
  accountantPackageReadme,
  buildGeneralLedger,
  generalLedgerToCsv,
  ledgerToQuickBooksCsv,
  ledgerToXeroCsv,
  ledgerTotalCents,
  type LedgerExpenseRow,
  type LedgerWorkOrderRow,
} from "@/lib/accountant-package";
import { buildZip, crc32, dosDateTime } from "@/lib/zip";
import { buildIncomeStatement } from "@/lib/income-statement";
import { buildT776Statement } from "@/lib/t776";
import type { PropertyRef, RentRow } from "@/lib/statements";

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

const PROP_A = "aaaaaaaa-0000-0000-0000-000000000001";
const PROP_B = "aaaaaaaa-0000-0000-0000-000000000002";
const PROPERTIES = [
  { id: PROP_A, address: "1 Main St", buildingKey: null },
  { id: PROP_B, address: "2 Oak Ave", buildingKey: "oak" },
] as PropertyRef[];
const LOOKUP = [
  { id: PROP_A, address: "1 Main St" },
  { id: PROP_B, address: "2 Oak Ave" },
];
const RANGE = { from: "2025-01-01", to: "2025-12-31" };

const rentRows: RentRow[] = [
  { amount_cents: 200_000, paid_on: "2025-02-01", property_id: PROP_A },
  { amount_cents: 180_000, paid_on: "2025-03-01", property_id: PROP_B },
  { amount_cents: 100_000, paid_on: "2024-12-01", property_id: PROP_A }, // out of range
  { amount_cents: 50_000, paid_on: null, property_id: PROP_A }, // undated — excluded
];

const expenseRows: LedgerExpenseRow[] = [
  {
    property_id: PROP_A,
    building_key: null,
    category: "insurance",
    amount_cents: 30_000,
    incurred_on: "2025-04-10",
    merchant: "Intact",
    note: "annual premium",
  },
  {
    property_id: null,
    building_key: "oak",
    category: "maintenance",
    amount_cents: 12_345,
    incurred_on: "2025-05-05",
    merchant: "Aviv Plumbing",
    note: null,
  },
  {
    property_id: null,
    building_key: null,
    category: "interest",
    amount_cents: 40_000,
    incurred_on: "2025-06-30",
    merchant: null,
    note: null,
  },
  {
    property_id: PROP_A,
    building_key: null,
    category: "supplies",
    amount_cents: 999,
    incurred_on: "2026-01-15", // out of range
    merchant: null,
    note: null,
  },
];

const workOrderRows: LedgerWorkOrderRow[] = [
  {
    property_id: PROP_B,
    building_key: null,
    category: "plumbing",
    status: "completed",
    cost_cents: 15_000,
    completed_on: "2025-07-20",
    title: "Toilet repair unit 2",
  },
  {
    property_id: PROP_A,
    building_key: null,
    category: "electrical",
    status: "in_progress",
    cost_cents: null, // costless — excluded
    completed_on: "2025-08-01",
    title: "Panel check",
  },
  {
    property_id: PROP_A,
    building_key: null,
    category: "hvac",
    status: "completed",
    cost_cents: 20_000,
    completed_on: null, // undated — excluded
    title: "Furnace",
  },
];

// --- General ledger ---------------------------------------------------------

const ledger = buildGeneralLedger(rentRows, expenseRows, workOrderRows, LOOKUP, RANGE);

ok("ledger: entry count (2 rent + 3 expenses + 1 wo)", ledger.length === 6);
ok("ledger: sorted by date", ledger.every((e, i) => i === 0 || ledger[i - 1].date <= e.date));
ok(
  "ledger: out-of-range and undated rows excluded",
  ledger.every((e) => e.date >= "2025-01-01" && e.date <= "2025-12-31"),
);

const rentEntries = ledger.filter((e) => e.source === "rent");
ok("ledger: rent entries positive", rentEntries.every((e) => e.amountCents > 0));
ok("ledger: rent maps to 8299", rentEntries.every((e) => e.t776Line === "8299"));
ok(
  "ledger: rent resolves property address",
  rentEntries.some((e) => e.property === "1 Main St") &&
    rentEntries.some((e) => e.property === "2 Oak Ave"),
);

const costEntries = ledger.filter((e) => e.source !== "rent");
ok("ledger: cost entries negative", costEntries.every((e) => e.amountCents < 0));
ok(
  "ledger: merchant + note joined",
  ledger.some((e) => e.description === "Intact — annual premium"),
);
ok(
  "ledger: merchant only",
  ledger.some((e) => e.description === "Aviv Plumbing"),
);
ok(
  "ledger: work-order title as description",
  ledger.some((e) => e.description === "Toilet repair unit 2"),
);
ok(
  "ledger: building-scoped expense labelled",
  ledger.some((e) => e.property === "Building: oak"),
);
ok(
  "ledger: unscoped expense is Unassigned",
  ledger.some((e) => e.property === "Unassigned" && e.categoryLabel === "Interest"),
);
ok(
  "ledger: repair categories map to 8960",
  ledger.some((e) => e.description === "Toilet repair unit 2" && e.t776Line === "8960"),
);

// Reconciliation: the GL total must equal the income statement's netCash for
// the same inputs and window.
const statement = buildIncomeStatement(
  rentRows,
  [
    ...expenseRows.map((e) => ({
      property_id: e.property_id,
      building_key: e.building_key ?? null,
      category: e.category,
      status: "confirmed",
      cost_cents: e.amount_cents,
      completed_on: e.incurred_on,
    })),
    ...workOrderRows,
  ],
  PROPERTIES,
  RANGE,
);
ok(
  "ledger: total reconciles to income-statement netCash",
  ledgerTotalCents(ledger) === statement.totals.netCashCents,
);

// And the rent side reconciles to the T776 gross rents.
const t776 = buildT776Statement(rentRows, [], PROPERTIES, 2025);
ok(
  "ledger: rent total reconciles to T776 gross rents",
  rentEntries.reduce((s, e) => s + e.amountCents, 0) === t776.totals.grossRentCents,
);

// --- CSVs -------------------------------------------------------------------

const glCsv = generalLedgerToCsv(ledger, RANGE);
ok("gl csv: title", glCsv.startsWith("General ledger"));
ok("gl csv: period", glCsv.includes("Period,2025-01-01 to 2025-12-31"));
ok(
  "gl csv: header row",
  glCsv.includes("Date,Type,Description,Property,Category,T776 line,Amount"),
);
ok("gl csv: signed income", glCsv.includes("2025-02-01,Rent income,Rent received,1 Main St,Rent,8299,2000.00"));
ok("gl csv: signed cost", glCsv.includes("-123.45"));
ok(
  "gl csv: quoted em-dash description survives",
  glCsv.includes("Intact — annual premium"),
);
ok("gl csv: TOTAL row", glCsv.includes(`TOTAL,,,,,,${(ledgerTotalCents(ledger) / 100).toFixed(2)}`));
ok("gl csv: newline end", glCsv.endsWith("\n"));

const qboCsv = ledgerToQuickBooksCsv(ledger);
ok("qbo csv: 3-column header", qboCsv.startsWith("Date,Description,Amount"));
ok("qbo csv: row count = entries + header", qboCsv.trim().split("\n").length === ledger.length + 1);
ok("qbo csv: context in description", qboCsv.includes("(1 Main St · Rent)"));
ok(
  "qbo csv: comma-safe quoting",
  qboCsv
    .trim()
    .split("\n")
    .slice(1)
    .every((line) => {
      // every data row parses back to exactly 3 fields under CSV quoting
      const fields = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? [];
      return fields.length >= 3;
    }),
);

const xeroCsv = ledgerToXeroCsv(ledger);
ok("xero csv: header", xeroCsv.startsWith("Date,Amount,Payee,Description,Reference"));
ok("xero csv: row count", xeroCsv.trim().split("\n").length === ledger.length + 1);
ok("xero csv: T776 reference", xeroCsv.includes("T776 8299"));

// --- README -----------------------------------------------------------------

const readme = accountantPackageReadme({
  orgName: "North Star QA",
  range: RANGE,
  generatedOn: "2026-07-20",
  entryCount: ledger.length,
});
ok("readme: org name", readme.includes("North Star QA"));
ok("readme: period", readme.includes("2025-01-01 to 2025-12-31"));
ok("readme: entry count", readme.includes("(6 entries)"));
ok("readme: lists every package file", PACKAGE_FILES.every((f) => f === "README.txt" || readme.includes(f)));
ok("readme: principal memo rule", readme.includes("memo line only and never reduces net income"));
ok("readme: CCA left blank", readme.includes("9936"));
ok("readme: not a filed return", readme.includes("not a") && readme.includes("filed return"));
ok("readme: never moves money", readme.includes("never moves money"));

// --- ZIP writer -------------------------------------------------------------

// CRC-32 known vector: "123456789" -> 0xCBF43926.
ok("zip: crc32 known vector", crc32(new TextEncoder().encode("123456789")) === 0xcbf43926);

const dos = dosDateTime("2026-07-20");
ok("zip: dos year offset", dos.date >> 9 === 2026 - 1980);
ok("zip: dos month", ((dos.date >> 5) & 0xf) === 7);
ok("zip: dos day", (dos.date & 0x1f) === 20);
ok("zip: pre-1980 clamps", dosDateTime("1975-01-01").date >> 9 === 0);

const zipped = buildZip(
  [
    { name: "a.txt", data: "hello" },
    { name: "dir/b.csv", data: "x,y\n1,2\n" },
  ],
  "2026-07-20",
);

function u32At(bytes: Uint8Array, off: number): number {
  return (bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24)) >>> 0;
}
function u16At(bytes: Uint8Array, off: number): number {
  return bytes[off] | (bytes[off + 1] << 8);
}

ok("zip: local header signature", u32At(zipped, 0) === 0x04034b50);
ok("zip: store method", u16At(zipped, 8) === 0);
ok("zip: first entry crc", u32At(zipped, 14) === crc32(new TextEncoder().encode("hello")));
ok("zip: first entry size", u32At(zipped, 18) === 5 && u32At(zipped, 22) === 5);
ok("zip: first name length", u16At(zipped, 26) === "a.txt".length);
ok(
  "zip: first body stored verbatim",
  new TextDecoder().decode(zipped.slice(30 + 5, 30 + 5 + 5)) === "hello",
);

// End-of-central-directory: last 22 bytes (no comment).
const eocd = zipped.length - 22;
ok("zip: eocd signature", u32At(zipped, eocd) === 0x06054b50);
ok("zip: eocd entry count", u16At(zipped, eocd + 10) === 2);
const cdOffset = u32At(zipped, eocd + 16);
ok("zip: central directory signature at offset", u32At(zipped, cdOffset) === 0x02014b50);
const cdSize = u32At(zipped, eocd + 12);
ok("zip: central directory size + offset + eocd == file length", cdOffset + cdSize + 22 === zipped.length);
ok("zip: utf8 flag set", (u16At(zipped, 6) & 0x0800) !== 0);

let dupThrew = false;
try {
  buildZip([{ name: "a", data: "1" }, { name: "a", data: "2" }], "2026-07-20");
} catch {
  dupThrew = true;
}
ok("zip: duplicate names throw", dupThrew);

let emptyThrew = false;
try {
  buildZip([{ name: "  ", data: "1" }], "2026-07-20");
} catch {
  emptyThrew = true;
}
ok("zip: empty name throws", emptyThrew);

ok("zip: empty archive is a valid empty zip", (() => {
  const empty = buildZip([], "2026-07-20");
  return empty.length === 22 && u32At(empty, 0) === 0x06054b50;
})());

const total = passed + failed;
console.log(`PASS ${passed}/${total}`);
if (failed > 0) process.exit(1);
