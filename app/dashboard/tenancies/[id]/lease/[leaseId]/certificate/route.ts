import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { currentUserCan } from "@/lib/membership";
import {
  renderAuditCertificateHtml,
  type AuditCertificateModel,
  type AuditSigner,
} from "@/lib/lease-signing";
import type { LeaseRenderModel } from "@/lib/lease-render";

export const dynamic = "force-dynamic";

// The ECA-2000 certificate of completion for a signed lease (lease vault #11,
// slice 4). Read-only operator surface: who signed, when, from where, and
// against which document hash — the binding audit record. Guarded on
// manage_tenancies; RLS scopes every query to the caller's org. Printable HTML
// (Print → Save as PDF), the same artifact strategy as the lease render route.

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

  const { data: leaseRow } = await supabase
    .from("lease_documents")
    .select(
      "id, tenancy_id, title, status, document_hash, sent_at, executed_at, rendered_snapshot",
    )
    .eq("id", params.leaseId)
    .eq("tenancy_id", params.id)
    .maybeSingle();
  if (!leaseRow) return new NextResponse("Lease not found", { status: 404 });
  const lease = leaseRow as unknown as {
    title: string;
    status: string;
    document_hash: string | null;
    sent_at: string | null;
    executed_at: string | null;
    rendered_snapshot: LeaseRenderModel | null;
  };

  const { data: signerRows } = await supabase
    .from("lease_signers")
    .select(
      "role, name, email, signed_name, status, signature_kind, signed_at, signer_ip, user_agent, document_hash, sign_order",
    )
    .eq("lease_document_id", params.leaseId)
    .order("sign_order", { ascending: true });

  const signers: AuditSigner[] = ((signerRows ?? []) as Record<string, unknown>[]).map(
    (r) => ({
      role: String(r.role ?? ""),
      name: (r.name as string | null) ?? null,
      email: (r.email as string | null) ?? null,
      signedName: (r.signed_name as string | null) ?? null,
      status: String(r.status ?? ""),
      signatureKind: (r.signature_kind as string | null) ?? null,
      signedAtIso: (r.signed_at as string | null) ?? null,
      signerIp: (r.signer_ip as string | null) ?? null,
      userAgent: (r.user_agent as string | null) ?? null,
      documentHash: (r.document_hash as string | null) ?? null,
    }),
  );

  const model: AuditCertificateModel = {
    leaseTitle: lease.title,
    propertyAddress: lease.rendered_snapshot?.propertyAddress ?? null,
    orgName: org.name,
    leaseStatus: lease.status,
    documentHash: lease.document_hash,
    sentAtIso: lease.sent_at,
    executedAtIso: lease.executed_at,
    signers,
  };

  return new NextResponse(renderAuditCertificateHtml(model), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
