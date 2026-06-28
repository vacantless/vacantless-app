import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { removeDocuments } from "@/lib/documents-server";
import {
  isDueForPurge,
  effectiveRetentionUntilMs,
  isReapablePendingCapture,
  RETENTION_GRACE_DAYS,
  type RetentionDoc,
  type PendingCaptureDoc,
} from "@/lib/document-retention";

// Document-retention purge sweep — the PII hard-delete half of the document
// vault (DOCUMENT-VAULT-DESIGN-2026-06-26.md, Slice 3). The vault holds heavy
// protected PII (executed leases, ID/application packages, insurance). Soft-delete
// (documents-actions.deleteTenancyDocument) keeps the metadata ROW as an audit
// trail and removes the stored BYTES immediately; this sweep permanently purges a
// soft-deleted document once it is past its retention grace (documents.retention_until,
// stamped = deleted_at + RETENTION_GRACE_DAYS at soft-delete) — it re-removes the
// bytes as a backstop (in case the soft-delete's best-effort remove missed) and
// then hard-deletes the row, which cascades document_share_links (0076 FK).
//
// This is a permanent, irreversible delete, so it acts ONLY on already
// soft-deleted rows that are past their window — never a live document.
//
// Auth: CRON_SECRET (Bearer or ?secret=). Test affordances (CRON_SECRET-gated):
//   ?org=<id>   limit the sweep to one org
//   ?force=1    purge EVERY soft-deleted document regardless of the retention
//               window (QA only — bypasses the grace period)
//   ?dry=1      report what WOULD be purged without removing anything
//
// Reads documents across all orgs via the service-role client (RLS hides them
// from anon/user sessions); see lib/supabase/admin.ts.
//
// KI530: Next 14 caches fetch GETs and `dynamic = "force-dynamic"` does NOT
// opt them out — a service-role read that gates on mutable state (here:
// deleted_at / retention_until) must also set fetchCache = "force-no-store" so
// each tick reads the live row, never a stale cached one.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

type Summary = {
  ok: boolean;
  reason?: string;
  scanned: number; // soft-deleted documents found
  purged: number; // documents permanently deleted (or "would purge" in dry mode)
  skipped: number; // soft-deleted but still inside the retention window
  errors: number;
  // Pending scan-capture reap (S365 Phase 2): unconfirmed photo-OCR captures
  // (pending_until set, appliance_id null, not soft-deleted) past their grace.
  pendingScanned: number;
  pendingReaped: number; // reaped (bytes + row), or "would reap" in dry mode
  details: Array<Record<string, unknown>>;
};

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // not configured → refuse
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  return req.nextUrl.searchParams.get("secret") === secret;
}

type DocRow = RetentionDoc & {
  id: string;
  organization_id: string;
  storage_path: string;
};

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { ok: false, reason: "service_role_not_configured", scanned: 0, purged: 0, skipped: 0, errors: 0, pendingScanned: 0, pendingReaped: 0, details: [] } satisfies Summary,
      { status: 200 },
    );
  }

  const params = req.nextUrl.searchParams;
  const force = params.get("force") === "1";
  const dry = params.get("dry") === "1";
  const onlyOrg = params.get("org");

  // Only soft-deleted rows are ever in scope for a purge.
  let q = admin
    .from("documents")
    .select("id, organization_id, storage_path, deleted_at, retention_until")
    .not("deleted_at", "is", null);
  if (onlyOrg) q = q.eq("organization_id", onlyOrg);

  const { data: rows, error } = await q;
  if (error) {
    return NextResponse.json(
      { ok: false, reason: `query_error:${error.message}`, scanned: 0, purged: 0, skipped: 0, errors: 1, pendingScanned: 0, pendingReaped: 0, details: [] } satisfies Summary,
      { status: 200 },
    );
  }

  const docs = (rows ?? []) as DocRow[];
  const now = new Date();
  const summary: Summary = { ok: true, scanned: docs.length, purged: 0, skipped: 0, errors: 0, pendingScanned: 0, pendingReaped: 0, details: [] };

  for (const doc of docs) {
    const due = force || isDueForPurge(doc, now);
    if (!due) {
      summary.skipped++;
      continue;
    }

    if (dry) {
      summary.purged++; // "would purge"
      summary.details.push({
        org: doc.organization_id,
        document: doc.id,
        dry: true,
        retention_until_ms: effectiveRetentionUntilMs(doc),
      });
      continue;
    }

    // Backstop: re-remove the bytes (soft-delete already did this best-effort;
    // remove() is a no-op if the object is already gone). Then hard-delete the
    // metadata row — the 0076 FK cascades any document_share_links.
    const rm = await removeDocuments(admin, [doc.storage_path]);
    const { error: delErr } = await admin.from("documents").delete().eq("id", doc.id);
    if (delErr) {
      summary.errors++;
      summary.details.push({ org: doc.organization_id, document: doc.id, error: delErr.message });
      continue;
    }
    summary.purged++;
    summary.details.push({
      org: doc.organization_id,
      document: doc.id,
      bytes_removed: rm.ok,
    });
  }

  // ---------------------------------------------------------------------------
  // Pending scan-capture reap (S365 Phase 2). A photo-OCR scan stores the image
  // as a `documents` row BEFORE the appliance exists (pending_until set,
  // appliance_id null). On confirm addAppliance promotes it (pending_until ->
  // null); if abandoned, reap it here so no bytes are orphaned. Disjoint from the
  // purge above: those rows are soft-deleted (deleted_at set) and confirmed; these
  // are NOT soft-deleted and never confirmed, so an abandoned capture goes
  // straight out (bytes removed + row hard-deleted) — no audit value to keep.
  // ?force reaps every pending capture regardless of the window; ?dry reports only.
  let pq = admin
    .from("documents")
    .select("id, organization_id, storage_path, pending_until, appliance_id, deleted_at")
    .not("pending_until", "is", null)
    .is("appliance_id", null)
    .is("deleted_at", null);
  if (onlyOrg) pq = pq.eq("organization_id", onlyOrg);

  const { data: pendRows, error: pendErr } = await pq;
  if (pendErr) {
    summary.errors++;
    summary.details.push({ pending_query_error: pendErr.message });
  } else {
    type PendRow = PendingCaptureDoc & { id: string; organization_id: string; storage_path: string };
    const pend = (pendRows ?? []) as PendRow[];
    summary.pendingScanned = pend.length;

    for (const doc of pend) {
      const due = force || isReapablePendingCapture(doc, now);
      if (!due) {
        summary.skipped++;
        continue;
      }
      if (dry) {
        summary.pendingReaped++; // "would reap"
        summary.details.push({ org: doc.organization_id, pending_capture: doc.id, dry: true });
        continue;
      }
      const rm = await removeDocuments(admin, [doc.storage_path]);
      const { error: delErr } = await admin.from("documents").delete().eq("id", doc.id);
      if (delErr) {
        summary.errors++;
        summary.details.push({ org: doc.organization_id, pending_capture: doc.id, error: delErr.message });
        continue;
      }
      summary.pendingReaped++;
      summary.details.push({ org: doc.organization_id, pending_capture: doc.id, bytes_removed: rm.ok });
    }
  }

  return NextResponse.json(summary, { status: 200 });
}
