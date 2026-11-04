// S748g: Form N5 rules + official 2026/09 fill.
// Run: npx tsx scripts/test-s748-n5.ts   (N5_SAMPLE_OUT=path writes a sample PDF)
import fs from "node:fs";
import { PDFDocument } from "pdf-lib";
import { earliestN5TerminationDate, n5FixByDate, n5EarliestL2Date, n5LatestL2Date, n5Problems } from "@/lib/n5";
import { fillOfficialN5, type N5FillSnapshot } from "@/lib/n5-official-pdf";

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
  // The LTB's own example: first N5 handed over Nov 15 -> Dec 5; mailed -> Dec 10.
  eq(earliestN5TerminationDate("2026-11-15", "hand", "first"), "2026-12-05", "first N5 by hand: 20 days");
  eq(earliestN5TerminationDate("2026-11-15", "mail", "first"), "2026-12-10", "first N5 by mail: 20 + 5");
  eq(earliestN5TerminationDate("2026-11-15", "hand", "second"), "2026-11-29", "second N5: 14 days");
  eq(n5FixByDate("2026-11-15", "hand"), "2026-11-22", "7 days to fix");
  eq(n5EarliestL2Date("2026-11-15", "hand", "first"), "2026-11-23", "apply from the 8th day");
  eq(n5EarliestL2Date("2026-11-15", "hand", "second"), "2026-11-15", "second N5: apply right away");
  eq(n5LatestL2Date("2026-12-05"), "2027-01-04", "apply within 30 days after the end date");

  const ev = [{ when: "02/11/2026, 11:30 pm", details: "Loud party in unit 4 until 3 am; tenants in units 3 and 5 complained." }];
  const base = {
    serviceDateISO: "2026-11-15",
    method: "hand" as const,
    which: "first" as const,
    terminationDateISO: "2026-12-05",
    reasons: { interference: true, damage: false, overcrowding: false },
    events: ev,
    firstN5OnFile: false,
    tenantNames: ["Liang Wu"],
    rentalUnitAddress: "123 Example St, Unit 4, Toronto, ON M5V 1A1",
  };
  eq(n5Problems(base), [], "valid first N5");
  eq(n5Problems({ ...base, terminationDateISO: "2026-12-04" }), ["too_soon"], "19 days is too soon");
  eq(n5Problems({ ...base, reasons: { interference: false, damage: false, overcrowding: false } }), ["no_reason"], "needs a reason");
  eq(n5Problems({ ...base, events: [] }), ["no_events"], "needs an event");
  eq(n5Problems({ ...base, which: "second" }), ["no_first_n5"], "second needs a first on file");
  eq(n5Problems({ ...base, which: "second", firstN5OnFile: true, terminationDateISO: "2026-11-29" }), [], "valid second N5");
  eq(n5Problems({ ...base, reasons: { interference: false, damage: false, overcrowding: true } }), ["no_max_people"], "overcrowding needs the limit");
  eq(n5Problems({ ...base, events: [...ev, ...ev, ...ev, ...ev] }), ["too_many_events"], "form holds 3 events");
  eq(n5Problems({ ...base, events: [{ when: "x", details: "a".repeat(601) }] }), ["event_too_long"], "event too long");

  const snap: N5FillSnapshot = {
    tenantNames: ["Liang Wu"],
    landlordName: "Noam Muscovitch",
    rentalUnitAddress: "123 Example St, Unit 4, Toronto, ON M5V 1A1",
    terminationDateISO: "2026-12-05",
    which: "first",
    reasons: { interference: true, damage: true, overcrowding: false },
    repairCents: 45000,
    events: [
      ev[0],
      { when: "05/11/2026, 2:00 pm", details: "Hole punched in the hallway drywall outside unit 4; seen by the superintendent." },
    ],
    signer: { firstName: "Noam", lastName: "Muscovitch", phone: "416-555-0132" },
  };
  const bytes = await fillOfficialN5(snap);
  if (process.env.N5_SAMPLE_OUT) fs.writeFileSync(process.env.N5_SAMPLE_OUT, bytes);
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const key = (n: string) => n.replace(/^form1\[0\]\./, "").replace(/\[\d+\]/g, "");
  const fields = doc.getForm().getFields();
  const fl = (k: string) => fields.find((f) => key(f.getName()) === k) as unknown as {
    getText?: () => string | undefined;
    getSelected?: () => string | undefined;
    isChecked?: () => boolean;
  };
  const text = (k: string) => fl(k)?.getText?.() ?? "";
  eq(text("sfrmForm.InfofromLandlord1.TerminationDate"), "05/12/2026", "termination date");
  eq(fl("sfrmForm.Reasons.Reason1.Reason1")?.isChecked?.(), true, "reason 1 ticked");
  eq(fl("sfrmForm.Reasons.Reason1.Reason1_1")?.getSelected?.(), "1", "reason 1: first notice");
  eq(fl("sfrmForm.Reasons.Reason2.Reason2")?.isChecked?.(), true, "reason 2 ticked");
  eq(fl("sfrmForm.Reasons.Reason2.Reason2_1")?.getSelected?.(), "1", "reason 2: first notice");
  eq(fl("sfrmForm.Reasons.Reason2.Reason2_2")?.getSelected?.(), undefined, "reason 2: not second");
  eq(text("sfrmForm.Reasons.Reason2.PayMe1"), "450.00", "repair estimate");
  eq(fl("sfrmForm.Reasons.Reason3.Reason3")?.isChecked?.(), false, "reason 3 not ticked");
  eq(text("sfrmForm.Details.Table1.Row1.EventDateTime1"), "02/11/2026, 11:30 pm", "event 1 when");
  eq(text("sfrmForm.Details.Table1.Row2.Event2").startsWith("Hole punched"), true, "event 2 details");
  eq(text("sfrmForm.Details.Table1.Row3.Event3"), "", "event 3 blank");
  eq(fl("sfrmForm.Signature.PartyType")?.getSelected?.(), "1", "landlord signs");

  const second = await fillOfficialN5({ ...snap, which: "second", reasons: { interference: true, damage: true, overcrowding: true } });
  const d2 = await PDFDocument.load(second, { updateMetadata: false });
  const f2 = d2.getForm().getFields();
  const g2 = (k: string) => (f2.find((f) => key(f.getName()) === k) as unknown as { getSelected?: () => string | undefined; getText?: () => string })
  eq(g2("sfrmForm.Reasons.Reason1.Reason1_1")?.getSelected?.(), "2", "reason 1: second notice");
  eq(g2("sfrmForm.Reasons.Reason2.Reason2_2")?.getSelected?.(), "1", "reason 2: second notice");
  eq(g2("sfrmForm.Reasons.Reason3.Reason3_2")?.getSelected?.(), "1", "reason 3: second notice");
  eq(g2("sfrmForm.Reasons.Reason2.PayMe1")?.getText?.() ?? "", "", "no repair offer on a second notice");

  console.log(`\ns748 n5: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main().catch((e) => {
  console.error("ERR", e);
  process.exit(1);
});
