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

import type { SupabaseClient } from "@supabase/supabase-js";

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
