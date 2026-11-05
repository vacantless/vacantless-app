// S751: Form N13 rules + official 2026/09 fill.
// Run: tsx scripts/test-s751-n13.ts   (N13_SAMPLE_OUT=path writes a sample PDF)
import fs from "node:fs";
import { PDFDocument } from "pdf-lib";
import { earliestN13TerminationDate, n13CompensationCents, n13Problems, fitsBox, N13_WORK_DETAILS_BOX } from "@/lib/n13";
import { buildN13Snapshot, snapshotToN13Fill } from "@/lib/n13-snapshot";
import { fillOfficialN13 } from "@/lib/n13-official-pdf";

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
  // The LTB's worked example: for an August 31 end date, hand delivery by May 3,
  // mail by April 28.
  eq(earliestN13TerminationDate({ serviceDateISO: "2027-05-03", method: "hand" }), "2027-08-31", "hand May 3 -> Aug 31");
  eq(earliestN13TerminationDate({ serviceDateISO: "2027-05-04", method: "hand" }), "2027-09-30", "hand May 4 -> Sept 30");
  eq(earliestN13TerminationDate({ serviceDateISO: "2027-04-28", method: "mail" }), "2027-08-31", "mail Apr 28 -> Aug 31");
  eq(earliestN13TerminationDate({ serviceDateISO: "2027-04-29", method: "mail" }), "2027-09-30", "mail Apr 29 -> Sept 30");
  eq(earliestN13TerminationDate({ serviceDateISO: "2026-11-05", method: "hand", fixedTermEndISO: "2027-06-30" }), "2027-06-30", "fixed term ends later: its last day");
  eq(earliestN13TerminationDate({ serviceDateISO: "2026-11-05", method: "hand", mobileHome: true }), "2027-11-30", "mobile home: 1 year");

  // Compensation.
  eq(n13CompensationCents({ rentCents: 150000, residentialUnits: 4 }), 150000, "under 5 units: 1 month");
  eq(n13CompensationCents({ rentCents: 150000, residentialUnits: 5 }), 450000, "5+ units: 3 months");
  eq(n13CompensationCents({ rentCents: 150000, residentialUnits: 40, orderedUnderAct: true }), null, "ordered under an Act: none");
  eq(n13CompensationCents({ rentCents: 50000, residentialUnits: 1, mobileHome: true }), 300000, "mobile home: lesser of a year or $3,000");
  eq(n13CompensationCents({ rentCents: 20000, residentialUnits: 1, mobileHome: true }), 240000, "mobile home: a year when under $3,000");

  const good = {
    serviceDateISO: "2026-11-05",
    method: "hand" as const,
    terminationDateISO: "2027-03-31",
    reason: 2 as const,
    permits: "will_obtain",
    workPlanned: "Replace all plumbing and electrical",
    workDetails: "Licensed contractor, April 1 to July 31, 2027. Walls opened in every room; water and power off for weeks.",
    tenantNames: ["Gina Rossi"],
    rentalUnitAddress: "1551 Assumption St, Unit 9, Windsor, ON N9A 3E2",
  };
  eq(n13Problems(good), [], "valid N13");
  eq(n13Problems({ ...good, terminationDateISO: "2027-02-28" }), ["too_soon"], "under 120 days");
  eq(n13Problems({ ...good, terminationDateISO: "2027-03-30" }), ["not_period_end"], "not a period end");
  eq(n13Problems({ ...good, permits: "none_needed" }), ["repair_needs_permit"], "repairs need a permit");
  eq(n13Problems({ ...good, reason: 1, permits: "none_needed" }), [], "demolish may need no permit");
  eq(n13Problems({ ...good, fixedTermEndISO: "2027-06-30" }), ["before_term_end"], "before the fixed term ends");
  eq(n13Problems({ ...good, workDetails: "" }), ["no_work"], "work details required");
  eq(n13Problems({ ...good, workDetails: "word ".repeat(600) }), ["work_too_long"], "too long for the box");
  eq(fitsBox("x ".repeat(300), N13_WORK_DETAILS_BOX), true, "600 characters fit the details box");

  const { snapshot, problems } = buildN13Snapshot({
    tenantNames: ["Gina Rossi", "Marco Bianchi"],
    landlordName: "Agile Real Estate Group",
    rentalUnitAddress: good.rentalUnitAddress,
    serviceDateISO: "2026-11-05",
    method: "hand",
    dueDay: 1,
    fixedTermEndISO: null,
    mobileHome: false,
    terminationDateISO: null,
    reason: 2,
    workPlanned: good.workPlanned,
    workDetails: good.workDetails,
    permits: "will_obtain",
    residentialUnits: 12,
    orderedUnderAct: false,
    signer: { firstName: "Noam", lastName: "Muscovitch", phone: "519-915-8865" },
    rentCents: 145000,
    formVersion: "2026/09",
    capturedAtIso: "2026-11-05T12:00:00Z",
  });
  eq(problems, [], "snapshot valid");
  eq(snapshot.terminationDateISO, "2027-03-31", "blank end date = earliest");
  eq(snapshot.compensationCents, 435000, "12 units: 3 months of $1,450");

  const bytes = await fillOfficialN13(snapshotToN13Fill(snapshot));
  if (process.env.N13_SAMPLE_OUT) fs.writeFileSync(process.env.N13_SAMPLE_OUT, bytes);
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const key = (n: string) => n.replace(/^form1\[0\]\./, "").replace(/\[\d+\]/g, "");
  const fields = doc.getForm().getFields();
  const fl = (k: string) => fields.find((f) => key(f.getName()) === k) as unknown as {
    getText?: () => string | undefined;
    getSelected?: () => string | undefined;
  };
  const text = (k: string) => fl(k)?.getText?.() ?? "";
  eq(text("sfrmForm.PartyAddressInfo.txtTenant"), "Gina Rossi, Marco Bianchi", "tenants");
  eq(text("sfrmForm.PartyAddressInfo.txtLandlord"), "Agile Real Estate Group", "landlord");
  eq(text("sfrmForm.PartyAddressInfo.txtNumber"), "1551", "street number");
  eq(text("sfrmForm.PartyAddressInfo.txtUnit"), "9", "unit");
  eq(text("sfrmForm.InfofromLandlord1.TerminationDate"), "31/03/2027", "termination date");
  eq(fl("sfrmForm.Reasons.Reason2.Reason2")?.getSelected?.(), "1", "Reason 2 shaded");
  eq(fl("sfrmForm.Reasons.Reason1.Reason1")?.getSelected?.(), undefined, "Reason 1 blank");
  eq(text("sfrmForm.Details.Table1.Row1.WorkPlanned"), good.workPlanned, "work planned");
  eq(text("sfrmForm.Details.Table1.Row1.WorkDetails"), good.workDetails, "work details");
  eq(fl("sfrmForm.Permits.NecessaryPermits")?.getSelected?.(), "2", "will obtain permits");
  eq(fl("sfrmForm.Signature.PartyType")?.getSelected?.(), "1", "signed as landlord");
  eq(text("sfrmForm.Signature.txtFirstName"), "Noam", "signer first");
  eq(text("sfrmForm.Signature.Signature"), "", "signature blank");
  eq(text("sfrmForm.Signature.dptSignDate"), "", "sign date blank");

  let threw = false;
  try {
    await fillOfficialN13({ ...snapshotToN13Fill(snapshot), permits: "none_needed" });
  } catch {
    threw = true;
  }
  eq(threw, true, "Reason 2 with no permits refuses to fill");

  const page = fs.readFileSync("app/dashboard/tenancies/[id]/page.tsx", "utf8");
  eq(page.includes("<TenancyN13Section"), true, "tenancy page shows the N13 section");
  eq(fs.readFileSync("next.config.mjs", "utf8").includes('"/dashboard/tenancies/[id]/n13/official": ["./lib/forms/ltb-n13-2026.pdf"]'), true, "template traced");
  const actions = fs.readFileSync("app/dashboard/tenancies/n13-actions.ts", "utf8");
  eq(actions.includes('requireCapability("manage_tenancies"'), true, "actions need manage_tenancies");
  eq(actions.includes("organization_id: t.organization_id"), true, "org from the tenancy read");
  eq(/—/.test(fs.readFileSync("app/dashboard/tenancies/[id]/n13-section.tsx", "utf8")), false, "no em dashes in N13 copy");

  console.log(`${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
