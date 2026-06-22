// Unit tests for the pure pdf.js-items -> text assembler (lib/pdf-text.ts).
// Run: npx tsx scripts/test-pdf-text.ts
//
// The assembler is the only real logic in the S292 MLS PDF-drop import: it turns
// pdf.js text-content items into the newline-separated paste text that the
// existing parseMlsListing already understands. We test both shapes pdf.js
// produces (hasEOL-flagged, and position-only) plus the round-trip into the real
// parser so a regression in either layer is caught.
import {
  assemblePageText,
  assembleDocumentText,
  type PdfTextItemLike,
} from "../lib/pdf-text";
import { parseMlsListing } from "../lib/mls-import";

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${label}`);
  }
}

// Helpers to build items in each shape.
function eol(str: string, isEol = false): PdfTextItemLike {
  return { str, hasEOL: isEol };
}
function pos(str: string, x: number, y: number): PdfTextItemLike {
  // pdf.js transform = [a,b,c,d,e,f]; e (idx 4) = x, f (idx 5) = y.
  return { str, transform: [1, 0, 0, 1, x, y] };
}

// --- empty / degenerate -----------------------------------------------------
ok("empty array -> ''", assemblePageText([]) === "");
ok("null-ish -> ''", assemblePageText(undefined as unknown as PdfTextItemLike[]) === "");
ok("only-empty-strings -> ''", assemblePageText([eol("", true), eol("", true)]) === "");

// --- hasEOL primary path ----------------------------------------------------
{
  // "Bedrooms: 2" \n "Bathrooms: 1" expressed as pdf.js emits it: words inside
  // .str, end-of-line flagged on the last item of each visual line.
  const items = [eol("Bedrooms: 2"), eol("", true), eol("Bathrooms: 1", true)];
  ok(
    "hasEOL: two lines reconstructed",
    assemblePageText(items) === "Bedrooms: 2\nBathrooms: 1",
  );
}
{
  // Column row: separate " " items between columns must survive as single spaces.
  const items = [
    eol("Heat Incl: Y"),
    eol(" "),
    eol("Hydro Incl: N"),
    eol(" "),
    eol("Water Incl: Y", true),
  ];
  ok(
    "hasEOL: column row joined on one line, spaces collapsed",
    assemblePageText(items) === "Heat Incl: Y Hydro Incl: N Water Incl: Y",
  );
}
{
  // A trailing line with no hasEOL flag (last visual line) is still emitted.
  const items = [eol("Address: 1 Main St", true), eol("Lease Price: $2,000/mo")];
  ok(
    "hasEOL: unflagged tail line still flushed",
    assemblePageText(items) === "Address: 1 Main St\nLease Price: $2,000/mo",
  );
}
{
  // Blank visual lines (hasEOL with empty buffer) don't produce empty rows.
  const items = [eol("Line A", true), eol("", true), eol("Line B", true)];
  ok("hasEOL: blank lines dropped", assemblePageText(items) === "Line A\nLine B");
}

// --- Y-cluster fallback path ------------------------------------------------
{
  // No hasEOL anywhere -> cluster by y. Two rows at y=700 and y=682.
  const items = [
    pos("Bedrooms:", 72, 700),
    pos("2", 130, 700),
    pos("Bathrooms:", 72, 682),
    pos("1", 140, 682),
  ];
  ok(
    "fallback: two y-rows, left-to-right within each",
    assemblePageText(items) === "Bedrooms: 2\nBathrooms: 1",
  );
}
{
  // Items arriving out of order get sorted top-to-bottom then left-to-right.
  const items = [
    pos("N", 190, 612), // belongs to the lower row, right column
    pos("Address: 1 Main St", 72, 700),
    pos("Hydro Incl:", 132, 612),
    pos("Heat Incl: Y", 72, 612),
  ];
  ok(
    "fallback: unordered items reflowed correctly",
    assemblePageText(items) ===
      "Address: 1 Main St\nHeat Incl: Y Hydro Incl: N",
  );
}
{
  // Sub-tolerance y drift within a line stays one row; a real line gap splits.
  const items = [
    pos("A", 72, 700),
    pos("B", 100, 698.5), // 1.5 < tol(3) -> same row
    pos("C", 72, 680), // 18 gap -> new row
  ];
  ok("fallback: y tolerance keeps a drifting line together", assemblePageText(items) === "A B\nC");
}

// --- multi-page document ----------------------------------------------------
{
  const p1 = [eol("Address: 1 Main St", true)];
  const p2 = [eol("Lease Price: $1,800/mo", true)];
  const empty: PdfTextItemLike[] = [];
  ok(
    "document: pages joined by newline, blank page skipped",
    assembleDocumentText([p1, empty, p2]) ===
      "Address: 1 Main St\nLease Price: $1,800/mo",
  );
}

// --- round-trip into the real parser ---------------------------------------
{
  // Mirrors the empirically-captured pdf.js output for a TRREB-style data sheet
  // (verified 2026-06-21 against pdfjs-dist 4.7.76). Assembling then parsing must
  // recover the structured fields, proving the PDF path feeds parseMlsListing the
  // text it expects.
  const sheet: PdfTextItemLike[] = [
    eol("Address: 18 Shorncliffe Rd, Unit 4, Toronto, ON", true),
    eol("Lease Price: $2,450/Monthly", true),
    eol("Bedrooms: 2", true),
    eol("Bathrooms: 2", true),
    eol("Approx Square Footage: 1100", true),
    eol("Parking: 1 Underground", true),
    eol("Heat Incl: Y"),
    eol(" "),
    eol("Hydro Incl: N"),
    eol(" "),
    eol("Water Incl: Y", true),
    eol("Possession: July 1, 2026", true),
    eol("Virtual Tour: https://youriguide.com/18-shorncliffe-rd", true),
    eol(
      "Client Remks: Bright two-bedroom with in-suite laundry and a private balcony.",
      true,
    ),
  ];
  const text = assemblePageText(sheet);
  const parsed = parseMlsListing(text);
  ok("round-trip: address", parsed.address === "18 Shorncliffe Rd, Unit 4, Toronto, ON");
  ok("round-trip: rent", parsed.rentCents === 245000);
  ok("round-trip: beds", parsed.beds === 2);
  ok("round-trip: baths", parsed.baths === 2);
  ok("round-trip: sqft", parsed.sqft === 1100);
  ok("round-trip: parking", parsed.parking === "1 Underground");
  ok("round-trip: available date", parsed.availableDate === "2026-07-01");
  ok("round-trip: heat included", parsed.heatIncluded === true);
  ok("round-trip: hydro NOT included (column N authoritative)", parsed.hydroIncluded === false);
  ok("round-trip: water included", parsed.waterIncluded === true);
  ok("round-trip: laundry in-suite", parsed.laundry === "in_suite");
  ok("round-trip: balcony", parsed.balcony === true);
  ok(
    "round-trip: virtual tour",
    parsed.virtualTourUrl === "https://youriguide.com/18-shorncliffe-rd",
  );
  ok("round-trip: found several fields", parsed.foundFields.length >= 10);
}

console.log(`\npdf-text: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
