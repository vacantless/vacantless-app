// S751: Form L10 rules + official 2026/09 fill.
// Run: tsx scripts/test-s751-l10.ts   (L10_SAMPLE_OUT=path writes a sample PDF)
import fs from "node:fs";
import { PDFDocument } from "pdf-lib";
import { computeL10, latestL10FilingDate } from "@/lib/l10";
import { fillOfficialL10 } from "@/lib/l10-official-pdf";

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
  eq(latestL10FilingDate("2026-10-31"), "2027-10-31", "one year after move-out");
  eq(latestL10FilingDate("2028-02-29"), "2029-02-28", "Feb 29 move-out");

  // Rent $1,450 from Sept 1; paid Sept, half of Oct; moved out Oct 31.
  const base = {
    moveOutISO: "2026-10-31",
    filingDateISO: "2026-11-05",
    method: "portal" as const,
    tenantCount: 1,
    rentCents: 145000,
    startDateISO: "2026-09-01",
    payments: [
      { amount_cents: 145000, period_month: "2026-09-01" },
      { amount_cents: 72500, period_month: "2026-10-01" },
    ],
  };
  const c = computeL10(base);
  eq(c.problems, [], "valid L10");
  eq(c.rentOwingCents, 72500, "rent owing to the move-out date: half of October");
  eq(c.totalCents, 72500 + 18600, "total = rent + fee");
  eq(c.rows.length, 2, "Sept and Oct rows (November not charged)");

  eq(computeL10({ ...base, moveOutISO: null }).problems, ["no_move_out"], "move-out date needed");
  eq(computeL10({ ...base, moveOutISO: "2026-11-30" }).problems, ["not_moved_out"], "future move-out: still a current tenant");
  eq(computeL10({ ...base, filingDateISO: "2027-11-01" }).problems, ["too_late"], "more than a year after");
  eq(computeL10({ ...base, moveOutISO: "2021-08-31", startDateISO: "2021-01-01", payments: [], rentCents: 100000, filingDateISO: "2022-08-01" }).problems.includes("too_old_move_out"), true, "before Sept 1, 2021");
  eq(computeL10({ ...base, payments: [...base.payments, { amount_cents: 72500, period_month: "2026-10-01" }] }).problems, ["nothing_claimed"], "nothing owed, nothing entered");
  const dmg = computeL10({ ...base, payments: [...base.payments, { amount_cents: 72500, period_month: "2026-10-01" }], damageCents: 85000, damageDetail: "Broken door and two holes in the drywall; contractor quote $850." });
  eq(dmg.problems, [], "damage alone is a valid claim");
  eq(dmg.totalCents, 85000 + 18600, "damage + fee");
  eq(computeL10({ ...base, damageCents: 85000 }).problems, ["detail_needed"], "damage needs an explanation");
  eq(computeL10({ ...base, damageCents: 85000, damageDetail: "word ".repeat(700) }).problems, ["detail_too_long"], "explanation must fit");

  const withDmg = computeL10({ ...base, damageCents: 85000, damageDetail: "Broken door and two holes in the drywall; contractor quote $850." });
  const bytes = await fillOfficialL10({
    rentalUnitAddress: "1551 Assumption St, Unit 9, Windsor, ON N9A 3E2",
    moveOutISO: withDmg.moveOutISO,
    landlord: { company: "Agile Real Estate Group", email: "rentals@example.com", phone: "519-915-8865", byEmail: true },
    tenants: [{ name: "Gina Rossi", email: "gina@example.com" }],
    tenantCurrentAddress: "20 Ouellette Ave, Unit 4, Windsor, ON N9A 1A1",
    deposit: { cents: 145000, collectedISO: "2026-08-25" },
    rows: withDmg.rows,
    rentOwingCents: withDmg.rentOwingCents,
    damageCents: withDmg.damageCents,
    damageDetail: "Broken door and two holes in the drywall; contractor quote $850.",
    interferenceCents: 0,
    feeCents: withDmg.feeCents,
    totalCents: withDmg.totalCents,
  });
  if (process.env.L10_SAMPLE_OUT) fs.writeFileSync(process.env.L10_SAMPLE_OUT, bytes);
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const key = (n: string) => n.replace(/^form1\[0\]\./, "").replace(/\[\d+\]/g, "");
  const fields = doc.getForm().getFields();
  const fl = (k: string) => fields.find((f) => key(f.getName()) === k) as unknown as {
    getText?: () => string | undefined;
    isChecked?: () => boolean;
    getSelected?: () => string | undefined;
  };
  const text = (k: string) => fl(k)?.getText?.() ?? "";
  eq(text("sfrmForm.Part1.AddressRentalUnit.txtNumber"), "1551", "rental street number");
  eq(text("sfrmForm.Part2.InfofromLandlord.txtTotalOwe"), "1,761.00", "Part 2 total");
  eq(text("sfrmForm.Part3.dptMoveOutDate"), "31/10/2026", "move-out date");
  eq(text("sfrmForm.Part3.FormerTenantNameAddress.txtTenant1FirstName"), "Gina", "tenant first");
  eq(text("sfrmForm.Part3.FormerTenantNameAddress.txtName"), "Ouellette Ave", "tenant's new street");
  eq(fl("sfrmForm.Part3.CommunicationConsent.Communication")?.getSelected?.(), "2", "email consent");
  eq(fl("sfrmForm.Part4.Reason1.chkReason1")?.isChecked?.(), true, "rent reason");
  eq(text("sfrmForm.Part4.Reason1.RentOwing.Row2.Owing2"), "725.00", "Oct owing");
  eq(text("sfrmForm.Part4.Reason1.TotalRentOwing"), "725.00", "total rent owing");
  eq(text("sfrmForm.Part4.Reason1.DepositAmount"), "1,450.00", "deposit");
  eq(fl("sfrmForm.Part4.Reason2.chkReason2")?.isChecked?.(), false, "NSF left for the landlord");
  eq(fl("sfrmForm.Part4.Reason4.chkReason4")?.isChecked?.(), true, "damage reason");
  eq(text("sfrmForm.Part4.Reason4.DamageCost"), "850.00", "damage cost");
  eq(text("sfrmForm.Part5.TotalArrears"), "725.00", "Part 5 rent");
  eq(text("sfrmForm.Part5.TotalNSF"), "", "Part 5 NSF blank");
  eq(text("sfrmForm.Part5.DamageCost"), "850.00", "Part 5 damage");
  eq(text("sfrmForm.Part5.InterferenceCost"), "", "Part 5 interference blank when none");
  eq(text("sfrmForm.Part5.ApplicationFee"), "186.00", "fee");
  eq(text("sfrmForm.Part5.TotalAmountOwing"), "1,761.00", "Part 5 total matches Part 2");
  eq(fl("sfrmForm.LanguagePreference.sfrmLanguagePreference.Language")?.getSelected?.(), "2", "English");
  eq(fl("sfrmForm.Part6.Signature.LandlordRep")?.getSelected?.(), "1", "signed as landlord");
  eq(text("sfrmForm.Part6.Signature.Signature"), "", "signature blank");

  let threw = false;
  try {
    await fillOfficialL10({
      rentalUnitAddress: "1551 Assumption St, Unit 9, Windsor, ON N9A 3E2",
      moveOutISO: "2026-10-31",
      landlord: { byEmail: false },
      tenants: [{ name: "A B" }],
      tenantCurrentAddress: "1551 Assumption St, Unit 9, Windsor, ON N9A 3E2",
      rows: c.rows,
      rentOwingCents: c.rentOwingCents,
      damageCents: 0,
      interferenceCents: 0,
      feeCents: 18600,
      totalCents: c.rentOwingCents + 18600,
    });
  } catch {
    threw = true;
  }
  eq(threw, true, "the rental unit is refused as the tenant's new address");

  const page = fs.readFileSync("app/dashboard/tenancies/[id]/page.tsx", "utf8");
  eq(page.includes("<TenancyL10Section"), true, "tenancy page shows the L10 section");
  eq(fs.readFileSync("next.config.mjs", "utf8").includes('"/dashboard/tenancies/[id]/l10/official": ["./lib/forms/ltb-l10-2026.pdf"]'), true, "template traced");
  const route = fs.readFileSync("app/dashboard/tenancies/[id]/l10/official/route.ts", "utf8");
  eq(route.includes('currentUserCan("manage_tenancies")'), true, "route needs manage_tenancies");
  eq(/—/.test(fs.readFileSync("app/dashboard/tenancies/[id]/l10-section.tsx", "utf8")), false, "no em dashes in L10 copy");

  console.log(`${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
