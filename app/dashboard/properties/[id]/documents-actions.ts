"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import {
  clampShareDays,
  generateShareToken,
  isDocumentType,
  shareLinkExpiry,
  validateDocumentUpload,
  type DocumentType,
} from "@/lib/documents";
import {
  createUploadedVaultDocument,
  removeDocuments,
} from "@/lib/documents-server";
import { retentionUntil } from "@/lib/document-retention";

function s(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

function propertyPath(id: string): string {
  return `/dashboard/properties/${id}`;
}

const docsAnchor = (id: string, q: string) =>
  `${propertyPath(id)}?docs=${q}#documents`;

async function propertyExistsForOrg(propertyId: string, organizationId: string) {
  const supabase = createClient();
  const { data } = await supabase
    .from("properties")
    .select("id")
    .eq("id", propertyId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  return !!data;
}

export async function uploadPropertyDocument(formData: FormData) {
  const propertyId = s(formData, "property_id");
  if (!propertyId) redirect("/dashboard/properties");
  await requireCapability("manage_tenancies", docsAnchor(propertyId, "forbidden"));

  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");
  const fail = (reason: string) => redirect(docsAnchor(propertyId, reason));

  if (!(await propertyExistsForOrg(propertyId, org.id))) {
    redirect("/dashboard/properties");
  }

  const rawType = s(formData, "doc_type");
  const docType: DocumentType = isDocumentType(rawType) ? rawType : "other";
  const titleOverride = s(formData, "title");
  const fileEntry = formData.get("document");
  if (!(fileEntry instanceof File) || fileEntry.size === 0) fail("none");
  const file = fileEntry as File;

  const check = validateDocumentUpload({ type: file.type, size: file.size });
  if (!check.ok) fail(check.reason);

  const supabase = createClient();
  const result = await createUploadedVaultDocument(supabase, {
    organizationId: org.id,
    file,
    docType,
    title: titleOverride,
    propertyId,
  });
  if (!result.ok) fail("failed");

  revalidatePath(propertyPath(propertyId));
  redirect(docsAnchor(propertyId, "uploaded"));
}

export async function deletePropertyDocument(formData: FormData) {
  const propertyId = s(formData, "property_id");
  const documentId = s(formData, "document_id");
  if (!propertyId) redirect("/dashboard/properties");
  await requireCapability("manage_tenancies", docsAnchor(propertyId, "forbidden"));
  if (!documentId) redirect(docsAnchor(propertyId, "error"));

  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const supabase = createClient();
  const { data: doc } = await supabase
    .from("documents")
    .select("id, storage_path, deleted_at")
    .eq("id", documentId)
    .eq("organization_id", org.id)
    .eq("property_id", propertyId)
    .maybeSingle();
  if (!doc) redirect(docsAnchor(propertyId, "error"));
  const d = doc as { id: string; storage_path: string; deleted_at: string | null };

  const nowIso = new Date().toISOString();
  await supabase
    .from("documents")
    .update({
      deleted_at: nowIso,
      retention_until: retentionUntil(nowIso),
      updated_at: nowIso,
    })
    .eq("id", documentId)
    .eq("property_id", propertyId)
    .is("deleted_at", null);

  await supabase
    .from("document_share_links")
    .update({ revoked_at: nowIso })
    .eq("document_id", documentId)
    .eq("organization_id", org.id)
    .is("revoked_at", null);

  await removeDocuments(supabase, [d.storage_path]);

  revalidatePath(propertyPath(propertyId));
  redirect(docsAnchor(propertyId, "deleted"));
}

export async function createPropertyDocumentShareLink(formData: FormData) {
  const propertyId = s(formData, "property_id");
  const documentId = s(formData, "document_id");
  if (!propertyId) redirect("/dashboard/properties");
  await requireCapability("manage_tenancies", docsAnchor(propertyId, "forbidden"));
  if (!documentId) redirect(docsAnchor(propertyId, "error"));

  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const days = clampShareDays(s(formData, "days"));
  const supabase = createClient();
  const { data: doc } = await supabase
    .from("documents")
    .select("id")
    .eq("id", documentId)
    .eq("organization_id", org.id)
    .eq("property_id", propertyId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!doc) redirect(docsAnchor(propertyId, "error"));

  const { error } = await supabase.from("document_share_links").insert({
    organization_id: org.id,
    document_id: documentId,
    token: generateShareToken(),
    expires_at: shareLinkExpiry(new Date(), days),
  });
  if (error) redirect(docsAnchor(propertyId, "shareerr"));

  revalidatePath(propertyPath(propertyId));
  redirect(docsAnchor(propertyId, "shared"));
}

export async function revokePropertyDocumentShareLink(formData: FormData) {
  const propertyId = s(formData, "property_id");
  const linkId = s(formData, "link_id");
  if (!propertyId) redirect("/dashboard/properties");
  await requireCapability("manage_tenancies", docsAnchor(propertyId, "forbidden"));
  if (!linkId) redirect(docsAnchor(propertyId, "error"));

  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const supabase = createClient();
  const { data: share } = await supabase
    .from("document_share_links")
    .select("id, document_id")
    .eq("id", linkId)
    .eq("organization_id", org.id)
    .maybeSingle();
  const shareRow = share as { id: string; document_id: string } | null;
  if (!shareRow) redirect(docsAnchor(propertyId, "error"));

  const { data: doc } = await supabase
    .from("documents")
    .select("id")
    .eq("id", shareRow.document_id)
    .eq("organization_id", org.id)
    .eq("property_id", propertyId)
    .maybeSingle();
  if (!doc) redirect(docsAnchor(propertyId, "error"));

  await supabase
    .from("document_share_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", linkId)
    .eq("organization_id", org.id)
    .is("revoked_at", null);

  revalidatePath(propertyPath(propertyId));
  redirect(docsAnchor(propertyId, "revoked"));
}
