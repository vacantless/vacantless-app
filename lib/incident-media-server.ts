// Server-side signed-URL helpers for the PRIVATE incident-media bucket
// (Option B incident-dispatch, Slice 1).
//
// The incident-media bucket (migration 0060) is private — there is no public
// CDN URL. Every read and every account-less upload goes through a short-lived
// SIGNED URL minted here, server-side. Centralizing the bucket name + the TTL in
// one module keeps Slice 2 (tenant intake) and Slice 5 (trade portal) consistent
// and makes the privacy boundary one edit to audit.
//
// Client-agnostic by design: pass whichever Supabase client matches the caller's
// authorization context —
//   * the RLS server client (lib/supabase/server) for an OPERATOR minting a URL
//     for media in their own org (the 0060 SELECT policy scopes it), or
//   * the service-role admin client (lib/supabase/admin) for a TOKEN RPC acting
//     on behalf of an account-less tenant/trade, AFTER the token is validated
//     and the org/report ownership is re-derived server-side. service_role
//     bypasses RLS, so the caller is responsible for that re-validation
//     (feedback_anon_rpc_revalidate_server_side).
//
// This module never decides WHO may see a path — it only mints the URL once the
// caller has established authorization. No Next imports; only the storage seam.

import type { SupabaseClient } from "@supabase/supabase-js";

// The private bucket id — MUST match migration 0060 + the path helpers in
// lib/incident-media.ts.
export const INCIDENT_MEDIA_BUCKET = "incident-media";

// How long a download/preview signed URL stays valid. Short by default: these
// are sensitive in-home photos/video, and a fresh URL is cheap to mint on each
// page load. 1 hour comfortably covers a dashboard view or a tenant/trade
// session without leaving a long-lived link in logs/history.
export const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

// Minimal structural shape — only the storage seam is used, so this accepts both
// the RLS server client and the service-role admin client without coupling to
// the Database generic.
type StorageCapable = Pick<SupabaseClient, "storage">;

export type SignedUploadTarget = {
  ok: true;
  /** The URL the client PUTs the bytes to (via storage.uploadToSignedUrl). */
  signedUrl: string;
  /** The upload token (paired with the path for uploadToSignedUrl). */
  token: string;
  /** The object path the upload lands at (echoed for convenience). */
  path: string;
};

export type SignedUrl = { ok: true; signedUrl: string };

export type SignedUrlError = { ok: false; error: string };

/**
 * Mint a one-time signed UPLOAD url for an account-less uploader (a tenant with
 * no Supabase account). The caller MUST have already validated the token and
 * derived the org/report so that `path` is built from server-trusted ids (see
 * lib/incident-media.incidentMediaStoragePath). The returned token + url let the
 * browser PUT the bytes directly without ever holding a service-role key.
 */
export async function createIncidentMediaUploadUrl(
  client: StorageCapable,
  path: string,
): Promise<SignedUploadTarget | SignedUrlError> {
  const { data, error } = await client.storage
    .from(INCIDENT_MEDIA_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not create upload URL." };
  }
  return { ok: true, signedUrl: data.signedUrl, token: data.token, path: data.path };
}

/**
 * Mint a short-lived signed DOWNLOAD/preview url for one object. Use the client
 * whose authorization matches the viewer (RLS server client for an operator;
 * admin client after a token check for a tenant/trade).
 */
export async function createIncidentMediaDownloadUrl(
  client: StorageCapable,
  path: string,
  expiresInSeconds: number = SIGNED_URL_TTL_SECONDS,
): Promise<SignedUrl | SignedUrlError> {
  const { data, error } = await client.storage
    .from(INCIDENT_MEDIA_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not create signed URL." };
  }
  return { ok: true, signedUrl: data.signedUrl };
}

export type SignedUrlForPath = { path: string; signedUrl: string | null };

/**
 * Mint signed download urls for MANY objects in one round-trip (a report's
 * gallery). Returns one entry per requested path, in order; a per-object failure
 * surfaces as a null signedUrl rather than failing the whole batch. Returns an
 * error only if the batch call itself fails.
 */
export async function createIncidentMediaDownloadUrls(
  client: StorageCapable,
  paths: string[],
  expiresInSeconds: number = SIGNED_URL_TTL_SECONDS,
): Promise<{ ok: true; urls: SignedUrlForPath[] } | SignedUrlError> {
  if (paths.length === 0) return { ok: true, urls: [] };
  const { data, error } = await client.storage
    .from(INCIDENT_MEDIA_BUCKET)
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
 * Remove a stored object (e.g. when a report or a single media item is deleted).
 * The caller's client authorization governs which objects it can touch (the RLS
 * DELETE + SELECT policies for an operator; service_role bypasses). Returns ok
 * even if the object was already gone.
 */
export async function removeIncidentMedia(
  client: StorageCapable,
  paths: string[],
): Promise<{ ok: true } | SignedUrlError> {
  if (paths.length === 0) return { ok: true };
  const { error } = await client.storage
    .from(INCIDENT_MEDIA_BUCKET)
    .remove(paths);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
