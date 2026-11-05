// S751: Form L2 from a served N13 (Schedule A).
// Run: tsx scripts/test-s751-l2-n13.ts   (L2N13_SAMPLE_OUT=path writes a sample PDF)
import fs from "node:fs";
import { PDFDocument } from "pdf-lib";
import { computeL2, earliestL2FilingDate, n13ActivityText, priorNoticeIntended } from "@/lib/l2";
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

async function main() {
  eq(earliestL2FilingDate("N13", { serviceDateISO: "2026-11-05", method: "hand" }), "2026-11-05", "N13: file right after it is given");
  eq(earliestL2FilingDate("N13", { serviceDateISO: "2026-11-05", method: "mail" }), "2026-11-10", "N13 by mail: 5 days");
  eq(n13ActivityText(2, "Replace plumbing"), "Repairs or renovations: Replace plumbing", "activity text, repairs");
  eq(n13ActivityText(1, ""), "Demolish", "activity text, demolish");
  eq(priorNoticeIntended("N12", { personName: "Ana Silva", relationship: "child", reason: 1 }), "Ana Silva (landlord's child)", "N12 prior unchanged");

  const base = {
    noticeType: "N13",
    noticeStatus: "served",
    terminationISO: "2027-03-31",
    earliestFilingISO: "2026-11-05",
    filingDateISO: "2026-11-06",
    method: "portal" as const,
    tenantInPossession: true,
    tenantCount: 1,
    n13: { compensation: "will_give" as const, orderedUnderAct: false, priorNotices: [], priorOutside: false },
  };
  eq(computeL2(base).problems, [], "valid L2 from an N13");
  eq(computeL2({ ...base, n13: { ...base.n13, compensation: "ordered" } }).problems, ["not_ordered"], "ordered needs the N13 to say so");
  eq(computeL2({ ...base, n13: { ...base.n13, compensation: "ordered", orderedUnderAct: true } }).problems, [], "ordered when the N13 says so");
  eq(computeL2({ ...base, n13: null }).problems, ["bad_compensation_choice"], "Schedule A answer needed");
  eq(computeL2({ ...base, filingDateISO: "2027-05-01" }).problems, ["too_late"], "30 days after the termination date");

  const fill = async (n13: { permitsObtained: boolean | null; compensation: "gave" | "offered" | "will_give" | "ordered"; priorOutside: boolean; prior: number }) => {
    const bytes = await fillOfficialL2({
      rentalUnitAddress: "1551 Assumption St, Unit 9, Windsor, ON N9A 3E2",
      noticeType: "N13",
      terminationISO: "2027-03-31",
      landlord: { company: "Agile Real Estate Group", byEmail: true },
      tenants: [{ name: "Gina Rossi" }],
      dailyCompensation: true,
      rentCents: 145000,
      feeCents: 18600,
      totalCents: 18600,
      n13: {
        permitsObtained: n13.permitsObtained,
        compensation: n13.compensation,
        priorOutside: n13.priorOutside,
        priorNotices: Array.from({ length: n13.prior }, (_, i) => ({
          dateISO: `2026-0${i + 1}-15`,
          address: `${i + 1}0 King St, Windsor, ON`,
          intended: "Demolish",
        })),
      },
    });
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const all = doc.getForm().getFields();
    const byFull = (n: string) => all.find((f) => f.getName() === n) as unknown as {
      getSelected?: () => string | undefined;
      isChecked?: () => boolean;
      getText?: () => string | undefined;
    };
    return { doc, bytes, byFull };
  };

  const a = await fill({ permitsObtained: false, compensation: "will_give", priorOutside: false, prior: 0 });
  if (process.env.L2N13_SAMPLE_OUT) fs.writeFileSync(process.env.L2N13_SAMPLE_OUT, a.bytes);
  const A = "form1[0].sfrmScheduleA[0].";
  eq(a.byFull("form1[0].sfrmForm[0].Part2[0].Reason1[0].N13[0]")?.isChecked?.(), true, "Part 2 N13 ticked");
  eq(a.byFull("form1[0].sfrmForm[0].Part2[0].Reason1[0].TerminationDate[0]")?.getText?.(), "31/03/2027", "termination date");
  eq(a.byFull(A + "PartA[0].PermitStatus[0]")?.getSelected?.(), "2", "permits: no");
  eq(a.byFull(A + "PartB[0].Compensation[1]")?.getSelected?.(), "3", "will give");
  eq(a.byFull(A + "PartB[0].Compensation[0]")?.getSelected?.(), undefined, "gave/offered blank");
  eq(a.byFull(A + "PartC[0].Previous_N12_N13_A[0]")?.isChecked?.(), true, "none in 2 years ticked");
  eq(a.byFull("form1[0].sfrmScheduleB[0].PartC[0].Previous_N12_N13_B[0]")?.isChecked?.(), false, "Schedule B untouched");

  const b = await fill({ permitsObtained: true, compensation: "offered", priorOutside: false, prior: 2 });
  eq(b.byFull(A + "PartA[0].PermitStatus[0]")?.getSelected?.(), "1", "permits: yes");
  eq(b.byFull(A + "PartB[0].Compensation[0]")?.getSelected?.(), "2", "offered");
  eq(b.byFull(A + "PartC[0].Table1[0].Row2[0].NoticeDate2[0]")?.getText?.(), "15/02/2026", "prior row 2 date");
  eq(b.byFull(A + "PartC[0].Previous_N12_N13_A[0]")?.isChecked?.(), false, "none-ticked off when rows listed");

  const c = await fill({ permitsObtained: null, compensation: "ordered", priorOutside: true, prior: 0 });
  eq(c.byFull(A + "PartA[0].PermitStatus[0]")?.getSelected?.(), undefined, "permits left for the landlord");
  eq(c.byFull(A + "PartB[0].Compensation[2]")?.getSelected?.(), "4", "ordered under a law");
  eq(c.byFull(A + "PartC[0].Previous_N12_N13_A[0]")?.isChecked?.(), false, "outside notices: never tick none");

  const route = fs.readFileSync("app/dashboard/tenancies/[id]/l2/official/route.ts", "utf8");
  eq(route.includes('notice.type === "N13"'), true, "route handles N13");
  const page = fs.readFileSync("app/dashboard/tenancies/[id]/page.tsx", "utf8");
  eq(/\.in\("type", \[[^\]]*"N13"[^\]]*\]\)/.test(page), true, "page lists served N13s for the L2");

  console.log(`${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
