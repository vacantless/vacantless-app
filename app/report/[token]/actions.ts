"use server";

import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateReportSubmission } from "@/lib/incident-reports";
import {
  validateMediaUpload,
  kindForType,
  extForType,
  incidentMediaStoragePath,
} from "@/lib/incident-media";
import { createIncidentMediaUploadUrl } from "@/lib/incident-media-server";

// Public, UNAUTHENTICATED tenant incident-intake actions (Option B Slice 2).
//
// The tenant has no account; the tenancy `report_token` is their only handle.
// Every action calls a SECURITY DEFINER RPC that RE-DERIVES org/tenancy/property
// from the token and re-checks every precondition server-side
// (feedback_anon_rpc_revalidate_server_side). We validate in TS too (fast
// feedback) but the RPC is the source of truth.
//
// Media never flows THROUGH a server action (a 25 MB video would blow past the
// Vercel ~4.5 MB request-body limit). Instead the browser PUTs bytes DIRECTLY to
// a short-lived SIGNED UPLOAD URL minted here against a SERVER-TRUSTED path: the
// org id comes from authorize_incident_media_upload (never the client), so a
// forged org id can't steer an upload into another org's folder. The metadata
// row is then recorded via record_incident_media, which re-validates again.

export type CreateReportResult =
  | { ok: true; reportId: string; organizationId: string }
  | { ok: false; reason: string };

export async function createIncidentReport(input: {
  token: string;
  category: string;
  description: string;
  reporterName?: string | null;
  reporterContact?: string | null;
}): Promise<CreateReportResult> {
  const token = (input.token ?? "").trim();
  if (!token) return { ok: false, reason: "not_found" };

  // Fast local validation (the RPC re-checks).
  const check = validateReportSubmission({
    category: input.category,
    description: input.description,
  });
  if (!check.ok) return { ok: false, reason: check.reason };

  const supabase = createClient();
  const { data, error } = await supabase.rpc("submit_incident_report", {
    p_token: token,
    p_category: check.category,
    p_description: check.description,
    p_reporter_name: input.reporterName ?? null,
    p_reporter_contact: input.reporterContact ?? null,
  });
  const result = data as
    | { ok?: boolean; reason?: string; report_id?: string; organization_id?: string }
    | null;
  if (error || !result?.ok || !result.report_id || !result.organization_id) {
    return { ok: false, reason: result?.reason ?? "failed" };
  }
  return {
    ok: true,
    reportId: result.report_id,
    organizationId: result.organization_id,
  };
}

export type PrepareUploadResult =
  | {
      ok: true;
      signedUrl: string;
      uploadToken: string;
      path: string;
      kind: "image" | "video";
    }
  | { ok: false; reason: string };

// Authorize one media upload: confirm (token, report) belong together and the
// report still accepts media, then mint a signed UPLOAD url at a server-trusted
// path. The client uploads the bytes to that URL, then calls confirmIncidentMedia.
export async function prepareIncidentUpload(input: {
  token: string;
  reportId: string;
  fileType: string;
  fileSize: number;
}): Promise<PrepareUploadResult> {
  const token = (input.token ?? "").trim();
  if (!token || !input.reportId) return { ok: false, reason: "not_found" };

  // Local type/size gate (the record RPC re-checks server-side).
  const media = validateMediaUpload({ type: input.fileType, size: input.fileSize });
  if (!media.ok) return { ok: false, reason: media.reason };

  const supabase = createClient();
  const { data: auth, error: authErr } = await supabase.rpc(
    "authorize_incident_media_upload",
    { p_token: token, p_report_id: input.reportId },
  );
  const authRes = auth as { ok?: boolean; reason?: string; organization_id?: string } | null;
  if (authErr || !authRes?.ok || !authRes.organization_id) {
    return { ok: false, reason: authRes?.reason ?? "failed" };
  }

  // SERVICE-ROLE client mints the signed upload url for the account-less tenant,
  // AFTER the token + report ownership was re-derived above. The path is built
  // from the SERVER-trusted org id + report id.
  const admin = createAdminClient();
  if (!admin) return { ok: false, reason: "failed" };

  const mediaId = randomUUID();
  const ext = extForType(input.fileType);
  const path = incidentMediaStoragePath(
    authRes.organization_id,
    input.reportId,
    mediaId,
    ext,
  );
  const minted = await createIncidentMediaUploadUrl(admin, path);
  if (!minted.ok) return { ok: false, reason: "media_failed" };

  return {
    ok: true,
    signedUrl: minted.signedUrl,
    uploadToken: minted.token,
    path: minted.path,
    kind: media.kind,
  };
}

export type ConfirmMediaResult = { ok: true } | { ok: false; reason: string };

// Record the metadata row AFTER the bytes are uploaded. The RPC re-validates the
// path lives under this org+report, the MIME/kind/size are in range, and the
// report still accepts media.
export async function confirmIncidentMedia(input: {
  token: string;
  reportId: string;
  path: string;
  mimeType: string;
  sizeBytes: number;
  kind: string;
}): Promise<ConfirmMediaResult> {
  const token = (input.token ?? "").trim();
  if (!token || !input.reportId) return { ok: false, reason: "not_found" };
  const kind = kindForType(input.mimeType);
  if (!kind || kind !== input.kind) return { ok: false, reason: "bad_kind" };

  const supabase = createClient();
  const { data, error } = await supabase.rpc("record_incident_media", {
    p_token: token,
    p_report_id: input.reportId,
    p_storage_path: input.path,
    p_mime_type: input.mimeType,
    p_size_bytes: input.sizeBytes,
    p_kind: kind,
  });
  const result = data as { ok?: boolean; reason?: string } | null;
  if (error || !result?.ok) return { ok: false, reason: result?.reason ?? "failed" };
  return { ok: true };
}
