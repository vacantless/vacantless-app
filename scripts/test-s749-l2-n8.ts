// S749: Form L2 (notice-based) and Form N8 (persistent late rent) rules + official fills.
// Run: npx tsx scripts/test-s749-l2-n8.ts   (SAMPLE_OUT=dir writes sample PDFs)
import fs from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { computeL2, earliestL2FilingDate, latestL2FilingDate, l2FeeCents, n12IntendedText } from "@/lib/l2";
import { fillOfficialL2 } from "@/lib/l2-official-pdf";
import { findLatePeriods, n8DetailsText, n8Problems, earliestN8TerminationDate, n8DueDate } from "@/lib/n8";
import { fillOfficialN8 } from "@/lib/n8-official-pdf";

let pass = 0;
let fail = 0;
function eq(got: unknown, want: unknown, msg: string) {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else {
    fail++;
    console.error(`FAIL: ${msg} - got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

function fieldMap(pdf: PDFDocument): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of pdf.getForm().getFields()) {
    const key = f.getName().replace(/^form1\[0\]\./, "").replace(/\[\d+\]/g, "");
    const any = f as unknown as { getText?: () => string | undefined; isChecked?: () => boolean; getSelected?: () => string | undefined };
    if (any.getText) m.set(key, any.getText() ?? "");
    else if (any.isChecked) m.set(key, any.isChecked() ? "on" : "");
    else if (any.getSelected) m.set(key, any.getSelected() ?? "");
  }
  return m;
}

async function main() {
  // ---------- L2 pure ----------
  eq(l2FeeCents("portal"), 18600, "L2 portal fee $186");
  eq(l2FeeCents("paper"), 20100, "L2 paper fee $201");
  eq(latestL2FilingDate("2026-12-31"), "2027-01-30", "file no later than 30 days after termination");
  eq(earliestL2FilingDate("N5", { earliestL2ISO: "2026-11-12" }), "2026-11-12", "N5 uses its stored first filing day");
  eq(earliestL2FilingDate("N12", { serviceDateISO: "2026-11-04", method: "mail" }), "2026-11-09", "N12 by mail: once it counts as given");
  eq(earliestL2FilingDate("N8", { serviceDateISO: "2026-11-04", method: "hand" }), "2026-11-04", "N8 by hand: right away");
  eq(earliestL2FilingDate("N12", {}), null, "never guess a date the snapshot can't give");
  eq(earliestL2FilingDate("N4", { serviceDateISO: "2026-11-04", method: "hand" }), null, "N4 goes to the L1, not the L2");

  const base = {
    noticeType: "N12",
    noticeStatus: "served",
    terminationISO: "2027-01-31",
    earliestFilingISO: "2026-11-04",
    filingDateISO: "2026-11-05",
    method: "portal" as const,
    tenantInPossession: true,
    tenantCount: 1,
    n12: { reason: 1 as const, compensationRequired: true, compensation: "will_give" as const, priorNotices: [], priorOutside: false },
  };
  const ok = computeL2(base);
  eq(ok.problems, [], "valid N12 L2");
  eq(ok.totalCents, 18600, "total = fee");
  eq(computeL2({ ...base, noticeStatus: "draft" }).problems, ["notice_not_served"], "notice must be served");
  eq(computeL2({ ...base, filingDateISO: "2026-11-03" }).problems, ["too_early"], "before the first filing day");
  eq(computeL2({ ...base, filingDateISO: "2027-03-03" }).problems, ["too_late"], "31+ days after termination");
  eq(computeL2({ ...base, filingDateISO: "2027-03-02" }).problems, [], "exactly 30 days after is fine");
  eq(computeL2({ ...base, tenantInPossession: false }).problems, ["not_in_possession"], "tenant moved out");
  eq(computeL2({ ...base, noticeType: "N4" }).problems, ["unsupported_notice"], "N4 refused");
  eq(
    computeL2({ ...base, n12: { ...base.n12, compensation: "not_required" } }).problems,
    ["compensation_needed"],
    "not required refused when the notice gave under 120 days",
  );
  eq(
    computeL2({ ...base, n12: { ...base.n12, compensationRequired: false, compensation: "not_required" } }).problems,
    [],
    "not required accepted for Reason 1 with 120+ days",
  );
  eq(
    computeL2({ ...base, n12: { ...base.n12, reason: 2, compensationRequired: false, compensation: "not_required" } }).problems,
    ["compensation_needed"],
    "purchaser always pays",
  );
  eq(
    computeL2({ ...base, n12: { ...base.n12, priorNotices: [1, 2, 3, 4].map(() => ({ dateISO: "2026-01-01", address: "a", intended: "b" })) } }).problems,
    ["too_many_prior_notices"],
    "more than 3 prior notices",
  );
  eq(computeL2({ ...base, tenantCount: 3 }).needsScheduleOfParties, true, "3 tenants need the Schedule of Parties");
  eq(n12IntendedText("Ana Lee", "child", 1), "Ana Lee (landlord's child)", "intended occupant text");
  eq(n12IntendedText("Ana Lee", "self", 2), "Ana Lee (purchaser)", "purchaser text");

  // ---------- N8 pure (the LTB's rule: 3+ payments more than 7 days late in 6 months) ----------
  eq(n8DueDate("2026-02-01", 31), "2026-02-28", "due day past month end");
  const rent = 145000;
  const pays = [
    { amount_cents: rent, period_month: "2026-06-01", paid_on: "2026-06-12" }, // 11 days late
    { amount_cents: rent, period_month: "2026-07-01", paid_on: "2026-07-08" }, // 7 days: not late
    { amount_cents: 70000, period_month: "2026-08-01", paid_on: "2026-08-02" },
    { amount_cents: 75000, period_month: "2026-08-01", paid_on: "2026-08-20" }, // full on the 20th: 19 late
    { amount_cents: rent, period_month: "2026-09-01", paid_on: "2026-09-01" },
    { amount_cents: rent, period_month: "2026-10-01", paid_on: "2026-10-15" }, // 14 late
    { amount_cents: 50000, period_month: "2026-11-01", paid_on: "2026-11-03" }, // short: arrears, not late
    { amount_cents: rent, period_month: "2026-03-01", paid_on: "2026-03-20" }, // outside 6 months
  ];
  const late = findLatePeriods({ rentCents: rent, payments: pays, asOfISO: "2026-11-04" });
  eq(late.map((l) => [l.periodISO, l.daysLate]), [["2026-06-01", 11], ["2026-08-01", 19], ["2026-10-01", 14]], "late periods");
  const details = n8DetailsText(rent, 1, late);
  eq(details.split("\n").length, 5, "details: rent line, count line, 3 periods");
  eq(details.includes("—"), false, "no em dash in details");
  eq(details.startsWith("The rent is $1,450.00 a month, due on the 1st"), true, "details opening");
  const n8in = {
    serviceDateISO: "2026-11-04",
    method: "hand" as const,
    dueDay: 1,
    fixedTermEndISO: null,
    terminationDateISO: earliestN8TerminationDate({ serviceDateISO: "2026-11-04", method: "hand", dueDay: 1, fixedTermEndISO: null }),
    lateCount: late.length,
    details,
    tenantNames: ["Gina Rossi"],
    rentalUnitAddress: "1551 Assumption St, Unit 9, Windsor, ON N9A 3E2",
  };
  eq(n8in.terminationDateISO, "2027-01-31", "N8 earliest end: 60 days then month end");
  eq(n8Problems(n8in), [], "valid N8");
  eq(n8Problems({ ...n8in, lateCount: 2 }), ["too_few_late"], "needs 3 late payments");
  eq(n8Problems({ ...n8in, terminationDateISO: "2026-12-31" }), ["too_soon"], "under 60 days");
  eq(n8Problems({ ...n8in, terminationDateISO: "2027-01-30" }), ["not_period_end"], "not a month end");
  eq(n8Problems({ ...n8in, details: "x".repeat(1801) }), ["details_too_long"], "details cap");
  // LTB worked example: notice Aug 1 by hand -> Sept 30; by mail -> Oct 31.
  eq(earliestN8TerminationDate({ serviceDateISO: "2026-08-01", method: "hand", dueDay: 1, fixedTermEndISO: null }), "2026-09-30", "LTB example by hand");
  eq(earliestN8TerminationDate({ serviceDateISO: "2026-08-01", method: "mail", dueDay: 1, fixedTermEndISO: null }), "2026-10-31", "LTB example by mail");

  // ---------- fills (official templates) ----------
  const out = process.env.SAMPLE_OUT;
  const l2Bytes = await fillOfficialL2({
    rentalUnitAddress: "1551 Assumption St, Unit 9, Windsor, ON N9A 3E2",
    noticeType: "N12",
    terminationISO: "2027-01-31",
    landlord: {
      company: "",
      firstName: "Noam",
      lastName: "Muscovitch",
      email: "rentals@example.com",
      phone: "519-915-8865",
      mailingAddress: "100 King St W, Unit 5, Toronto, ON M5X 1A9",
      byEmail: true,
    },
    tenants: [
      { name: "Gina Rossi", email: "gina@example.com", phone: "519-555-0101" },
      { name: "Marco Bianchi" },
    ],
    dailyCompensation: true,
    rentCents: rent,
    deposit: { cents: rent, collectedISO: "2026-01-01", interestFromISO: "2026-01-01", interestToISO: "2026-12-31" },
    feeCents: 18600,
    totalCents: 18600,
    n12: {
      reason: 1,
      compensation: "will_give",
      priorNotices: [{ dateISO: "2025-06-02", address: "833 Pillette Rd, Unit 20, Windsor, ON", intended: "Ana Lee (landlord's child)" }],
      priorOutside: false,
    },
  });
  const l2 = fieldMap(await PDFDocument.load(l2Bytes));
  const L = (k: string) => l2.get(k);
  eq(L("sfrmForm.Part1.AddressRentalUnit.txtNumber"), "1551", "L2 street number");
  eq(L("sfrmForm.Part1.AddressRentalUnit.txtUnit"), "9", "L2 unit");
  eq(L("sfrmForm.Part1.AddressRentalUnit.txtPostalCode"), "N9A 3E2", "L2 postal code");
  eq(L("sfrmForm.Part1.LandlordNameAddress.txtLastName"), "Muscovitch", "L2 landlord last name");
  eq(L("sfrmForm.Part1.LandlordNameAddress.txtCity"), "Toronto", "L2 landlord city");
  eq(L("sfrmForm.Part1.TenantNameAddress.txtTenant2FirstName"), "Marco", "L2 tenant 2");
  eq(L("sfrmForm.Part1.TenantNameAddress.txtNumber"), "", "L2 tenant mailing address blank (same as unit)");
  eq(L("sfrmForm.Part2.Reason1.N12"), "on", "L2 N12 ticked");
  eq(L("sfrmForm.Part2.Reason1.N5"), "", "L2 N5 not ticked");
  eq(L("sfrmForm.Part2.Reason1.TerminationDate"), "31/01/2027", "L2 termination date");
  eq(L("sfrmForm.Part3.Reason1.R1"), "on", "L2 daily compensation");
  eq(L("sfrmForm.Part3.Reason2.CurrentRent"), "1,450.00", "L2 current rent");
  eq(L("sfrmForm.Part3.Reason2.RentDeposit"), "1,450.00", "L2 deposit");
  eq(L("sfrmForm.Part3.Reason2.DepositDateTo"), "31/12/2026", "L2 deposit interest to");
  eq(L("sfrmForm.Part3.Reason2.R2"), "", "L2 NSF box untouched");
  eq(L("sfrmForm.Part4.Table.ApplicationFee"), "186.00", "L2 fee");
  eq(L("sfrmForm.Part4.Table.TotalAmountOwing"), "186.00", "L2 total");
  eq(L("sfrmForm.Part5.Signature.Signature"), "", "L2 signature blank");
  eq(L("sfrmForm.Part5.Signature.dptSignDate"), "", "L2 sign date blank");
  eq(L("sfrmScheduleB.PartC.Table1.Row1.NoticeDate1"), "02/06/2025", "Schedule B prior notice date");
  eq(L("sfrmScheduleB.PartC.Table1.Row1.Intended1"), "Ana Lee (landlord's child)", "Schedule B intended occupant");
  eq(L("sfrmScheduleB.PartC.Previous_N12_N13_B"), "", "none-box not ticked when a prior notice is listed");
  if (out) fs.writeFileSync(path.join(out, "sample-L2-N12.pdf"), l2Bytes);

  // N5-based L2, no prior notices concept, no daily compensation.
  const l2b = fieldMap(
    await PDFDocument.load(
      await fillOfficialL2({
        rentalUnitAddress: "1551 Assumption St, Unit 9, Windsor, ON N9A 3E2",
        noticeType: "N5",
        terminationISO: "2026-11-30",
        landlord: { company: "Agile Real Estate Group Inc.", byEmail: false },
        tenants: [{ name: "Gina Rossi" }],
        dailyCompensation: false,
        feeCents: 20100,
        totalCents: 20100,
      }),
    ),
  );
  eq(l2b.get("sfrmForm.Part2.Reason1.N5"), "on", "N5 L2 ticks N5");
  eq(l2b.get("sfrmForm.Part3.Reason1.R1"), "", "no daily compensation when not asked");
  eq(l2b.get("sfrmForm.Part3.Reason2.CurrentRent"), "", "rent block blank without daily compensation");
  eq(l2b.get("sfrmForm.Part4.Table.ApplicationFee"), "201.00", "paper fee");
  eq(l2b.get("sfrmScheduleB.PartC.Previous_N12_N13_B"), "", "Schedule B untouched for an N5");

  // N12 with nothing before and nothing outside -> the "none" box.
  const l2c = fieldMap(
    await PDFDocument.load(
      await fillOfficialL2({
        rentalUnitAddress: "1551 Assumption St, Unit 9, Windsor, ON N9A 3E2",
        noticeType: "N12",
        terminationISO: "2027-03-31",
        landlord: { firstName: "Noam", lastName: "Muscovitch", byEmail: true },
        tenants: [{ name: "Gina Rossi" }],
        dailyCompensation: false,
        feeCents: 18600,
        totalCents: 18600,
        n12: { reason: 1, compensation: "not_required", priorNotices: [], priorOutside: false },
      }),
    ),
  );
  eq(l2c.get("sfrmScheduleB.PartC.Previous_N12_N13_B"), "on", "none-box ticked");
  const l2d = fieldMap(
    await PDFDocument.load(
      await fillOfficialL2({
        rentalUnitAddress: "1551 Assumption St, Unit 9, Windsor, ON N9A 3E2",
        noticeType: "N12",
        terminationISO: "2027-03-31",
        landlord: { byEmail: true },
        tenants: [{ name: "Gina Rossi" }],
        dailyCompensation: false,
        feeCents: 18600,
        totalCents: 18600,
        n12: { reason: 1, compensation: "gave", priorNotices: [], priorOutside: true },
      }),
    ),
  );
  eq(l2d.get("sfrmScheduleB.PartC.Previous_N12_N13_B"), "", "none-box left for the landlord when others exist outside");

  let threw = false;
  try {
    await fillOfficialL2({
      rentalUnitAddress: "x",
      noticeType: "N12",
      terminationISO: "2027-03-31",
      landlord: { byEmail: true },
      tenants: [{ name: "A B" }],
      dailyCompensation: false,
      feeCents: 18600,
      totalCents: 18600,
      n12: { reason: 2, compensation: "not_required", priorNotices: [], priorOutside: false },
    });
  } catch {
    threw = true;
  }
  eq(threw, true, "fill refuses purchaser + not required");

  const n8Bytes = await fillOfficialN8({
    tenantNames: ["Gina Rossi", "Marco Bianchi"],
    landlordName: "Agile Real Estate Group Inc.",
    rentalUnitAddress: "1551 Assumption St, Unit 9, Windsor, ON N9A 3E2",
    terminationDateISO: "2027-01-31",
    details,
    signer: { firstName: "Noam", lastName: "Muscovitch", phone: "519-915-8865" },
  });
  const n8 = fieldMap(await PDFDocument.load(n8Bytes));
  eq(n8.get("sfrmForm.PartyAddressInfo.txtTenant"), "Gina Rossi, Marco Bianchi", "N8 tenants");
  eq(n8.get("sfrmForm.PartyAddressInfo.txtCity"), "Windsor", "N8 city");
  eq(n8.get("sfrmForm.InfofromLandlord1.TerminationDate"), "31/01/2027", "N8 date");
  eq(n8.get("sfrmForm.Reasons.Reason1.Reason1"), "on", "N8 reason 1");
  eq(n8.get("sfrmForm.Reasons.Reason2.Reason2"), "", "N8 reason 2 off");
  eq(n8.get("sfrmForm.Details.NoticeDetail"), details, "N8 details");
  eq(n8.get("sfrmForm.Signature.txtLastName"), "Muscovitch", "N8 signer");
  eq(n8.get("sfrmForm.Signature.Signature"), "", "N8 signature blank");
  if (out) fs.writeFileSync(path.join(out, "sample-N8.pdf"), n8Bytes);

  console.log(`${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
