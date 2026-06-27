"use server";

import { createHash } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import {
  validateDocumentUpload,
  isDocumentType,
  documentStoragePath,
  defaultTitleFromFilename,
  extForType,
  generateShareToken,
  shareLinkExpiry,
  clampShareDays,
  MAX_DOCUMENTS_PER_UPLOAD,
  type DocumentType,
} from "@/lib/documents";
import { DOCUMENTS_BUCKET, removeDocuments } from "@/lib/documents-server";
import { retentionUntil } from "@/lib/document-retention";
import { resolvePersonId } from "@/lib/persons-server";
import { normalizePhoneE164 } from "@/lib/sms";

// Document-vault server actions (DOCUMENT-VAULT-DESIGN-2026-06-26.md, Slices
// 1+2). Upload / soft-delete a stored document, and mint / revoke a tokenized
// read-only share link. All guarded on manage_tenancies (documents hang off a
// tenancy) and redirect-based, surfacing outcome via ?docs=… on the tenancy
// page (#documents anchor). Files ride a server action as multipart FormData;
// the bucket + storage RLS (migration 0076) are the backstop and each file is
// validated against lib/documents before it touches Storage.

function s(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

function tenancyPath(id: string): string {
  return `/dashboard/tenancies/${id}`;
}

const docsAnchor = (id: string, q: string) =>
  `${tenancyPath(id)}?docs=${q}#documents`;

// ---------------------------------------------------------------------------
// Upload one or more documents to the private vault for a tenancy.
// ---------------------------------------------------------------------------
export async function uploadTenancyDocuments(formData: FormData) {
  const tenancyId = s(formData, "tenancy_id");
  if (!tenancyId) redirect("/dashboard/tenancies");
  await requireCapability("manage_tenancies", `${docsAnchor(tenancyId, "forbidden")}`);

  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const fail = (reason: string) => redirect(docsAnchor(tenancyId, reason));

  const rawType = s(formData, "doc_type");
  const docType: DocumentType = isDocumentType(rawType) ? rawType : "other";
  const titleOverride = s(formData, "title");

  // Browser File objects arrive as FormData entries named "documents".
  const files = formData
    .getAll("documents")
    .filter(
      (f): f is File =>
        typeof f === "object" && f !== null && "size" in f && "type" in f,
    )
    .filter((f) => f.size > 0); // empty file input yields a 0-byte entry

  if (files.length === 0) fail("none");
  if (files.length > MAX_DOCUMENTS_PER_UPLOAD) fail("toomany");

  // Reject the whole batch on the first bad file so the operator re-picks with a
  // clear message rather than a confusing partial upload.
  for (const f of files) {
    const v = validateDocumentUpload({ type: f.type, size: f.size });
    if (!v.ok) fail(v.reason);
  }

  const supabase = createClient();

  // Confirm the tenancy belongs to this org (RLS scopes the read) before we
  // attach documents to it.
  const { data: tRow } = await supabase
    .from("tenancies")
    .select("id")
    .eq("id", tenancyId)
    .maybeSingle();
  if (!tRow) redirect("/dashboard/tenancies");

  // Optional cross-tenancy filing: the operator can attribute this upload to one
  // of the tenancy's tenants (e.g. an ID/application package about a specific
  // person). We store the resolved person_id on the document so the Slice 3
  // person vault can surface it across that person's tenancies. Default = none
  // (the document is still reached via its tenancy). A tenant already carries a
  // person_id (0042); if not, resolve/create one so the link is always durable.
  let personId: string | null = null;
  const aboutTenantId = s(formData, "about_tenant_id");
  if (aboutTenantId) {
    const { data: tenant } = await supabase
      .from("tenants")
      .select("id, name, email, phone, person_id")
      .eq("id", aboutTenantId)
      .eq("tenancy_id", tenancyId)
      .maybeSingle();
    if (tenant) {
      const tn = tenant as {
        name: string | null;
        email: string | null;
        phone: string | null;
        person_id: string | null;
      };
      personId =
        tn.person_id ??
        (await resolvePersonId(supabase, org.id, {
          name: tn.name,
          email: tn.email,
          phone: tn.phone,
          phone_e164: normalizePhoneE164(tn.phone),
        }));
    }
  }

  let uploaded = 0;
  const singleTitle = files.length === 1 && titleOverride ? titleOverride : null;

  for (const file of files) {
    const docId = crypto.randomUUID();
    const path = documentStoragePath(org.id, docId, extForType(file.type));

    const { error: upErr } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) continue; // best-effort: skip a failed file, keep going

    // Tamper-evidence hash of the stored bytes (hex SHA-256). Best-effort —
    // a hash failure must not drop the upload.
    let sha256: string | null = null;
    try {
      const buf = Buffer.from(await file.arrayBuffer());
      sha256 = createHash("sha256").update(buf).digest("hex");
    } catch {
      sha256 = null;
    }

    const { error: insErr } = await supabase.from("documents").insert({
      id: docId,
      organization_id: org.id,
      tenancy_id: tenancyId,
      person_id: personId,
      title: singleTitle ?? defaultTitleFromFilename(file.name),
      doc_type: docType,
      storage_path: path,
      mime_type: file.type,
      size_bytes: file.size,
      sha256,
      source: "uploaded",
    });
    if (insErr) {
      // Roll back the orphaned object so Storage and the table stay in sync.
      const { error: rbErr } = await supabase.storage
        .from(DOCUMENTS_BUCKET)
        .remove([path]);
      if (rbErr) {
        console.error("uploadTenancyDocuments: rollback remove failed", {
          path,
          error: rbErr.message,
        });
      }
      continue;
    }
    uploaded += 1;
  }

  revalidatePath(tenancyPath(tenancyId));
  if (uploaded === 0) redirect(docsAnchor(tenancyId, "failed"));
  redirect(docsAnchor(tenancyId, `uploaded:${uploaded}`));
}

// ---------------------------------------------------------------------------
// File a printed PDF of an in-app EXECUTED lease into the vault (Option C /
// Slice 4b). The operator opens the executed lease's render route, Prints →
// Save as PDF (byte-identical to what they reviewed + signed), and files that
// PDF here. We store it as a documents row with source='in_app_executed' +
// lease_document_id, so it surfaces folded into the lease's "Signed in app"
// vault entry and becomes downloadable + shareable via /d/[token] like any
// uploaded file. PDF only (this is an executed artifact, not a scan). Mirrors
// uploadTenancyDocuments' storage + rollback handling.
// ---------------------------------------------------------------------------
export async function fileExecutedLeasePdf(formData: FormData) {
  const tenancyId = s(formData, "tenancy_id");
  if (!tenancyId) redirect("/dashboard/tenancies");
  await requireCapability("manage_tenancies", docsAnchor(tenancyId, "forbidden"));

  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const leaseId = s(formData, "lease_id");
  const fail = (reason: string) => redirect(docsAnchor(tenancyId, reason));
  if (!leaseId) fail("error");

  // Exactly one PDF (the executed-lease print). Reject images here — unlike the
  // general uploader, this slot is the executed lease artifact.
  const file = formData
    .getAll("document")
    .find(
      (f): f is File =>
        typeof f === "object" &&
        f !== null &&
        "size" in f &&
        "type" in f &&
        (f as File).size > 0,
    );
  if (!file) fail("none");
  const theFile = file as File;
  if (theFile.type !== "application/pdf") fail("type");
  const v = validateDocumentUpload({ type: theFile.type, size: theFile.size });
  if (!v.ok) fail(v.reason);

  const supabase = createClient();

  // The lease must exist, belong to this tenancy (and this org via RLS), and be
  // EXECUTED — we only store the final signed artifact, never a draft/sent one.
  const { data: leaseRow } = await supabase
    .from("lease_documents")
    .select("id, tenancy_id, title, status")
    .eq("id", leaseId)
    .eq("tenancy_id", tenancyId)
    .maybeSingle();
  if (!leaseRow) fail("error");
  const lease = leaseRow as { id: string; title: string; status: string };
  if (lease.status !== "executed") fail("notexecuted");

  // Best-effort: file the PDF about the primary tenant too, so it also surfaces
  // on that person's vault page (Slice 3b). A tenant already carries a person_id
  // (0042); if not, leave null rather than minting one here.
  let personId: string | null = null;
  const { data: primary } = await supabase
    .from("tenants")
    .select("person_id")
    .eq("tenancy_id", tenancyId)
    .eq("is_primary", true)
    .maybeSingle();
  if (primary) personId = (primary as { person_id: string | null }).person_id ?? null;

  const docId = crypto.randomUUID();
  const path = documentStoragePath(org.id, docId, "pdf");

  const { error: upErr } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(path, theFile, { contentType: "application/pdf", upsert: false });
  if (upErr) fail("failed");

  let sha256: string | null = null;
  try {
    sha256 = createHash("sha256")
      .update(Buffer.from(await theFile.arrayBuffer()))
      .digest("hex");
  } catch {
    sha256 = null;
  }

  const { error: insErr } = await supabase.from("documents").insert({
    id: docId,
    organization_id: org.id,
    tenancy_id: tenancyId,
    person_id: personId,
    lease_document_id: lease.id,
    title: lease.title || "Executed lease",
    doc_type: "lease",
    storage_path: path,
    mime_type: "application/pdf",
    size_bytes: theFile.size,
    sha256,
    source: "in_app_executed",
  });
  if (insErr) {
    // Roll back the orphaned object so Storage and the table stay in sync.
    const { error: rbErr } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .remove([path]);
    if (rbErr) {
      console.error("fileExecutedLeasePdf: rollback remove failed", {
        path,
        error: rbErr.message,
      });
    }
    fail("failed");
  }

  revalidatePath(tenancyPath(tenancyId));
  redirect(docsAnchor(tenancyId, "filed"));
}

// ---------------------------------------------------------------------------
// Soft-delete a document (keeps the row + audit trail; a later retention cron
// hard-deletes the bytes). We ALSO remove the stored object now so the bytes
// don't linger — soft-delete preserves the metadata record, not the file.
// ---------------------------------------------------------------------------
export async function deleteTenancyDocument(formData: FormData) {
  const tenancyId = s(formData, "tenancy_id");
  const documentId = s(formData, "document_id");
  if (!tenancyId) redirect("/dashboard/tenancies");
  await requireCapability("manage_tenancies", docsAnchor(tenancyId, "forbidden"));
  if (!documentId) redirect(docsAnchor(tenancyId, "error"));

  const supabase = createClient();
  const { data: doc } = await supabase
    .from("documents")
    .select("id, storage_path, deleted_at")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc) redirect(docsAnchor(tenancyId, "error"));
  const d = doc as { id: string; storage_path: string; deleted_at: string | null };

  // Stamp soft-delete (idempotent) and revoke any live share links so a
  // deleted document can't keep being viewed by an outstanding link. We also set
  // retention_until = now + grace so the document-retention purge cron has an
  // explicit anchor at which to permanently hard-delete the row (the bytes are
  // removed below). Guarded on deleted_at IS NULL so a re-delete can't slide the
  // retention window forward.
  const nowIso = new Date().toISOString();
  await supabase
    .from("documents")
    .update({
      deleted_at: nowIso,
      retention_until: retentionUntil(nowIso),
      updated_at: nowIso,
    })
    .eq("id", documentId)
    .is("deleted_at", null);

  await supabase
    .from("document_share_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("document_id", documentId)
    .is("revoked_at", null);

  // Remove the bytes from the private bucket (RLS DELETE+SELECT scope it).
  await removeDocuments(supabase, [d.storage_path]);

  revalidatePath(tenancyPath(tenancyId));
  redirect(docsAnchor(tenancyId, "deleted"));
}

// ---------------------------------------------------------------------------
// Mint an expiring, revocable read-only share link for a document.
// ---------------------------------------------------------------------------
export async function createDocumentShareLink(formData: FormData) {
  const tenancyId = s(formData, "tenancy_id");
  const documentId = s(formData, "document_id");
  if (!tenancyId) redirect("/dashboard/tenancies");
  await requireCapability("manage_tenancies", docsAnchor(tenancyId, "forbidden"));
  if (!documentId) redirect(docsAnchor(tenancyId, "error"));

  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const days = clampShareDays(s(formData, "days"));

  const supabase = createClient();
  // Re-confirm the document belongs to this org + is not deleted (RLS scopes the
  // read, but we also block sharing a soft-deleted doc).
  const { data: doc } = await supabase
    .from("documents")
    .select("id, deleted_at")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc || (doc as { deleted_at: string | null }).deleted_at) {
    redirect(docsAnchor(tenancyId, "error"));
  }

  const { error } = await supabase.from("document_share_links").insert({
    organization_id: org.id,
    document_id: documentId,
    token: generateShareToken(),
    expires_at: shareLinkExpiry(new Date(), days),
  });
  if (error) redirect(docsAnchor(tenancyId, "shareerr"));

  revalidatePath(tenancyPath(tenancyId));
  redirect(docsAnchor(tenancyId, "shared"));
}

// ---------------------------------------------------------------------------
// Revoke a share link (immediately stops the /d/[token] viewer).
// ---------------------------------------------------------------------------
export async function revokeDocumentShareLink(formData: FormData) {
  const tenancyId = s(formData, "tenancy_id");
  const linkId = s(formData, "link_id");
  if (!tenancyId) redirect("/dashboard/tenancies");
  await requireCapability("manage_tenancies", docsAnchor(tenancyId, "forbidden"));
  if (!linkId) redirect(docsAnchor(tenancyId, "error"));

  const supabase = createClient();
  await supabase
    .from("document_share_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", linkId)
    .is("revoked_at", null);

  revalidatePath(tenancyPath(tenancyId));
  redirect(docsAnchor(tenancyId, "revoked"));
}
