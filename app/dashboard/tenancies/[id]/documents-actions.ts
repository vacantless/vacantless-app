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
  // deleted document can't keep being viewed by an outstanding link.
  await supabase
    .from("documents")
    .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
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
