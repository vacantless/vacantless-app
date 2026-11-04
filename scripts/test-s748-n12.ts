// S748g: Form N12 rules + official 2026/10 fill.
// Run: npx tsx scripts/test-s748-n12.ts   (N12_SAMPLE_OUT=path writes a sample PDF)
import fs from "node:fs";
import { PDFDocument } from "pdf-lib";
import {
  earliestN12TerminationDate,
  n12NoCompensationDate,
  n12CompensationRequired,
  n12DeemedServiceDate,
  nextMonthlyPeriodEnd,
  n12Problems,
  looksLikeCompany,
} from "@/lib/n12";
import { fillOfficialN12, N12_TEMPLATE_VERSION } from "@/lib/n12-official-pdf";
import { buildN12Snapshot, snapshotToN12Fill } from "@/lib/n12-snapshot";
import { ltbAddress, ltbDate, ltbMoney } from "@/lib/forms/ltb-2026";

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
  // --- the LTB's own examples (N12 instructions) ---
  eq(earliestN12TerminationDate({ serviceDateISO: "2026-08-01", method: "hand" }), "2026-09-30", "hand Aug 1 -> Sept 30");
  eq(earliestN12TerminationDate({ serviceDateISO: "2026-08-01", method: "mail" }), "2026-10-31", "mail Aug 1 -> Oct 31");
  eq(n12DeemedServiceDate("2026-11-06", "courier"), "2026-11-09", "courier on a Friday counts from Monday");
  eq(n12DeemedServiceDate("2026-11-03", "courier"), "2026-11-04", "courier Tuesday -> Wednesday");
  eq(n12DeemedServiceDate("2026-11-03", "mail"), "2026-11-08", "mail adds 5 days");

  // period ends
  eq(nextMonthlyPeriodEnd("2026-11-15"), "2026-11-30", "rent on the 1st ends the month");
  eq(nextMonthlyPeriodEnd("2026-11-30"), "2026-11-30", "already a period end");
  eq(nextMonthlyPeriodEnd("2026-11-15", 15), "2026-12-14", "rent on the 15th ends the 14th");
  eq(nextMonthlyPeriodEnd("2026-11-10", 15), "2026-11-14", "rent on the 15th, same month");
  eq(nextMonthlyPeriodEnd("2027-02-10", 31), "2027-02-27", "due day 31 in Feb falls on the 28th");

  // served today (Nov 3 2026) by hand
  const today = { serviceDateISO: "2026-11-03", method: "hand" as const };
  eq(earliestN12TerminationDate(today), "2027-01-31", "Nov 3 + 60 = Jan 2 -> Jan 31");
  eq(n12NoCompensationDate(today), "2027-03-31", "Nov 3 + 120 = Mar 3 -> Mar 31");

  // fixed term
  eq(
    earliestN12TerminationDate({ ...today, fixedTermEndISO: "2027-05-31" }),
    "2027-05-31",
    "still in a fixed term -> the term's last day",
  );
  eq(
    earliestN12TerminationDate({ ...today, fixedTermEndISO: "2026-12-31" }),
    "2027-01-31",
    "term ends before day 60 -> month-to-month rule",
  );

  // compensation
  eq(n12CompensationRequired({ reason: 1, ...today, terminationDateISO: "2027-01-31" }), true, "R1 under 120 days pays");
  eq(n12CompensationRequired({ reason: 1, ...today, terminationDateISO: "2027-03-31" }), false, "R1 at 120+ days does not pay");
  eq(n12CompensationRequired({ reason: 2, ...today, terminationDateISO: "2027-03-31" }), true, "R2 always pays");
  eq(
    n12CompensationRequired({ reason: 1, serviceDateISO: "2026-09-01", method: "hand", terminationDateISO: "2027-01-31" }),
    true,
    "served before 2026-09-21: old rule, pays",
  );
  eq(
    n12CompensationRequired({ reason: 1, serviceDateISO: "2026-11-03", method: "mail", terminationDateISO: "2027-03-03" }),
    true,
    "mail pushes the count: 115 days from deemed service still pays",
  );

  // problems
  const base = {
    ...today,
    reason: 1 as const,
    landlordName: "Noam Muscovitch",
    landlordIsIndividual: true,
    personName: "Noam Muscovitch",
    tenantNames: ["Liang Wu"],
    rentalUnitAddress: "123 Example St, Unit 4, Toronto, ON M5V 1A1",
  };
  eq(n12Problems({ ...base, terminationDateISO: "2027-01-31" }), [], "a valid notice has no problems");
  eq(n12Problems({ ...base, terminationDateISO: "2026-12-31" }), ["too_soon"], "under 60 days");
  eq(n12Problems({ ...base, terminationDateISO: "2027-02-15" }), ["not_period_end"], "mid-month end date");
  eq(
    n12Problems({ ...base, terminationDateISO: "2027-03-31", fixedTermEndISO: "2027-05-31" }),
    ["before_term_end"],
    "before the fixed term ends",
  );
  eq(n12Problems({ ...base, terminationDateISO: "2027-05-31", fixedTermEndISO: "2027-05-31" }), [], "ends with the term");
  eq(
    n12Problems({ ...base, landlordName: "Agile Real Estate Group", terminationDateISO: "2027-01-31" }),
    ["company_landlord"],
    "company name blocks Reason 1",
  );
  eq(
    n12Problems({ ...base, landlordIsIndividual: false, terminationDateISO: "2027-01-31" }),
    ["company_landlord"],
    "landlord says company -> Reason 1 blocked",
  );
  eq(
    n12Problems({ ...base, reason: 2, landlordName: "Agile Real Estate Group", landlordIsIndividual: false, terminationDateISO: "2027-01-31" }),
    [],
    "a company may give Reason 2",
  );
  eq(n12Problems({ ...base, personName: " ", terminationDateISO: "2027-01-31" }), ["no_person"], "needs the person's name");
  eq(looksLikeCompany("Davis Muscovitch Rentals Inc."), true, "Inc. is a company");
  eq(looksLikeCompany("Gina Smith"), false, "a person");

  // helpers
  eq(ltbDate("2027-01-31"), "31/01/2027", "dd/mm/yyyy");
  eq(ltbMoney(145000), "1,450.00", "money");
  eq(ltbAddress("1551 Assumption St, Unit 9, Windsor, ON N9A 3E2"), {
    streetNumber: "1551",
    streetName: "Assumption St",
    unit: "9",
    city: "Windsor",
    province: "ON",
    postalCode: "N9A 3E2",
  }, "address split");

  // snapshot: blank end date -> earliest; compensation follows
  const { snapshot, problems } = buildN12Snapshot({
    tenantNames: ["Liang Wu", "Mei Wu"],
    landlordName: "Noam Muscovitch",
    landlordIsIndividual: true,
    rentalUnitAddress: "123 Example St, Unit 4, Toronto, ON M5V 1A1",
    serviceDateISO: "2026-11-03",
    method: "hand",
    dueDay: 1,
    fixedTermEndISO: null,
    terminationDateISO: null,
    reason: 1,
    personName: "Neely Davis",
    relationship: "spouse",
    careProvider: false,
    signer: { firstName: "Noam", lastName: "Muscovitch", phone: "416-555-0132" },
    rentCents: 145000,
    formVersion: N12_TEMPLATE_VERSION,
    capturedAtIso: "2026-11-03T12:00:00Z",
  });
  eq(problems, [], "snapshot has no problems");
  eq(snapshot.terminationDateISO, "2027-01-31", "blank end date -> earliest");
  eq(snapshot.compensationRequired, true, "earliest date (under 120) owes compensation");
  eq(snapshot.compensationCents, 145000, "compensation = one month's rent");

  // --- fill + readback ---
  const bytes = await fillOfficialN12(snapshotToN12Fill(snapshot));
  if (process.env.N12_SAMPLE_OUT) fs.writeFileSync(process.env.N12_SAMPLE_OUT, bytes);
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  eq(doc.getPageCount(), 5, "2026/10 N12 has 5 pages");
  const key = (n: string) => n.replace(/^form1\[0\]\./, "").replace(/\[\d+\]/g, "");
  const fields = doc.getForm().getFields();
  const field = (k: string) => fields.find((f) => key(f.getName()) === k);
  const text = (k: string) => (field(k) as unknown as { getText: () => string | undefined })?.getText?.() ?? "";
  const checked = (k: string) => (field(k) as unknown as { isChecked: () => boolean })?.isChecked?.() ?? false;
  const selected = (k: string) => (field(k) as unknown as { getSelected: () => string | undefined })?.getSelected?.();

  eq(text("sfrmForm.PartyAddressInfo.txtTenant"), "Liang Wu, Mei Wu", "all tenants named");
  eq(text("sfrmForm.PartyAddressInfo.txtLandlord"), "Noam Muscovitch", "landlord");
  eq(text("sfrmForm.PartyAddressInfo.txtNumber"), "123", "street number");
  eq(text("sfrmForm.PartyAddressInfo.txtUnit"), "4", "unit");
  eq(text("sfrmForm.PartyAddressInfo.txtPostalCode"), "M5V 1A1", "postal code");
  eq(text("sfrmForm.InfofromLandlord1.TerminationDate"), "31/01/2027", "termination date");
  eq(selected("sfrmForm.Reasons.Reason1.Reason1"), "1", "Reason 1 shaded");
  eq(selected("sfrmForm.Reasons.Reason2.Reason2"), undefined, "Reason 2 not shaded");
  eq(text("sfrmForm.Reasons.Reason1.Reason1A.NameReason1"), "Neely Davis", "person moving in");
  eq(checked("sfrmForm.Reasons.Reason1.Reason1A.Reason1_A2"), true, "My spouse ticked");
  eq(checked("sfrmForm.Reasons.Reason1.Reason1A.Reason1_A1"), false, "Me not ticked");
  eq(checked("sfrmForm.Reasons.Reason1.Reason1B.Reason1_B"), false, "care box not ticked");
  eq(selected("sfrmForm.Signature.PartyType"), "1", "signed as landlord");
  eq(text("sfrmForm.Signature.txtFirstName"), "Noam", "signer first name");
  eq(text("sfrmForm.Signature.Signature"), "", "signature left blank");
  eq(text("sfrmForm.OUO.office_use_only.FileNumber"), "", "office-use box left blank");

  // Reason 2, care provider for the purchaser's parent
  const r2 = await fillOfficialN12({
    ...snapshotToN12Fill(snapshot),
    reason: 2,
    relationship: "parent",
    careProvider: true,
    personName: "Sam Carer",
  });
  const d2 = await PDFDocument.load(r2, { updateMetadata: false });
  const f2 = d2.getForm().getFields();
  const c2 = (k: string) =>
    (f2.find((f) => key(f.getName()) === k) as unknown as { isChecked: () => boolean })?.isChecked?.() ?? false;
  eq(c2("sfrmForm.Reasons.Reason2.Reason2B.Reason2_B"), true, "R2 care box ticked");
  eq(c2("sfrmForm.Reasons.Reason2.Reason2B.Reason2_B4"), true, "R2 care for the purchaser's parent");
  eq(c2("sfrmForm.Reasons.Reason2.Reason2A.Reason2_A4"), false, "R2 relationship box not ticked when care");

  // fail closed
  let threw = false;
  try {
    await fillOfficialN12({ ...snapshotToN12Fill(snapshot), personName: "" });
  } catch {
    threw = true;
  }
  eq(threw, true, "no person name refuses to fill");

  console.log(`\ns748 n12: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main().catch((e) => {
  console.error("ERR", e);
  process.exit(1);
});
