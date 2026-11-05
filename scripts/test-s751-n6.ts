// S751: Form N6 rules + official 2026/09 fill + L2 from an N6.
// Run: tsx scripts/test-s751-n6.ts   (N6_SAMPLE_OUT=path writes a sample PDF)
import fs from "node:fs";
import { PDFDocument } from "pdf-lib";
import { earliestN6TerminationDate, n6EarliestL2Date, n6MinDays, n6Problems } from "@/lib/n6";
import { fillOfficialN6 } from "@/lib/n6-official-pdf";
import { computeL2, earliestL2FilingDate } from "@/lib/l2";
import { fillOfficialL2 } from "@/lib/l2-official-pdf";

let pass = 0;
let fail = 0;
function eq(got: unknown, want: unknown, msg: string) {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else {
    fail++;
    console.error(`FAIL: ${msg} - got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

const DRUGS = { drugs: true, illegal: false, income: false };
const ILLEGAL = { drugs: false, illegal: true, income: false };
const BOTH = { drugs: true, illegal: true, income: false };

async function main() {
  eq(n6MinDays(DRUGS, "first"), 10, "drugs only: 10 days");
  eq(n6MinDays(ILLEGAL, "first"), 20, "other illegal act: 20 days");
  eq(n6MinDays(ILLEGAL, "second"), 14, "second after an N5: 14 days");
  eq(n6MinDays(BOTH, "first"), 20, "drugs plus another reason: the 20-day rule");
  // The LTB's example: a second notice handed over Nov 22 (after an N5) ends no earlier than Dec 6; mailed, Dec 11.
  eq(earliestN6TerminationDate("2026-11-22", "hand", ILLEGAL, "second"), "2026-12-06", "LTB example, by hand");
  eq(earliestN6TerminationDate("2026-11-22", "mail", ILLEGAL, "second"), "2026-12-11", "LTB example, by mail");
  eq(earliestN6TerminationDate("2026-11-05", "hand", DRUGS, "first"), "2026-11-15", "drugs by hand: 10 days");
  eq(n6EarliestL2Date("2026-11-05", "mail"), "2026-11-10", "L2 once it counts as given");

  const good = {
    serviceDateISO: "2026-11-05",
    method: "hand" as const,
    which: "first" as const,
    terminationDateISO: "2026-11-25",
    reasons: ILLEGAL,
    events: [{ when: "02/11/2026, 11:30 pm", details: "Tenant ran an unlicensed short-term rental business from the unit." }],
    firstN5OnFile: false,
    tenantNames: ["Gina Rossi"],
    rentalUnitAddress: "1551 Assumption St, Unit 9, Windsor, ON N9A 3E2",
  };
  eq(n6Problems(good), [], "valid N6");
  eq(n6Problems({ ...good, terminationDateISO: "2026-11-24" }), ["too_soon"], "19 days is too soon");
  eq(n6Problems({ ...good, reasons: DRUGS, terminationDateISO: "2026-11-15" }), [], "drugs: 10 days is enough");
  eq(n6Problems({ ...good, which: "second", terminationDateISO: "2026-11-19" }), ["no_first_n5"], "14 days needs an N5 first");
  eq(n6Problems({ ...good, which: "second", terminationDateISO: "2026-11-19", firstN5OnFile: true }), [], "14 days after an N5");
  eq(n6Problems({ ...good, reasons: { drugs: false, illegal: false, income: false } }), ["no_reason"], "a reason is needed");
  eq(n6Problems({ ...good, events: [] }), ["no_events"], "an event is needed");
  eq(n6Problems({ ...good, events: [{ when: "x", details: "word ".repeat(400) }] }), ["event_too_long"], "too long for the box");
  eq(n6Problems({ ...good, events: [1, 2, 3, 4].map((i) => ({ when: `${i}`, details: "x" })) }), ["too_many_events"], "3 events max");

  const bytes = await fillOfficialN6({
    tenantNames: ["Gina Rossi", "Marco Bianchi"],
    landlordName: "Agile Real Estate Group",
    rentalUnitAddress: good.rentalUnitAddress,
    terminationDateISO: "2026-11-25",
    reasons: { drugs: false, illegal: true, income: true },
    events: [
      { when: "02/11/2026, 11:30 pm", details: "Tenant ran an unlicensed short-term rental business from the unit." },
      { when: "Annual review, 15/10/2026", details: "Reported $1,200/month income; pay stubs show $3,400/month since June 2026." },
    ],
    signer: { firstName: "Noam", lastName: "Muscovitch", phone: "519-915-8865" },
  });
  if (process.env.N6_SAMPLE_OUT) fs.writeFileSync(process.env.N6_SAMPLE_OUT, bytes);
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const key = (n: string) => n.replace(/^form1\[0\]\./, "").replace(/\[\d+\]/g, "");
  const fields = doc.getForm().getFields();
  const fl = (k: string) => fields.find((f) => key(f.getName()) === k) as unknown as {
    getText?: () => string | undefined;
    isChecked?: () => boolean;
    getSelected?: () => string | undefined;
  };
  const text = (k: string) => fl(k)?.getText?.() ?? "";
  eq(text("sfrmForm.PartyAddressInfo.txtTenant"), "Gina Rossi, Marco Bianchi", "tenants");
  eq(text("sfrmForm.InfofromLandlord1.TerminationDate"), "25/11/2026", "termination date");
  eq(fl("sfrmForm.Reasons.Reason1.Reason1")?.isChecked?.(), false, "Reason 1 blank");
  eq(fl("sfrmForm.Reasons.Reason2.Reason2")?.isChecked?.(), true, "Reason 2 ticked");
  eq(fl("sfrmForm.Reasons.Reason3.Reason3")?.isChecked?.(), true, "Reason 3 ticked");
  eq(text("sfrmForm.Details.Table1.Row2.EventDateTime2"), "Annual review, 15/10/2026", "event 2 date");
  eq(text("sfrmForm.Details.Table1.Row1.Event1").startsWith("Tenant ran"), true, "event 1 details");
  eq(fl("sfrmForm.Signature.PartyType")?.getSelected?.(), "1", "signed as landlord");
  eq(text("sfrmForm.Signature.Signature"), "", "signature blank");

  // L2 from a served N6.
  eq(earliestL2FilingDate("N6", { serviceDateISO: "2026-11-05", method: "hand" }), "2026-11-05", "L2: file once given");
  const l2 = computeL2({
    noticeType: "N6",
    noticeStatus: "served",
    terminationISO: "2026-11-25",
    earliestFilingISO: "2026-11-05",
    filingDateISO: "2026-11-06",
    method: "portal",
    tenantInPossession: true,
    tenantCount: 1,
  });
  eq(l2.problems, [], "L2 from an N6 is valid");
  const l2bytes = await fillOfficialL2({
    rentalUnitAddress: good.rentalUnitAddress,
    noticeType: "N6",
    terminationISO: "2026-11-25",
    landlord: { company: "Agile Real Estate Group", byEmail: true },
    tenants: [{ name: "Gina Rossi" }],
    dailyCompensation: true,
    rentCents: 145000,
    feeCents: 18600,
    totalCents: 18600,
  });
  const l2doc = await PDFDocument.load(l2bytes, { updateMetadata: false });
  const n6box = l2doc.getForm().getFields().find((f) => key(f.getName()) === "sfrmForm.Part2.Reason1.N6") as unknown as { isChecked: () => boolean };
  eq(n6box?.isChecked(), true, "L2 Part 2 N6 ticked");

  const page = fs.readFileSync("app/dashboard/tenancies/[id]/page.tsx", "utf8");
  eq(page.includes("<TenancyN6Section"), true, "tenancy page shows the N6 section");
  eq(page.includes('.in("type", ["N5", "N6", "N8", "N12", "N13"])'), true, "L2 lists served N6s");
  eq(fs.readFileSync("next.config.mjs", "utf8").includes('"/dashboard/tenancies/[id]/n6/official": ["./lib/forms/ltb-n6-2026.pdf"]'), true, "template traced");
  const actions = fs.readFileSync("app/dashboard/tenancies/n6-actions.ts", "utf8");
  eq(actions.includes('requireCapability("manage_tenancies"'), true, "actions need manage_tenancies");
  eq(/—/.test(fs.readFileSync("app/dashboard/tenancies/[id]/n6-section.tsx", "utf8")), false, "no em dashes in N6 copy");

  console.log(`${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
