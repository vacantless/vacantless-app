// S748g: Form L1 rules + official 2026/09 fill.
// Run: npx tsx scripts/test-s748-l1.ts   (L1_SAMPLE_OUT=path writes a sample PDF)
import fs from "node:fs";
import { PDFDocument } from "pdf-lib";
import { computeL1, earliestL1FilingDate, l1FeeCents, n4ConcessionCents } from "@/lib/l1";
import { fillOfficialL1 } from "@/lib/l1-official-pdf";

let pass = 0;
let fail = 0;
function eq(got: unknown, want: unknown, msg: string) {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else {
    fail++;
    console.error(`FAIL: ${msg} - got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

async function main() {
  eq(earliestL1FilingDate("2026-11-10"), "2026-11-11", "file the day after the N4 date");
  eq(l1FeeCents("portal"), 18600, "portal fee $186");
  eq(l1FeeCents("paper"), 20100, "paper fee $201");

  // Rent $1,450 from Sept 1; paid Sept and half of Oct; nothing for Nov.
  const base = {
    n4Status: "served",
    n4TerminationISO: "2026-11-10",
    filingDateISO: "2026-11-11",
    method: "portal" as const,
    tenantInPossession: true,
    tenantCount: 1,
    rentCents: 145000,
    startDateISO: "2026-09-01",
    payments: [
      { amount_cents: 145000, period_month: "2026-09-01" },
      { amount_cents: 72500, period_month: "2026-10-01" },
    ],
  };
  const c = computeL1(base);
  eq(c.problems, [], "valid L1 has no problems");
  eq(c.rentOwingCents, 217500, "owing to the filing date: half Oct + Nov");
  eq(c.totalCents, 217500 + 18600, "total = rent + fee");
  eq(c.rows.length, 3, "Sept, Oct, Nov rows");
  eq(c.rows[2].owingCents, 145000, "last row is the last period");

  eq(computeL1({ ...base, filingDateISO: "2026-11-10" }).problems, ["too_early"], "can't file on the N4 date");
  eq(computeL1({ ...base, n4Status: "draft" }).problems, ["n4_not_served"], "N4 must be served");
  eq(computeL1({ ...base, tenantInPossession: false }).problems, ["not_in_possession"], "tenant moved out");
  eq(
    computeL1({ ...base, payments: [...base.payments, { amount_cents: 72500, period_month: "2026-10-01" }, { amount_cents: 145000, period_month: "2026-11-01" }] }).problems,
    ["no_arrears"],
    "paid up: nothing to file",
  );
  eq(
    computeL1({ ...base, payments: [...base.payments, { amount_cents: 10000, period_month: null }] }).problems,
    ["unresolved_credits"],
    "unassigned payment blocks",
  );
  eq(computeL1({ ...base, tenantCount: 3 }).needsScheduleOfParties, true, "3 tenants need the Schedule of Parties");

  const bytes = await fillOfficialL1({
    rentalUnitAddress: "1551 Assumption St, Unit 9, Windsor, ON N9A 3E2",
    filingDateISO: c.filingDateISO,
    landlord: {
      company: "Agile Real Estate Group",
      firstName: "Noam",
      lastName: "Muscovitch",
      email: "rentals@example.com",
      phone: "519-915-8865",
      mailingAddress: "100 King St W, Unit 5, Toronto, ON M5X 1A9",
      byEmail: true,
    },
    tenants: [
      { name: "Gina Rossi", email: "gina@example.com", phone: "519-555-0101" },
      { name: "Marco Bianchi", email: null, phone: null },
    ],
    deposit: { cents: 145000, collectedISO: "2026-08-25" },
    rows: c.rows,
    rentOwingCents: c.rentOwingCents,
    nsfCents: 0,
    feeCents: c.feeCents,
    totalCents: c.totalCents,
  });
  if (process.env.L1_SAMPLE_OUT) fs.writeFileSync(process.env.L1_SAMPLE_OUT, bytes);
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const key = (n: string) => n.replace(/^form1\[0\]\./, "").replace(/\[\d+\]/g, "");
  const fields = doc.getForm().getFields();
  const fl = (k: string) => fields.find((f) => key(f.getName()) === k) as unknown as {
    getText?: () => string | undefined;
    getSelected?: () => string | undefined;
    isChecked?: () => boolean;
  };
  const text = (k: string) => fl(k)?.getText?.() ?? "";

  eq(text("sfrmForm.Part1.AddressRentalUnit.txtNumber"), "1551", "rental street number");
  eq(text("sfrmForm.Part1.AddressRentalUnit.txtUnit"), "9", "rental unit");
  eq(text("sfrmForm.Part2.InfofromLandlord.txtTotalOwe"), "2,361.00", "Part 2 total incl. fee");
  eq(text("sfrmForm.Part2.InfofromLandlord.dptDepositDate"), "11/11/2026", "Part 2 as-of = filing date");
  eq(text("sfrmForm.Part3.LandlordNameAddress.txtCompanyName"), "Agile Real Estate Group", "company");
  eq(text("sfrmForm.Part3.LandlordNameAddress.txtCity"), "Toronto", "landlord mailing city");
  eq(fl("sfrmForm.Part3.CommunicationConsent.Communication")?.getSelected?.(), "2", "email consent");
  eq(text("sfrmForm.Part3.TenantNameAddress.txtTenant1FirstName"), "Gina", "tenant 1 first");
  eq(text("sfrmForm.Part3.TenantNameAddress.txtTenant2LastName"), "Bianchi", "tenant 2 last name");
  eq(fl("sfrmForm.Part4.chkReason1")?.isChecked?.(), true, "rent reason ticked");
  eq(fl("sfrmForm.Part4.chkReason2")?.isChecked?.(), false, "NSF reason not ticked");
  eq(fl("sfrmForm.Part4.Possession")?.getSelected?.(), "1", "tenant in possession: yes");
  eq(fl("sfrmForm.Part4.sfrmPeriod_1.Period")?.getSelected?.(), "1", "rent by the month");
  eq(text("sfrmForm.Part4.DepositAmount"), "1,450.00", "deposit");
  eq(text("sfrmForm.Part4.DepositDate"), "25/08/2026", "deposit date");
  eq(text("sfrmForm.Part5.Section1.RentOwing.Row2.Owing2"), "725.00", "Oct owing");
  eq(text("sfrmForm.Part5.Section1.TotalRentOwing"), "2,175.00", "Part 5 total rent");
  eq(text("sfrmForm.Part6.ApplicationFee"), "186.00", "fee");
  eq(text("sfrmForm.Part6.TotalAmountOwe"), "2,361.00", "Part 6 total matches Part 2");
  eq(fl("sfrmForm.LanguagePreference.sfrmLanguagePreference.Language")?.getSelected?.(), "2", "English");
  eq(fl("sfrmForm.Part7.Signature.LandlordRep")?.getSelected?.(), "1", "signed as landlord");
  eq(text("sfrmForm.Part7.Signature.Signature"), "", "signature blank");

  let threw = false;
  try {
    await fillOfficialL1({
      rentalUnitAddress: "x",
      filingDateISO: "2026-11-11",
      landlord: { byEmail: false },
      tenants: [{ name: "A B" }],
      rows: c.rows,
      rentOwingCents: c.rentOwingCents + 100,
      nsfCents: 0,
      feeCents: 18600,
      totalCents: c.rentOwingCents + 100 + 18600,
    });
  } catch {
    threw = true;
  }
  eq(threw, true, "rows that don't add up refuse to fill");

  // S750: an N4 lowered by $725 keeps the same $725 off the L1.
  eq(n4ConcessionCents({ conservativeOwingCents: 217500, totalOwingCents: 145000 }), 72500, "concession = ledger - N4 total");
  eq(n4ConcessionCents({ conservativeOwingCents: 145000, totalOwingCents: 145000 }), 0, "no override, no concession");
  eq(n4ConcessionCents(null), 0, "no snapshot, no concession");
  const lowered = computeL1({ ...base, n4ConcessionCents: 72500 });
  eq(lowered.rentOwingCents, 145000, "L1 keeps the N4's reduction");
  eq(lowered.problems, [], "a lowered L1 is still valid");
  eq(lowered.rows.reduce((s, r) => s + r.owingCents, 0), 145000, "L1 rows add up to the lowered total");
  // S750: a mid-month start is prorated on the L1 too (June 28, $2,200).
  const mid = computeL1({
    ...base,
    rentCents: 220000,
    startDateISO: "2026-06-28",
    n4TerminationISO: "2026-11-11",
    filingDateISO: "2026-11-12",
    payments: ["2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01"].map((m) => ({ amount_cents: 220000, period_month: m })),
  });
  eq(mid.rentOwingCents, 242000, "June 28 start: $220 June + $2,200 November");
  console.log(`\ns748 l1: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main().catch((e) => {
  console.error("ERR", e);
  process.exit(1);
});
