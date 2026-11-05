// S751: Form L9 rules + official 2026/09 fill.
// Run: tsx scripts/test-s751-l9.ts   (L9_SAMPLE_OUT=path writes a sample PDF)
import fs from "node:fs";
import { PDFDocument } from "pdf-lib";
import { computeL9, l9FeeCents } from "@/lib/l9";
import { fillOfficialL9, L9_TEMPLATE_REL } from "@/lib/l9-official-pdf";

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
  eq(l9FeeCents("portal"), 18600, "portal fee $186");
  eq(l9FeeCents("paper"), 20100, "paper fee $201");

  // The LTB's worked example: $1,400 rent owing, $25 NSF, $201 fee = $1,626.
  const ltb = computeL9({
    filingDateISO: "2026-11-05",
    todayISO: "2026-11-05",
    method: "paper",
    tenantInPossession: true,
    tenantCount: 1,
    rentCents: 140000,
    startDateISO: "2026-10-01",
    payments: [{ amount_cents: 140000, period_month: "2026-10-01" }],
    nsfCents: 2500,
  });
  eq(ltb.problems, [], "LTB example has no problems");
  eq(ltb.rentOwingCents, 140000, "LTB example rent owing $1,400 (November)");
  eq(ltb.totalCents, 162600, "LTB example total $1,626");

  // Rent $1,450 from Sept 1; paid Sept and half of Oct; nothing for Nov.
  const base = {
    filingDateISO: "2026-11-05",
    todayISO: "2026-11-05",
    method: "portal" as const,
    tenantInPossession: true,
    tenantCount: 2,
    rentCents: 145000,
    startDateISO: "2026-09-01",
    payments: [
      { amount_cents: 145000, period_month: "2026-09-01" },
      { amount_cents: 72500, period_month: "2026-10-01" },
    ],
  };
  const c = computeL9(base);
  eq(c.problems, [], "valid L9 has no problems");
  eq(c.rentOwingCents, 217500, "owing to the filing date: half Oct + Nov");
  eq(c.totalCents, 217500 + 18600, "total = rent + fee");
  eq(c.rows.length, 3, "Sept, Oct, Nov rows");
  eq(c.rows[c.rows.length - 1].owingCents, 145000, "last row is the last period");
  eq(c.needsScheduleOfParties, false, "2 tenants fit on the form");
  eq(computeL9({ ...base, tenantCount: 3 }).needsScheduleOfParties, true, "3 tenants need the Schedule of Parties");

  // No notice needed: nothing about an N4 can block an L9.
  eq(computeL9({ ...base, tenantInPossession: false }).problems, ["not_in_possession"], "moved out: use L10");
  eq(computeL9({ ...base, filingDateISO: "2026-12-02" }).problems, ["future_filing_date"], "no future filing date");
  eq(
    computeL9({ ...base, payments: [...base.payments, { amount_cents: 72500, period_month: "2026-10-01" }, { amount_cents: 145000, period_month: "2026-11-01" }] }).problems,
    ["no_arrears"],
    "paid up: nothing to collect",
  );
  eq(
    computeL9({ ...base, payments: [...base.payments, { amount_cents: 10000, period_month: null }] }).problems,
    ["unresolved_credits"],
    "unassigned payment blocks",
  );
  // Earlier filing date counts less: Oct 15 = half Oct only.
  eq(computeL9({ ...base, filingDateISO: "2026-10-15" }).rentOwingCents, 72500, "counted to the filing date");
  // Over $50,000.
  eq(
    computeL9({ ...base, rentCents: 2000000, startDateISO: "2026-08-01", payments: [] }).problems.includes("over_limit"),
    true,
    "over $50,000 refused",
  );

  if (!fs.existsSync(L9_TEMPLATE_REL)) {
    fail++;
    console.error(`FAIL: template ${L9_TEMPLATE_REL} missing (download the L9 and clean it, WORKFLOW 324)`);
  } else {
    const bytes = await fillOfficialL9({
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
      rows: c.rows,
      rentOwingCents: c.rentOwingCents,
      nsfCents: 0,
      feeCents: c.feeCents,
      totalCents: c.totalCents,
    });
    if (process.env.L9_SAMPLE_OUT) fs.writeFileSync(process.env.L9_SAMPLE_OUT, bytes);
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const key = (n: string) => n.replace(/^form1\[0\]\./, "").replace(/\[\d+\]/g, "");
    const fields = doc.getForm().getFields();
    const fl = (k: string) => fields.find((f) => key(f.getName()) === k) as unknown as {
      getText?: () => string | undefined;
      getSelected?: () => string | undefined;
      isChecked?: () => boolean;
    };
    const text = (k: string) => fl(k)?.getText?.() ?? "";
    eq(fields.some((f) => key(f.getName()) === "sfrmForm.Part4.DepositAmount"), false, "the L9 has no deposit boxes");
    eq(text("sfrmForm.Part1.AddressRentalUnit.txtNumber"), "1551", "rental street number");
    eq(text("sfrmForm.Part1.AddressRentalUnit.txtName"), "Assumption St", "rental street name");
    eq(text("sfrmForm.Part1.AddressRentalUnit.txtUnit"), "9", "rental unit");
    eq(text("sfrmForm.Part1.AddressRentalUnit.txtCity"), "Windsor", "rental city");
    eq(text("sfrmForm.Part1.AddressRentalUnit.txtPostalCode"), "N9A 3E2", "rental postal code");
    eq(text("sfrmForm.Part2.InfofromLandlord.txtTotalOwe"), "2,361.00", "Part 2 total incl. fee");
    eq(text("sfrmForm.Part2.InfofromLandlord.dptDepositDate"), "05/11/2026", "Part 2 as-of = filing date");
    eq(text("sfrmForm.Part3.LandlordNameAddress.txtCompanyName"), "Agile Real Estate Group", "company");
    eq(text("sfrmForm.Part3.LandlordNameAddress.txtFirstName"), "Noam", "landlord first");
    eq(text("sfrmForm.Part3.LandlordNameAddress.txtEmail"), "rentals@example.com", "landlord email");
    eq(text("sfrmForm.Part3.LandlordNameAddress.txtCity"), "Toronto", "landlord mailing city");
    eq(fl("sfrmForm.Part3.CommunicationConsent.Communication")?.getSelected?.(), "2", "email consent");
    eq(text("sfrmForm.Part3.TenantNameAddress.txtTenant1FirstName"), "Gina", "tenant 1 first");
    eq(text("sfrmForm.Part3.TenantNameAddress.txtTenant1Phone"), "519-555-0101", "tenant 1 phone");
    eq(text("sfrmForm.Part3.TenantNameAddress.txtTenant2LastName"), "Bianchi", "tenant 2 last name");
    eq(fl("sfrmForm.Part4.chkReason1")?.isChecked?.(), true, "rent reason ticked");
    eq(fl("sfrmForm.Part4.chkReason2")?.isChecked?.(), false, "NSF reason not ticked");
    eq(fl("sfrmForm.Part4.Possession")?.getSelected?.(), "1", "tenant in possession: yes");
    eq(fl("sfrmForm.Part4.sfrmPeriod_1.Period")?.getSelected?.(), "1", "rent by the month");
    eq(text("sfrmForm.Part5.Section1.RentOwing.Row1.DateFrom1"), "01/09/2026", "row 1 from");
    eq(text("sfrmForm.Part5.Section1.RentOwing.Row2.Owing2"), "725.00", "Oct owing");
    eq(text("sfrmForm.Part5.Section1.RentOwing.Row3.Charged3"), "1,450.00", "Nov charged");
    eq(text("sfrmForm.Part5.Section1.TotalRentOwing"), "2,175.00", "Part 5 total rent");
    eq(text("sfrmForm.Part6.TotalRentOwe"), "2,175.00", "Part 6 rent");
    eq(text("sfrmForm.Part6.TotalNSFOwe"), "0.00", "Part 6 NSF");
    eq(text("sfrmForm.Part6.ApplicationFee"), "186.00", "fee");
    eq(text("sfrmForm.Part6.TotalAmountOwe"), "2,361.00", "Part 6 total matches Part 2");
    eq(fl("sfrmForm.LanguagePreference.sfrmLanguagePreference.Language")?.getSelected?.(), "2", "English");
    eq(fl("sfrmForm.Part7.Signature.LandlordRep")?.getSelected?.(), "1", "signed as landlord");
    eq(text("sfrmForm.Part7.Signature.Signature"), "", "signature blank");
    eq(text("sfrmForm.Part7.Signature.dptSignDate"), "", "sign date blank");

    let threw = false;
    try {
      await fillOfficialL9({
        rentalUnitAddress: "x",
        filingDateISO: "2026-11-05",
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
  }

  // Wiring.
  const page = fs.readFileSync("app/dashboard/tenancies/[id]/page.tsx", "utf8");
  eq(page.includes("<TenancyL9Section"), true, "tenancy page shows the L9 section");
  const cfg = fs.readdirSync(".").find((n) => n.startsWith("next.config."))!;
  eq(fs.readFileSync(cfg, "utf8").includes('"/dashboard/tenancies/[id]/l9/official": ["./lib/forms/ltb-l9-2026.pdf"]'), true, "template traced for the route");
  const route = fs.readFileSync("app/dashboard/tenancies/[id]/l9/official/route.ts", "utf8");
  eq(route.includes('currentUserCan("manage_tenancies")'), true, "route needs manage_tenancies");
  eq(/—/.test(fs.readFileSync("app/dashboard/tenancies/[id]/l9-section.tsx", "utf8")), false, "no em dashes in L9 copy");

  console.log(`${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
