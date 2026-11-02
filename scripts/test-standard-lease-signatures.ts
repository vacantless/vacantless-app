// Run with: npx tsx scripts/test-standard-lease-signatures.ts
// S744c: e-signatures stamped on page 7 of the Ontario Standard Lease (2229E),
// and the form frozen at send.
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import {
  signaturePlacements, torontoDay, SIGNATURE_BOXES, type SignedSigner, type StandardLeaseInput,
} from "../lib/standard-lease";
import { fillStandardLease, fitImage } from "../lib/standard-lease-pdf";
import { frozenStandardInput } from "../lib/standard-lease-server";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => (c ? pass++ : (fail++, console.error(`FAIL: ${n}`)));

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const signer = (o: Partial<SignedSigner>): SignedSigner => ({
  role: "tenant", name: null, signedName: null, kind: "typed", data: "Avani Shah",
  signedAt: "2026-11-02T16:00:00Z", signOrder: 2, ...o,
});

// --- dates -------------------------------------------------------------------
ok("toronto day", torontoDay("2026-11-02T16:00:00Z") === "2026/11/02");
ok("late evening stays the same Toronto day", torontoDay("2026-11-03T03:30:00Z") === "2026/11/02");
ok("blank date", torontoDay(null) === "" && torontoDay("nope") === "");

// --- placements --------------------------------------------------------------
const names = ["Avani Shah", "Rez Joseph"];
const r1 = signaturePlacements(names, [
  signer({ role: "landlord", name: "Agile", data: "Narayan Persaud", signOrder: 1 }),
  signer({ name: "Rez Joseph", data: PNG, kind: "drawn", signOrder: 3 }),
  signer({ name: "Avani Shah", signOrder: 2 }),
]);
ok("three placed", r1.placed.length === 3 && r1.overflow.length === 0);
ok("landlord in landlord row", r1.placed.find((p) => p.row === "landlord")?.box[1] === SIGNATURE_BOXES.landlord.signature[1]);
ok("tenant matched to own printed row", r1.placed.find((p) => p.data === "Avani Shah")?.row === 0);
ok("drawn tenant on row 2", r1.placed.find((p) => p.kind === "drawn")?.row === 1);
ok("date set", r1.placed.every((p) => p.dateText === "2026/11/02"));
ok("date box is the date column", r1.placed[0].dateBox[0] === 471);

const r2 = signaturePlacements(names, [signer({ name: "Pat Stranger", signedName: "Pat Stranger" })]);
ok("unmatched tenant takes a blank row", r2.placed[0]?.row === 2);
const full = ["A", "B", "C", "D"];
const r3 = signaturePlacements(full, [signer({ name: "Zed" })]);
ok("never signs on someone else's printed name", r3.placed.length === 0 && r3.overflow.length === 1);
const r4 = signaturePlacements(names, [signer({ signedAt: null }), signer({ data: null }), signer({ kind: null })]);
ok("unsigned rows stay blank", r4.placed.length === 0 && r4.overflow.length === 0);
const r5 = signaturePlacements(names, [signer({ kind: "drawn", data: "data:image/svg+xml;base64,AAAA" })]);
ok("non-PNG drawing is refused", r5.placed.length === 0);
const r6 = signaturePlacements(names, [
  signer({ role: "landlord", data: "One", signOrder: 1 }), signer({ role: "landlord", data: "Two", signOrder: 2 }),
]);
ok("one landlord stamp", r6.placed.length === 1 && r6.placed[0].data === "One");
ok("guarantor not stamped", signaturePlacements(names, [signer({ role: "guarantor" })]).placed.length === 0);

// --- image fit ---------------------------------------------------------------
const fit = fitImage(400, 100, [255, 623, 465, 648]);
ok("image fits the box", fit.width <= 207 && fit.height <= 22 && fit.x >= 255 && fit.y >= 623 && fit.y + fit.height <= 648);

// --- frozen at send ----------------------------------------------------------
const input: StandardLeaseInput = {
  landlordName: "Agile Real Estate Group Inc.", tenantNames: names, propertyAddress: "1551 Assumption St, Unit 9, Windsor, ON N9A 3E2",
  startDate: "2026-12-01", endDate: null, termMonths: 12, rentCents: 109500, depositCents: 109500,
  hasAdditionalTerms: false, details: {},
};
ok("draft is never frozen", frozenStandardInput("draft", { standardForm: input }) === null);
ok("sent uses the frozen copy", frozenStandardInput("sent", { standardForm: input, clauseBody: "x" })?.input.rentCents === 109500);
ok("frozen terms come from the snapshot", frozenStandardInput("executed", { standardForm: input, clauseBody: "x" })?.terms === "x");
ok("old snapshot without the form falls back to live", frozenStandardInput("sent", { title: "t" }) === null);

const src = readFileSync("app/dashboard/tenancies/[id]/lease-actions.ts", "utf8");
ok("send freezes the standard form", src.includes("standardForm: standard.input"));
const route = readFileSync("app/dashboard/tenancies/[id]/lease/[leaseId]/standard/pdf/route.ts", "utf8");
ok("pdf route passes signatures", route.includes("signatures: loaded.signatures"));

// --- real render -------------------------------------------------------------
(async () => {
  const unsigned = await fillStandardLease({ ...input, additionalTerms: null });
  const signed = await fillStandardLease({
    ...input, additionalTerms: null,
    signatures: [
      signer({ role: "landlord", data: "Narayan Persaud", signOrder: 1 }),
      signer({ name: "Rez Joseph", kind: "drawn", data: PNG, signOrder: 3 }),
    ],
  });
  const base = (await PDFDocument.load(unsigned)).getPageCount();
  const doc = await PDFDocument.load(signed);
  ok("signing adds no pages", doc.getPageCount() === base);
  ok("signed render differs from unsigned", signed.length !== unsigned.length);
  const overflowDoc = await PDFDocument.load(await fillStandardLease({
    ...input, tenantNames: full, additionalTerms: null, signatures: [signer({ name: "Zed" })],
  }));
  ok("unmatched signer goes on the attachment", overflowDoc.getPageCount() === base + 1);
  console.log(`\nstandard-lease signatures: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})();
