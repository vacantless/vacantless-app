import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { currentUserCan } from "@/lib/membership";
import { formatRentCents } from "@/lib/tenancy";
import {
  renderLeaseDocumentHtml,
  type LeaseRenderModel,
  type CapturedSignature,
} from "@/lib/lease-render";

export const dynamic = "force-dynamic";

// Render a generated lease as a standalone, print-optimized HTML document (lease
// vault #11, slice 3 render-before-sign + slice 5 stamp-the-signatures). The
// operator opens this in a new tab and Prints → Save as PDF. Read-only; guarded
// on manage_tenancies; RLS also scopes every query to the caller's org.
//
// Two render paths:
//   * DRAFT — header fields (parties / rent / term) read from the LIVE tenancy
//     (faithful while the draft is still editable). Blank signature lines.
//   * SENT / EXECUTED — render from lease_documents.rendered_snapshot, the model
//     FROZEN at send time, so the printed lease shows EXACTLY the bytes that were
//     hashed + signed (never live tenancy fields that could have changed since).
//     Captured signatures from lease_signers are stamped onto each party's line
//     (slice 5). The certificate of completion remains the binding audit record;
//     this makes the lease itself show who signed.

// A lease_signers row, as needed to stamp + order signatures.
type SignerRow = {
  role: string;
  sign_order: number;
  name: string | null;
  status: string;
  signature_kind: string | null;
  signature_data: string | null;
  signed_name: string | null;
  signed_at: string | null;
};

function toCaptured(s: SignerRow): CapturedSignature {
  return {
    signatureKind: s.signature_kind,
    signatureData: s.signature_data,
    signedName: s.signed_name,
    signedAtIso: s.signed_at,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; leaseId: string } },
) {
  const org = await getCurrentOrg();
  if (!org) return NextResponse.redirect(new URL("/login", req.url));

  if (!(await currentUserCan("manage_tenancies"))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const supabase = createClient();

  // The lease draft (RLS scopes to this org; the tenancy_id check ties it to the
  // tenancy in the URL so a mismatched pair 404s rather than rendering).
  const { data: leaseRow } = await supabase
    .from("lease_documents")
    .select(
      "id, tenancy_id, title, status, assembled_body, created_at, rendered_snapshot",
    )
    .eq("id", params.leaseId)
    .eq("tenancy_id", params.id)
    .maybeSingle();
  if (!leaseRow) return new NextResponse("Lease not found", { status: 404 });
  const lease = leaseRow as unknown as {
    id: string;
    tenancy_id: string;
    title: string;
    status: string;
    assembled_body: string | null;
    created_at: string;
    rendered_snapshot: LeaseRenderModel | null;
  };

  // SENT / EXECUTED path: render from the FROZEN snapshot + stamp signatures, so
  // the printed lease matches the hashed/signed bytes and shows who signed.
  if (lease.status !== "draft" && lease.rendered_snapshot) {
    const { data: signerRows } = await supabase
      .from("lease_signers")
      .select(
        "role, sign_order, name, status, signature_kind, signature_data, signed_name, signed_at",
      )
      .eq("lease_document_id", lease.id)
      .order("sign_order", { ascending: true });
    const signers = (signerRows ?? []) as unknown as SignerRow[];

    const landlordSigner = signers.find(
      (s) => s.role === "landlord" && s.status === "signed",
    );

    // Align tenant signers to the snapshot's tenantNames: prefer a name match,
    // else consume the next remaining tenant signer in sign_order. A slot only
    // gets a stamp if that signer has actually signed (else null = blank line).
    const snapshot = lease.rendered_snapshot;
    const tenantPool = signers.filter((s) => s.role === "tenant");
    const tenantSignatures: (CapturedSignature | null)[] = (
      snapshot.tenantNames ?? []
    ).map((nm) => {
      const norm = nm.trim().toLowerCase();
      let idx = tenantPool.findIndex(
        (s) => (s.name ?? "").trim().toLowerCase() === norm,
      );
      if (idx === -1) idx = tenantPool.length ? 0 : -1;
      if (idx === -1) return null;
      const [s] = tenantPool.splice(idx, 1);
      return s.status === "signed" ? toCaptured(s) : null;
    });

    const model: LeaseRenderModel = {
      ...snapshot,
      // Reflect the live lease status (snapshot was frozen as "sent").
      status: lease.status,
      landlordSignature: landlordSigner ? toCaptured(landlordSigner) : null,
      tenantSignatures,
    };

    return new NextResponse(renderLeaseDocumentHtml(model), {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  // DRAFT path: the tenancy supplies the live structured header (premises /
  // parties / economics). No signers yet, so signature lines stay blank.
  const { data: tenancyRow } = await supabase
    .from("tenancies")
    .select(
      "id, rent_cents, deposit_cents, start_date, end_date, term_months, property:properties(address), tenants(name, is_primary)",
    )
    .eq("id", params.id)
    .maybeSingle();
  if (!tenancyRow) return new NextResponse("Tenancy not found", { status: 404 });
  const tenancy = tenancyRow as unknown as {
    rent_cents: number | null;
    deposit_cents: number | null;
    start_date: string | null;
    end_date: string | null;
    term_months: number | null;
    property: { address: string } | null;
    tenants: { name: string | null; is_primary: boolean }[];
  };

  // Primary tenant first, then co-tenants; drop the unnamed.
  const tenantNames = (tenancy.tenants ?? [])
    .slice()
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
    .map((t) => (t.name ?? "").trim())
    .filter((n) => n.length > 0);

  const model: LeaseRenderModel = {
    title: lease.title,
    status: lease.status,
    generatedAtIso: lease.created_at,
    landlordName: org.name,
    propertyAddress: tenancy.property?.address ?? null,
    tenantNames,
    rent: tenancy.rent_cents != null ? formatRentCents(tenancy.rent_cents) : null,
    deposit: tenancy.deposit_cents != null ? formatRentCents(tenancy.deposit_cents) : null,
    startDate: tenancy.start_date,
    endDate: tenancy.end_date,
    termMonths: tenancy.term_months,
    clauseBody: lease.assembled_body ?? "",
  };

  return new NextResponse(renderLeaseDocumentHtml(model), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
