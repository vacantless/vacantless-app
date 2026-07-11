import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { currentUserCan } from "@/lib/membership";
import { canUseRentalApplications } from "@/lib/billing";
import {
  buildApplicationSummaryModel,
  renderApplicationSummaryHtml,
} from "@/lib/rental-application-summary";

export const dynamic = "force-dynamic";

// Render a SUBMITTED rental application's NON-SENSITIVE summary as a standalone,
// print-optimized HTML document (S456, Slice 1b). The operator opens it in a new
// tab from the lead-detail "Rental application" card, reviews it, and Prints ->
// Saves as PDF, then files that PDF into the document vault via fileApplicationPdf.
//
// Mirrors the rent-receipt / N1 print routes: read-only; guarded on manage_leads
// + the `applications` entitlement; RLS scopes every query to the caller's org.
// MODEL B holds — the summary is built only from the stored non-sensitive
// form_data, never from SIN/DOB/banking (which are never captured or stored).

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const org = await getCurrentOrg();
  if (!org) return NextResponse.redirect(new URL("/login", req.url));

  if (!(await currentUserCan("manage_leads"))) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  // Server-side entitlement gate (never UI-only) — mirrors requestRentalApplication.
  if (!canUseRentalApplications(org.plan)) {
    return new NextResponse("Rental applications are a Growth feature.", { status: 403 });
  }

  const supabase = createClient();

  // The latest non-declined application for this lead (RLS scopes to org). One is
  // open at a time (requestRentalApplication guards duplicates).
  const { data: appRow } = await supabase
    .from("rental_applications")
    .select(
      "id, status, pay_mode, applicant_name, applicant_email, applicant_phone, submitted_at, form_data, property:properties(address)",
    )
    .eq("lead_id", params.id)
    .neq("status", "declined")
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!appRow) return new NextResponse("Application not found", { status: 404 });

  const app = appRow as unknown as {
    status: string;
    pay_mode: string;
    applicant_name: string | null;
    applicant_email: string | null;
    applicant_phone: string | null;
    submitted_at: string | null;
    form_data: Record<string, unknown> | null;
    property: { address: string | null } | null;
  };

  // Only a submitted (or beyond) application has a summary worth printing.
  if (app.status === "requested") {
    return new NextResponse("The applicant has not submitted this application yet.", {
      status: 409,
    });
  }

  const orgContact = [org.public_contact_email, org.public_contact_phone]
    .map((s) => (s && String(s).trim() ? String(s).trim() : null))
    .filter((s): s is string => s != null)
    .join(" · ") || null;

  const model = buildApplicationSummaryModel({
    orgName: org.name,
    brandColor: org.brand_color ?? null,
    logoUrl: org.logo_url ?? null,
    orgContact,
    applicantName: app.applicant_name,
    applicantEmail: app.applicant_email,
    applicantPhone: app.applicant_phone,
    propertyAddress: app.property?.address ?? null,
    payMode: app.pay_mode,
    submittedAtIso: app.submitted_at,
    formData: app.form_data,
    generatedAtIso: new Date().toISOString(),
  });

  return new NextResponse(renderApplicationSummaryHtml(model), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
