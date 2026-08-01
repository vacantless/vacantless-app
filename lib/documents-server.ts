// Server-side signed-URL helpers for the PRIVATE documents bucket (the document
// vault — DOCUMENT-VAULT-DESIGN-2026-06-26.md, Slices 1+2).
//
// The documents bucket (migration 0076) is private — there is no public CDN URL.
// Every read goes through a short-lived SIGNED URL minted here, server-side.
// Centralizing the bucket name + the TTL in one module keeps the operator list
// view (RLS client) and the public /d/[token] share viewer (service-role client,
// after the token is validated) consistent, and makes the privacy boundary one
// edit to audit. Mirrors lib/incident-media-server.ts.
//
// Client-agnostic by design: pass whichever Supabase client matches the caller's
// authorization context —
//   * the RLS server client (lib/supabase/server) for an OPERATOR minting a URL
//     for a document in their own org (the 0076 SELECT policy scopes it), or
//   * the service-role admin client (lib/supabase/admin) for the /d/[token]
//     viewer acting on behalf of an account-less recipient, AFTER the share
//     token is validated and the document's org/path are re-derived server-side.
//     service_role bypasses RLS, so the caller owns that re-validation
//     (feedback_anon_rpc_revalidate_server_side).
//
// This module never decides WHO may see a path — it only mints/removes once the
// caller has established authorization. No Next imports; only the storage seam.

import { createHash, randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  defaultTitleFromFilename,
  documentStoragePath,
  extForType,
  type DocumentType,
} from "@/lib/documents";

// The private bucket id — MUST match migration 0076 + documentStoragePath in
// lib/documents.ts.
export const DOCUMENTS_BUCKET = "documents";

// How long a download/preview signed URL stays valid. Short by default: these
// are sensitive legal documents, and a fresh URL is cheap to mint on each page
// load. 1 hour covers a dashboard view or a share-page session without leaving a
// long-lived link in logs/history.
export const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

// Minimal structural shape — only the storage seam is used, so this accepts both
// the RLS server client and the service-role admin client without coupling to
// the Database generic.
type StorageCapable = Pick<SupabaseClient, "storage">;

export type SignedUrl = { ok: true; signedUrl: string };
export type SignedUrlError = { ok: false; error: string };

/**
 * Mint a short-lived signed DOWNLOAD/preview url for one document object. Use the
 * client whose authorization matches the viewer (RLS server client for an
 * operator; admin client after a token check for the public share page).
 */
export async function createDocumentDownloadUrl(
  client: StorageCapable,
  path: string,
  expiresInSeconds: number = SIGNED_URL_TTL_SECONDS,
): Promise<SignedUrl | SignedUrlError> {
  const { data, error } = await client.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not create signed URL." };
  }
  return { ok: true, signedUrl: data.signedUrl };
}

export type SignedUrlForPath = { path: string; signedUrl: string | null };

/**
 * Mint signed download urls for MANY documents in one round-trip (a tenancy's
 * document list). Returns one entry per requested path, in order; a per-object
 * failure surfaces as a null signedUrl rather than failing the whole batch.
 */
export async function createDocumentDownloadUrls(
  client: StorageCapable,
  paths: string[],
  expiresInSeconds: number = SIGNED_URL_TTL_SECONDS,
): Promise<{ ok: true; urls: SignedUrlForPath[] } | SignedUrlError> {
  if (paths.length === 0) return { ok: true, urls: [] };
  const { data, error } = await client.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrls(paths, expiresInSeconds);
  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not create signed URLs." };
  }
  const urls: SignedUrlForPath[] = data.map((d) => ({
    path: d.path ?? "",
    signedUrl: d.error ? null : (d.signedUrl ?? null),
  }));
  return { ok: true, urls };
}

/**
 * Remove stored objects (e.g. when a document is hard-deleted). The caller's
 * client authorization governs which objects it can touch (the RLS DELETE +
 * SELECT policies for an operator; service_role bypasses). Returns ok even if an
 * object was already gone.
 */
export async function removeDocuments(
  client: StorageCapable,
  paths: string[],
): Promise<{ ok: true } | SignedUrlError> {
  if (paths.length === 0) return { ok: true };
  const { error } = await client.storage.from(DOCUMENTS_BUCKET).remove(paths);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export type VaultUploadFile = {
  name?: string;
  type: string;
  size: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

export type VaultDocumentCreateInput = {
  organizationId: string;
  file: VaultUploadFile;
  docType: DocumentType;
  title?: string | null;
  tenancyId?: string | null;
  personId?: string | null;
  leaseDocumentId?: string | null;
  workOrderId?: string | null;
  propertyId?: string | null;
  source?: "uploaded" | "in_app_executed";
};

export type VaultDocumentCreateResult =
  | { ok: true; documentId: string; storagePath: string; title: string }
  | { ok: false; error: string };

export type VaultDocumentRow = {
  id: string;
  title: string;
  doc_type: string;
  size_bytes: number;
  storage_path: string;
  mime_type: string;
  created_at: string;
  tenancy_id: string | null;
  property_id: string | null;
  work_order_id: string | null;
  source: string | null;
  lease_document_id: string | null;
};

const VAULT_DOCUMENT_COLUMNS =
  "id, title, doc_type, size_bytes, storage_path, mime_type, created_at, tenancy_id, property_id, work_order_id, source, lease_document_id";

export async function createUploadedVaultDocument(
  client: SupabaseClient,
  input: VaultDocumentCreateInput,
): Promise<VaultDocumentCreateResult> {
  const documentId = randomUUID();
  const title =
    input.title?.trim() ||
    defaultTitleFromFilename(input.file.name) ||
    "Document";
  const storagePath = documentStoragePath(
    input.organizationId,
    documentId,
    extForType(input.file.type),
  );

  let bytes: Buffer;
  try {
    bytes = Buffer.from(await input.file.arrayBuffer());
  } catch {
    return { ok: false, error: "Could not read document bytes." };
  }

  const { error: uploadError } = await client.storage
    .from(DOCUMENTS_BUCKET)
    .upload(storagePath, bytes, { contentType: input.file.type, upsert: false });
  if (uploadError) return { ok: false, error: uploadError.message };

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const { error: insertError } = await client.from("documents").insert({
    id: documentId,
    organization_id: input.organizationId,
    tenancy_id: input.tenancyId ?? null,
    person_id: input.personId ?? null,
    lease_document_id: input.leaseDocumentId ?? null,
    work_order_id: input.workOrderId ?? null,
    property_id: input.propertyId ?? null,
    title,
    doc_type: input.docType,
    storage_path: storagePath,
    mime_type: input.file.type,
    size_bytes: input.file.size,
    sha256,
    source: input.source ?? "uploaded",
  });
  if (insertError) {
    await removeDocuments(client, [storagePath]);
    return { ok: false, error: insertError.message };
  }

  return { ok: true, documentId, storagePath, title };
}

export async function listDocumentsForProperty(
  client: SupabaseClient,
  organizationId: string,
  propertyId: string,
): Promise<VaultDocumentRow[]> {
  const { data } = await client
    .from("documents")
    .select(VAULT_DOCUMENT_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("property_id", propertyId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  return (data as VaultDocumentRow[] | null) ?? [];
}

export async function listDocumentsForWorkOrder(
  client: SupabaseClient,
  organizationId: string,
  workOrderId: string,
): Promise<VaultDocumentRow[]> {
  const { data } = await client
    .from("documents")
    .select(VAULT_DOCUMENT_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("work_order_id", workOrderId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  return (data as VaultDocumentRow[] | null) ?? [];
}

export async function listDocumentsForWorkOrdersById(
  client: SupabaseClient,
  organizationId: string,
  workOrderIds: readonly string[],
): Promise<Map<string, VaultDocumentRow[]>> {
  const ids = Array.from(new Set(workOrderIds.filter(Boolean)));
  const byWorkOrder = new Map<string, VaultDocumentRow[]>();
  if (ids.length === 0) return byWorkOrder;

  const { data } = await client
    .from("documents")
    .select(VAULT_DOCUMENT_COLUMNS)
    .eq("organization_id", organizationId)
    .in("work_order_id", ids)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  for (const row of (data as VaultDocumentRow[] | null) ?? []) {
    if (!row.work_order_id) continue;
    const rows = byWorkOrder.get(row.work_order_id) ?? [];
    rows.push(row);
    byWorkOrder.set(row.work_order_id, rows);
  }
  return byWorkOrder;
}
