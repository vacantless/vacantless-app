import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatRentCents } from "@/lib/tenancy";
import { deriveRentIncrease } from "@/lib/rent-increase";
import { loadGuidelineLookup } from "@/lib/guideline-server";
import {
  renderN1Html,
  n1ModelFromSnapshot,
  type N1RenderModel,
  type N1Snapshot,
} from "@/lib/n1-render";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Public, view-only Form N1 for the TENANT (renewal autopilot Slice B, S460).
// The tenant opens this from the served email; they have NO session — the
// per-tenancy n1_service_token (migration 0132) is the only handle. Read by the
// service-role admin client, scoped strictly to the tenancy whose
// n1_service_token matches; a wrong token reveals nothing. Renders the SAME
// deriveRentIncrease-backed N1 the operator reviewed, so the served copy and the
// operator's copy never drift. Read-only (GET) — there is no action here.

export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } },
) {
  const admin = createAdminClient();
  if (!admin) return new NextResponse("Not found", { status: 404 });

  const { data } = await admin
    .from("tenancies")
    .select(
      "status, rent_cents, start_date, n1_effective_date, n1_served_at, n1_snapshot, " +
        "property:properties(address, rent_control_exempt), " +
        "tenants(name, is_primary), " +
        "organization:organizations(name, public_contact_phone, public_contact_email)",
    )
    .eq("n1_service_token", params.token)
    .maybeSingle();
  if (!data) return new NextResponse("Not found", { status: 404 });

  const t = data as unknown as {
    status: string;
    rent_cents: number | null;
    start_date: string | null;
    n1_effective_date: string | null;
    n1_served_at: string | null;
    n1_snapshot: N1Snapshot | null;
    property: { address: string | null; rent_control_exempt: boolean | null } | null;
    tenants: { name: string | null; is_primary: boolean }[];
    organization: {
      name: string | null;
      public_contact_phone: string | null;
      public_contact_email: string | null;
    } | null;
  };

  // Codex P1b fix: render the IMMUTABLE snapshot frozen at serve time. This is
  // the notice the tenant was actually served; it must not drift when rent_cents
  // / start_date / today / the guideline table change afterward.
  if (t.n1_snapshot) {
    const snapModel = {
      ...n1ModelFromSnapshot(t.n1_snapshot),
      officialPdfUrl: `/n1/${params.token}/official`,
    };
    return new NextResponse(renderN1Html(snapModel), {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  // S467 (Codex P1): the immutable snapshot IS the served copy (S460b). Only
  // fall through to the legacy no-snapshot derive for notices that were ACTUALLY
  // served before the snapshot feature - every tenancy carries a default
  // n1_service_token, so an UNSERVED tenancy must never surface a tenant-facing
  // notice from its default token.
  if (!t.n1_served_at) {
    return new NextResponse("Not found", { status: 404 });
  }

  if (t.status !== "active" || t.rent_cents == null || !t.start_date) {
    return new NextResponse("This notice is no longer available.", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const todayOntario = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Toronto",
  });
  const guideline = await loadGuidelineLookup(admin);
  const result = deriveRentIncrease(
    {
      startDate: t.start_date,
      currentRentCents: t.rent_cents,
      exempt: t.property?.rent_control_exempt === true,
      guideline,
    },
    todayOntario,
  );
  if (!result || result.newRentCents == null) {
    return new NextResponse("Could not render this notice.", { status: 400 });
  }

  const tenantNames = (t.tenants ?? [])
    .slice()
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
    .map((x) => (x.name ?? "").trim())
    .filter((n) => n.length > 0);

  const model: N1RenderModel = {
    landlordName: t.organization?.name ?? "",
    landlordPhone: t.organization?.public_contact_phone ?? null,
    landlordEmail: t.organization?.public_contact_email ?? null,
    tenantNames,
    rentalUnitAddress: t.property?.address ?? null,
    currentRent: formatRentCents(result.currentRentCents),
    newRent: result.newRentCents != null ? formatRentCents(result.newRentCents) : null,
    increaseAmount:
      result.increaseCents != null ? formatRentCents(result.increaseCents) : null,
    guidelinePercent: result.guidelinePercent,
    // Prefer the operator's recorded effective date; fall back to the derived one.
    effectiveDate: t.n1_effective_date ?? result.effectiveDate,
    serveByDate: result.serveByDate,
    exempt: result.exempt,
    generatedAtIso: new Date().toISOString(),
  };

  return new NextResponse(renderN1Html(model), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
