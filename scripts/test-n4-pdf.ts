// Golden readback test for fillOfficialN4 (Slice B). Fills a known snapshot into
// the real gov template, reloads the bytes, and asserts each mapped field carries
// the expected comb-formatted value. Also writes a sample PDF when N4_SAMPLE_OUT
// is set. Run: npx tsx scripts/test-n4-pdf.ts   (needs lib/forms/ltb-n4-2022.pdf)
import fs from "node:fs";
import { PDFDocument } from "pdf-lib";
import {
  deriveN4Arrears,
  deriveN4TerminationDate,
  packN4ArrearsRows,
  resolveN4OwingCents,
} from "@/lib/n4";
import { combAmountCents, combDateISO } from "@/lib/forms/shared-combs";
import { fillOfficialN4, type N4FillSnapshot } from "@/lib/n4-official-pdf";

let pass = 0;
let fail = 0;
function eq(got: unknown, want: unknown, msg: string): void {
  if (got === want) pass++;
  else {
    fail++;
    console.error(`FAIL: ${msg} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

async function main() {
  const rentCents = 220000;
  const arrears = deriveN4Arrears({
    rentCents,
    startDateISO: "2026-05-01",
    asOfISO: "2026-07-12",
    payments: [],
  });
  const packed = packN4ArrearsRows(arrears.rows);
  const totalOwingCents = resolveN4OwingCents(arrears.computedOwingCents);
  const terminationDateISO = deriveN4TerminationDate("2026-07-12", "monthly");

  const snap: N4FillSnapshot = {
    tenantNames: ["Liang Wu"],
    landlordName: "Agile Real Estate Group",
    rentalUnitAddress: "123 Example St, Unit 4, Toronto, ON M5V 1A1",
    totalOwingCents,
    terminationDateISO,
    arrearsRows: packed.formRows,
    signer: { type: "landlord", firstName: "Noam", lastName: "Muscovitch", dayPhone: "416-555-0132" },
  };

  const bytes = await fillOfficialN4(snap);

  if (process.env.N4_SAMPLE_OUT) {
    fs.writeFileSync(process.env.N4_SAMPLE_OUT, bytes);
  }

  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const form = doc.getForm();
  const leaf = (n: string) => n.split(".").pop()!.replace(/\[\d+\]$/, "");
  const text = (name: string): string | undefined => {
    for (const f of form.getFields()) {
      if (leaf(f.getName()) === name && "getText" in f) {
        return (f as unknown as { getText: () => string | undefined }).getText();
      }
    }
    return undefined;
  };

  eq(totalOwingCents, 660000, "3 unpaid months => $6,600 owing");
  eq(terminationDateISO, "2026-07-26", "termination = notice + 14");
  eq(packed.formRows.length, 3, "3 periods => 3 rows");

  eq(text("TO_TenameName"), "Liang Wu", "tenant name");
  eq(text("From_LandlordName"), "Agile Real Estate Group", "landlord name");
  eq(text("RentalUnitAddress"), "123 Example St, Unit 4, Toronto, ON M5V 1A1", "address");
  eq(text("OweMeAmount"), combAmountCents(660000, 10), "OweMeAmount comb");
  eq(text("PayDate"), combDateISO("2026-07-26"), "PayDate = termination date comb");
  eq(text("ArrearFrom1"), combDateISO("2026-05-01"), "row1 from");
  eq(text("ArrearTo1"), combDateISO("2026-05-31"), "row1 to");
  eq(text("RentCharge1"), combAmountCents(220000, 9), "row1 charged");
  eq(text("RentPaid1"), combAmountCents(0, 9), "row1 paid = 0");
  eq(text("RentOwe1"), combAmountCents(220000, 10), "row1 owing");
  eq(text("TotalRentOwe"), combAmountCents(660000, 11), "total owing comb");
  eq(text("RFirstName"), "Noam", "signer first name");
  eq(text("RLastName"), "Muscovitch", "signer last name");

  const sign = form.getFields().find((f) => leaf(f.getName()) === "SelectSign");
  const selected =
    sign && "getSelected" in sign
      ? (sign as unknown as { getSelected: () => string | undefined }).getSelected()
      : undefined;
  eq(selected, "1", "SelectSign = 1 (landlord)");

  // --- fail-closed row contract (S478 P2 folds) -----------------------------
  async function throwsAsync(fn: () => Promise<unknown>, msg: string) {
    try {
      await fn();
      eq("did-not-throw", "throw", msg);
    } catch {
      pass++;
    }
  }
  const withRows = (
    rows: N4FillSnapshot["arrearsRows"],
    total: number,
  ): N4FillSnapshot => ({ ...snap, arrearsRows: rows, totalOwingCents: total });

  // >3 rows must THROW, never silently drop the 4th+ period (old slice(0,3)).
  const fiveRaw = deriveN4Arrears({
    rentCents,
    startDateISO: "2026-03-01",
    asOfISO: "2026-07-12",
    payments: [],
  }).rows.map((r) => ({
    fromISO: r.fromISO,
    toISO: r.toISO,
    chargedCents: r.chargedCents,
    paidCents: r.paidCents,
    owingCents: r.owingCents,
  }));
  eq(fiveRaw.length > 3, true, "unpacked derive yields >3 rows for the guard");
  await throwsAsync(
    () => fillOfficialN4(withRows(fiveRaw, fiveRaw.length * rentCents)),
    ">3 arrears rows throws (no silent slice)",
  );

  // A negative (overpaid) row must THROW — the comb would silently render 0 and
  // break reconciliation with the total.
  await throwsAsync(
    () =>
      fillOfficialN4(
        withRows(
          [
            { fromISO: "2026-05-01", toISO: "2026-05-31", chargedCents: rentCents, paidCents: 0, owingCents: rentCents },
            { fromISO: "2026-06-01", toISO: "2026-06-30", chargedCents: rentCents, paidCents: rentCents * 2, owingCents: -rentCents },
          ],
          0,
        ),
      ),
    "negative (overpaid) row throws",
  );

  // Rows summing ABOVE Total Rent Owing must THROW — the table would overstate.
  await throwsAsync(
    () =>
      fillOfficialN4(
        withRows(
          [
            { fromISO: "2026-05-01", toISO: "2026-05-31", chargedCents: rentCents, paidCents: 0, owingCents: rentCents },
            { fromISO: "2026-06-01", toISO: "2026-06-30", chargedCents: rentCents, paidCents: 0, owingCents: rentCents },
          ],
          rentCents,
        ),
      ),
    "rows exceeding Total Rent Owing throws",
  );

  // Exactly 3 rows reconciling to the total must still SUCCEED (no regression).
  await fillOfficialN4(withRows(packed.formRows, totalOwingCents));
  pass++;

  console.log(`test-n4-pdf: ${pass}/${fail}`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("ERR", e);
  process.exit(1);
});
