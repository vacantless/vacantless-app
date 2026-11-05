import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentUserCan } from "@/lib/membership";
import { postLeaseRouteWalled } from "@/lib/post-lease-surface";
import {
  computeL2,
  earliestL2FilingDate,
  priorNoticeIntended,
  L2_N12_COMPENSATION,
  L2_N13_COMPENSATION,
  type L2N12Compensation,
  type L2N13Compensation,
  type L2NoticeSnap,
  type L2NoticeType,
  type L2PriorNotice,
} from "@/lib/l2";
import { fillOfficialL2 } from "@/lib/l2-official-pdf";
import { addDaysISO } from "@/lib/n12";
import { type L1FilingMethod } from "@/lib/l1";
import { parseAmountToCents, parseDateOrNull } from "@/lib/payments";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

// S749: build the official Form L2 (2026/09) from a served N5, N8, N12 or N13 (S751). POST
// (the landlord's contact details stay out of the URL). Returns the PDF for the
// landlord to sign and file; nothing is filed for them. manage_tenancies only;
// RLS scopes every read to the caller's org.

type NoticeSnap = L2NoticeSnap;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (await postLeaseRouteWalled()) return new Response("Not found", { status: 404 });
  if (!(await currentUserCan("manage_tenancies"))) return new NextResponse("Forbidden", { status: 403 });

  const form = await req.formData();
  const s = (k: string) => String(form.get(k) ?? "").trim();
  const back = (q: string) =>
    NextResponse.redirect(new URL(`/dashboard/tenancies/${params.id}?l2=${q}#notices`, req.url), 303);

  const noticeId = s("notice_id");
  const method: L1FilingMethod = s("method") === "paper" ? "paper" : "portal";
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
  const filingDateISO = parseDateOrNull(s("filing_date")) ?? today;

  const supabase = createClient();
  const { data: n } = await supabase
    .from("notices")
    .select("id, type, status, termination_date, snapshot")
    .eq("id", noticeId)
    .eq("tenancy_id", params.id)
    .maybeSingle();
  const notice = n as { id: string; type: string; status: string; termination_date: string | null; snapshot: NoticeSnap | null } | null;
  if (!notice || !notice.termination_date || !notice.snapshot) return back("notice_not_served");
  const snap = notice.snapshot;
  const earliest = earliestL2FilingDate(notice.type, snap);
  if (!earliest) return back("notice_not_served");

  const { data: tRow } = await supabase
    .from("tenancies")
    .select("id, rent_cents, deposit_cents, property:properties(address), tenants(name, email, phone, is_primary)")
    .eq("id", params.id)
    .maybeSingle();
  const t = tRow as unknown as {
    rent_cents: number | null;
    deposit_cents: number | null;
    property: { address: string | null } | null;
    tenants: { name: string | null; email: string | null; phone: string | null; is_primary: boolean }[];
  } | null;
  if (!t) return back("notice_not_served");

  const tenants = (t.tenants ?? [])
    .slice()
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
    .filter((x) => (x.name ?? "").trim())
    .map((x) => ({ name: (x.name as string).trim(), email: x.email, phone: x.phone }));

  // N12 (Schedule B) and N13 (Schedule A): earlier N12 / N13 notices on record in
  // the 2 years before filing (any of the org's units; RLS scopes to the org).
  let priorNotices: L2PriorNotice[] = [];
  if (notice.type === "N12" || notice.type === "N13") {
    const twoYearsBack = addDaysISO(filingDateISO, -730);
    const { data: prior } = await supabase
      .from("notices")
      .select("id, type, snapshot, served_at")
      .in("type", ["N12", "N13"])
      .in("status", ["served", "filed"])
      .neq("id", notice.id)
      .gte("served_at", `${twoYearsBack}T00:00:00Z`)
      .order("served_at", { ascending: true })
      .limit(10);
    priorNotices = (prior ?? []).map((p) => {
      const r = p as { type: string; snapshot: NoticeSnap | null; served_at: string };
      const ps = r.snapshot ?? {};
      return {
        dateISO: ps.serviceDateISO ?? r.served_at.slice(0, 10),
        address: (ps.rentalUnitAddress ?? "").trim(),
        intended: priorNoticeIntended(r.type, ps),
      };
    });
  }
  let n12: { reason: 1 | 2; compensationRequired: boolean; compensation: L2N12Compensation; priorNotices: L2PriorNotice[]; priorOutside: boolean } | null = null;
  if (notice.type === "N12") {
    const choice = s("compensation") as L2N12Compensation;
    n12 = {
      reason: snap.reason === 2 ? 2 : 1,
      compensationRequired: snap.compensationRequired !== false,
      compensation: (L2_N12_COMPENSATION as readonly string[]).includes(choice) ? choice : ("" as L2N12Compensation),
      priorNotices,
      priorOutside: s("prior_outside") === "yes",
    };
  }
  let n13: { compensation: L2N13Compensation; orderedUnderAct: boolean; priorNotices: L2PriorNotice[]; priorOutside: boolean; permitsObtained: boolean | null } | null = null;
  if (notice.type === "N13") {
    const choice = s("compensation") as L2N13Compensation;
    const permits = s("permits_obtained");
    n13 = {
      compensation: (L2_N13_COMPENSATION as readonly string[]).includes(choice) ? choice : ("" as L2N13Compensation),
      orderedUnderAct: snap.orderedUnderAct === true,
      priorNotices,
      priorOutside: s("prior_outside") === "yes",
      permitsObtained: permits === "yes" ? true : permits === "no" ? false : null,
    };
  }

  const calc = computeL2({
    noticeType: notice.type,
    noticeStatus: notice.status,
    terminationISO: notice.termination_date,
    earliestFilingISO: earliest,
    filingDateISO,
    method,
    tenantInPossession: s("in_possession") === "yes",
    tenantCount: tenants.length,
    n12,
    n13,
  });
  if (calc.problems.length > 0) return back(calc.problems[0]);
  if (tenants.length === 0) return back("notice_not_served");

  const depositCents = parseAmountToCents(s("deposit_amount")) ?? t.deposit_cents ?? 0;
  const bytes = await fillOfficialL2({
    rentalUnitAddress: t.property?.address ?? snap.rentalUnitAddress ?? null,
    noticeType: notice.type as L2NoticeType,
    terminationISO: notice.termination_date,
    landlord: {
      firstName: s("landlord_first") || null,
      lastName: s("landlord_last") || null,
      company: s("landlord_company") || null,
      email: s("landlord_email") || null,
      phone: s("landlord_phone") || null,
      mailingAddress: s("landlord_address") || null,
      byEmail: s("by_email") === "yes",
    },
    tenants,
    dailyCompensation: s("daily_comp") !== "no",
    rentCents: t.rent_cents,
    deposit:
      depositCents > 0
        ? {
            cents: depositCents,
            collectedISO: parseDateOrNull(s("deposit_date")),
            interestFromISO: parseDateOrNull(s("interest_from")),
            interestToISO: parseDateOrNull(s("interest_to")),
          }
        : null,
    feeCents: calc.feeCents,
    totalCents: calc.totalCents,
    n13: n13 ? { permitsObtained: n13.permitsObtained, compensation: n13.compensation, priorNotices: n13.priorNotices, priorOutside: n13.priorOutside } : null,
    n12: n12 ? { reason: n12.reason, compensation: n12.compensation, priorNotices: n12.priorNotices, priorOutside: n12.priorOutside } : null,
  });

  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="Form-L2-Application-End-Tenancy.pdf"',
      "Cache-Control": "no-store",
    },
  });
}
