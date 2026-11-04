// Golden readback test for fillOfficialN4. Fills a known snapshot into the real
// LTB 2026/09 N4, reloads the bytes, and asserts each mapped field carries the
// expected value. Also writes a sample PDF when N4_SAMPLE_OUT is set.
// Run: npx tsx scripts/test-n4-pdf.ts   (needs lib/forms/ltb-n4-2026-09.pdf)
import fs from "node:fs";
import { PDFDocument } from "pdf-lib";
import {
  deriveN4Arrears,
  deriveN4TerminationDate,
  packN4ArrearsRows,
  resolveN4OwingCents,
} from "@/lib/n4";
import { fillOfficialN4, N4_TEMPLATE_VERSION, type N4FillSnapshot } from "@/lib/n4-official-pdf";

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
  const key = (n: string) => n.replace(/^form1\[0\]\./, "").replace(/\[\d+\]/g, "");
  const field = (name: string) => form.getFields().find((f) => key(f.getName()) === name);
  const text = (name: string): string | undefined => {
    const f = field(name);
    return f && "getText" in f ? (f as unknown as { getText: () => string | undefined }).getText() : undefined;
  };

  eq(N4_TEMPLATE_VERSION, "2026/09", "template is the LTB 2026/09 N4");
  eq(doc.getPageCount(), 4, "2026/09 N4 has 4 pages (checklist + 3)");
  eq(totalOwingCents, 660000, "3 unpaid months => $6,600 owing");
  eq(terminationDateISO, "2026-07-26", "termination = notice + 14 (served before 2026-09-21)");
  eq(deriveN4TerminationDate("2026-11-03", "monthly"), "2026-11-10", "served after 2026-09-21: notice + 7");
  eq(packed.formRows.length, 3, "3 periods => 3 rows");

  const P = "sfrmForm.PartyAddressInfo.";
  eq(text(P + "txtTenant"), "Liang Wu", "tenant name");
  eq(text(P + "txtLandlord"), "Agile Real Estate Group", "landlord name");
  eq(text(P + "txtNumber"), "123", "street number");
  eq(text(P + "txtName"), "Example St", "street name");
  eq(text(P + "txtUnit"), "4", "unit");
  eq(text(P + "txtCity"), "Toronto", "municipality");
  eq(text(P + "txtProvince"), "ON", "province");
  eq(text(P + "txtPostalCode"), "M5V 1A1", "postal code");
  eq(text("sfrmForm.InfofromLandlord1.txtOweMeAmount"), "6,600.00", "amount owing on page 1");
  eq(text("sfrmForm.InfofromLandlord1.dptPayDate"), "26/07/2026", "pay-by = termination date, dd/mm/yyyy");
  const R = "sfrmForm.InfofromLandlord2.RentOwing.";
  eq(text(R + "Row1.DateFrom1"), "01/05/2026", "row1 from");
  eq(text(R + "Row1.DateTo1"), "31/05/2026", "row1 to");
  eq(text(R + "Row1.Charged1"), "2,200.00", "row1 charged");
  eq(text(R + "Row1.Paid1"), "0.00", "row1 paid = 0");
  eq(text(R + "Row1.Owing1"), "2,200.00", "row1 owing");
  eq(text(R + "Row3.DateTo3"), "31/07/2026", "row3 to");
  eq(text("sfrmForm.InfofromLandlord2.TotalRentOwing"), "6,600.00", "total owing matches page 1");
  eq(text("sfrmForm.Signature.txtFirstName"), "Noam", "signer first name");
  eq(text("sfrmForm.Signature.txtLastName"), "Muscovitch", "signer last name");
  eq(text("sfrmForm.Signature.txtPhone1"), "416-555-0132", "signer phone");
  eq(text("sfrmForm.Signature.Signature") ?? "", "", "signature left blank");
  eq(text("sfrmForm.Signature.dptSignDate") ?? "", "", "signature date left blank");

  const sign = field("sfrmForm.Signature.PartyType");
  const selected =
    sign && "getSelected" in sign
      ? (sign as unknown as { getSelected: () => string | undefined }).getSelected()
      : undefined;
  eq(selected, "1", "PartyType = 1 (landlord)");

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

  // A negative (overpaid) row must THROW - it would break reconciliation with the total.
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
