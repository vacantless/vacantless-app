import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  DEFAULT_INGEST_DOMAIN,
  pickIngestToken,
  verifyIngestSecret,
  readIngestSecretFromAuth,
  ingestDedupeKey,
  decideIngest,
  MAX_INGEST_ATTACHMENT_BYTES,
  type IngestAttachmentInput,
  type IngestLoopHeaders,
} from "@/lib/email-ingest";
import { canUseCaptureEmailIn } from "@/lib/billing";
import { parseAssetImage } from "@/lib/asset-capture-vision";
import type { AssetDraft } from "@/lib/asset-capture";
import {
  documentStoragePath,
  defaultTitleFromFilename,
  extForType as documentExtForType,
} from "@/lib/documents";
import { DOCUMENTS_BUCKET } from "@/lib/documents-server";
import { pendingCaptureUntil } from "@/lib/document-retention";

// ============================================================================
// Inbound asset-capture webhook (Capture Phase 3 — EMAIL-IN-INGRESS-DESIGN-LOCK-
// 2026-06-28.md, Slice 1). An inbound-email provider (recommended: Postmark
// Inbound, attachments inline base64) POSTs a forwarded landlord email here; we
// resolve the org from the recipient token, gate on the per-org verified-sender
// allow-list, validate the attachment, run the SAME parseAssetImage engine the
// in-app scan uses, and file a PENDING capture the landlord confirms from the
// dashboard. NEVER an unattended write to unit_appliances/expenses.
//
// SECURITY is the bulk of this — and it lives in lib/email-ingest (pure, unit-
// tested). This route is thin glue: authenticate -> normalize the provider
// payload -> decode attachments -> decideIngest() -> act. The body is never read.
//
// SHIPS DARK: with no INBOUND_WEBHOOK_SECRET set (or no service-role key), the
// route returns 404 and does nothing — exactly like the SMS webhook no-ops when
// TWILIO_AUTH_TOKEN is unset. It activates only once Noam stands up the provider
// + MX on in.vacantless.com and sets the secret in Vercel (Slice 3 go-live).
//
// Response policy (avoid provider retry-storms): 404 when unconfigured; 401 on a
// bad secret; 200 for everything we handle (accept, drop, quarantine) so the
// provider marks it delivered and does not retry. A 5xx is reserved for an
// unexpected server fault (the provider SHOULD retry that).
//
// PII posture (standing rule): store ONLY the validated attachment into the
// org-gated vault; never persist the email body or headers (only the From + a
// hashed message-id for dedupe). A non-image/PDF payload is dropped before storage.
// ============================================================================

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Ingress captures wait for the landlord to next open the dashboard, so they
 * get a far longer pending grace than the in-app scan's 6h (which is confirmed
 * within minutes from the prefilled form). 7 days; abandoned ones still reap. */
const INGEST_PENDING_GRACE_HOURS = 24 * 7;

const PROVIDER = "inbound";

/** Bound the decode work (Codex 2026-06-29 should-fix): never base64-decode more
 * than this many attachment entries into memory per message, and skip any entry
 * whose ENCODED length already implies it exceeds the per-attachment byte cap.
 * selectIngestAttachment still applies the authoritative magic-byte + size cap;
 * this just stops us buffering a huge/large-count payload before that runs. */
const MAX_INBOUND_ATTACHMENTS = 10;

export async function POST(req: NextRequest) {
  const secret = process.env.INBOUND_WEBHOOK_SECRET;
  const admin = createAdminClient();
  // Unconfigured => dark. Don't reveal the endpoint exists; don't act.
  if (!secret || !admin) {
    return new NextResponse("Not found", { status: 404 });
  }

  // ---- Layer 1: authenticate the webhook (constant-time shared secret) ------
  // Accept the credential from the Authorization header (Postmark Basic-Auth /
  // a Bearer token) or a ?key= query param (some provider URL configs).
  const authHeader = req.headers.get("authorization");
  const provided =
    readIngestSecretFromAuth(authHeader) ??
    new URL(req.url).searchParams.get("key");
  if (!verifyIngestSecret(provided, secret)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // ---- Parse the provider payload (Postmark Inbound JSON shape) -------------
  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    // Malformed body from an authenticated caller — nothing to do, don't retry.
    return NextResponse.json({ ok: true, handled: "bad_payload" });
  }

  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  // Recipients: Postmark gives ToFull/CcFull arrays of {Email} + To/Cc strings.
  const recipientStrings: string[] = [];
  for (const key of ["ToFull", "CcFull", "BccFull"]) {
    const arr = payload[key];
    if (Array.isArray(arr)) {
      for (const r of arr) {
        const email = r && typeof r === "object" ? str((r as any).Email) : "";
        if (email) recipientStrings.push(email);
      }
    }
  }
  for (const key of ["To", "Cc", "OriginalRecipient"]) {
    const s = str(payload[key]);
    if (s) recipientStrings.push(s);
  }

  const ingestDomain = process.env.INGEST_EMAIL_DOMAIN || DEFAULT_INGEST_DOMAIN;
  const token = pickIngestToken(recipientStrings, ingestDomain);

  // From: prefer the structured FromFull.Email, fall back to the From header.
  const fromFull = payload.FromFull;
  const from =
    (fromFull && typeof fromFull === "object" ? str((fromFull as any).Email) : "") ||
    str(payload.From);

  // Loop/auto-reply headers (lowercased keys for the pure checker).
  const loopHeaders: IngestLoopHeaders = { from };
  const headerArr = payload.Headers;
  if (Array.isArray(headerArr)) {
    for (const h of headerArr) {
      if (!h || typeof h !== "object") continue;
      const name = str((h as any).Name).toLowerCase();
      const value = str((h as any).Value);
      if (name === "auto-submitted") loopHeaders["auto-submitted"] = value;
      else if (name === "precedence") loopHeaders.precedence = value;
      else if (name === "x-autoreply") loopHeaders["x-autoreply"] = value;
      else if (name === "x-autorespond") loopHeaders["x-autorespond"] = value;
    }
  }

  // Decode attachments (Postmark: Attachments[].Content is base64). Bounded:
  // skip an entry whose encoded length already exceeds the cap (base64 inflates
  // ~4/3) BEFORE allocating the decoded buffer, and stop after MAX_INBOUND_
  // ATTACHMENTS successful decodes so a many-attachment message can't make us
  // buffer unbounded bytes. The authoritative type/size validation is still
  // selectIngestAttachment (magic bytes + the real cap).
  const attachments: IngestAttachmentInput[] = [];
  const attArr = payload.Attachments;
  if (Array.isArray(attArr)) {
    const maxEncodedLen = Math.ceil((MAX_INGEST_ATTACHMENT_BYTES * 4) / 3) + 16;
    for (const a of attArr) {
      if (attachments.length >= MAX_INBOUND_ATTACHMENTS) break;
      if (!a || typeof a !== "object") continue;
      const content = str((a as any).Content);
      if (!content || content.length > maxEncodedLen) continue;
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(Buffer.from(content, "base64"));
      } catch {
        continue;
      }
      attachments.push({
        filename: str((a as any).Name) || null,
        contentType: str((a as any).ContentType) || null,
        bytes,
      });
    }
  }

  // ---- Resolve the org from the token (Layer 2) -----------------------------
  let orgId: string | null = null;
  if (token) {
    const { data: addr } = await admin
      .from("org_ingest_addresses")
      .select("organization_id")
      .eq("token", token)
      .eq("active", true)
      .maybeSingle();
    orgId = addr?.organization_id ?? null;
  }

  // ---- F1 (S369 / Codex 2026-06-29 audit): re-check the plan entitlement at
  // accept time. The ingest-address row persists across a plan change, so a
  // Growth->Free downgrade would otherwise keep capturing. Re-checking here (vs.
  // hooking every downgrade path) makes the webhook authoritative: an unentitled
  // org drops as a 200 no-op. The provisioning action stays the primary gate;
  // this is the belt-and-braces so the gate can't be bypassed by a stale address.
  if (orgId) {
    const { data: orgRow } = await admin
      .from("organizations")
      .select("plan")
      .eq("id", orgId)
      .maybeSingle();
    if (!canUseCaptureEmailIn(orgRow?.plan ?? null)) {
      console.warn("inbound/asset: org not entitled (plan downgrade)", {
        orgResolved: true,
      });
      return NextResponse.json({ ok: true, handled: "plan_inactive" });
    }
  }

  // ---- Load the per-org verified-sender allow-list (Layer 3) -----------------
  let allowlist: string[] = [];
  if (orgId) {
    const { data: senders } = await admin
      .from("org_ingest_senders")
      .select("address")
      .eq("organization_id", orgId)
      .eq("channel", "email")
      .not("verified_at", "is", null);
    allowlist = (senders ?? [])
      .map((s: any) => (typeof s.address === "string" ? s.address : null))
      .filter((a: string | null): a is string => a != null);
  }

  // ---- The composed policy decision (pure, tested) --------------------------
  const decision = decideIngest({
    channel: "email",
    authenticated: true, // verified above
    orgResolved: orgId != null,
    from,
    allowlist,
    loopHeaders,
    attachments,
  });

  if (decision.action !== "accept") {
    // drop | quarantine | reject_attachment — log minimally (no body, no PII),
    // return 200 so the provider doesn't retry. The quarantine "verify this
    // sender?" prompt + the review queue are Slice 2.
    console.warn("inbound/asset: not accepted", {
      action: decision.action,
      reason: decision.reason, // every non-accept variant carries a reason
      hasToken: token != null,
      orgResolved: orgId != null,
    });
    return NextResponse.json({ ok: true, handled: decision.action });
  }

  // ---- Accept: dedupe, parse (if image), store the pending capture ----------
  const messageId = str(payload.MessageID) || str(payload.MessageId);
  const dedupeKey = ingestDedupeKey(
    PROVIDER,
    messageId,
    `${orgId}:${from}:${decision.attachment.bytes.length}`,
  );

  // A1 (Codex 2026-06-29 audit): dedupe BEFORE the vision parse. A provider retry
  // or a deliberate replay of the same image (from a holder of the secret + token
  // + an allowed sender) is a no-op for stored rows, but the parse ran first, so
  // it still burned an Anthropic call + server time. Short-circuit on the existing
  // ingest_message_key here, before parseAssetImage. storeIngestCapture keeps its
  // own pre-check AND the insert-time 23505 unique-violation handling as the race
  // backstop for two concurrent first-deliveries.
  const { data: dupe } = await admin
    .from("documents")
    .select("id")
    .eq("ingest_message_key", dedupeKey)
    .maybeSingle();
  if (dupe?.id) {
    return NextResponse.json({ ok: true, handled: "duplicate" });
  }

  // parseAssetImage runs ONLY on a vision-parseable image; a PDF lands as a
  // store-only pending capture (no prefill) — the engine takes images in v1. The
  // parsed draft is persisted on the row so the review queue prefills the confirm
  // form without a second vision call.
  let draft: AssetDraft | null = null;
  if (decision.attachment.parseable) {
    const parsed = await parseAssetImage(
      Buffer.from(decision.attachment.bytes),
      decision.attachment.mimeType,
    );
    if (parsed.ok) draft = parsed.draft;
    // A parse miss is non-fatal: we still keep the image as a pending capture so
    // the landlord can confirm/enter it from the review queue.
  }

  const stored = await storeIngestCapture(admin, orgId!, decision.attachment, {
    docType: draft?.kind === "receipt" || !decision.attachment.parseable ? "receipt" : "other",
    draft,
    dedupeKey,
  });

  if (stored === "duplicate") {
    return NextResponse.json({ ok: true, handled: "duplicate" });
  }
  if (!stored) {
    // A storage/db fault on an otherwise-valid capture — let the provider retry.
    return new NextResponse("Storage error", { status: 503 });
  }

  return NextResponse.json({ ok: true, handled: "captured", parseable: decision.attachment.parseable });
}

/**
 * Store a validated inbound attachment as a PENDING capture (a `documents` row +
 * the bytes in the private vault), via the service-role admin client. Mirrors
 * the in-app storePendingCapture but: source = 'ingest_email', a 7-day pending
 * grace, and an ingest_message_key for retry/replay dedupe (the partial-unique
 * index makes a duplicate insert a no-op). Returns the doc id, "duplicate", or
 * null on a real fault. Rolls back the stored object if the row insert fails so
 * Storage + the table stay in sync.
 */
async function storeIngestCapture(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  orgId: string,
  attachment: { filename: string; mimeType: string; bytes: Uint8Array },
  opts: { docType: "receipt" | "other"; draft: AssetDraft | null; dedupeKey: string },
): Promise<string | "duplicate" | null> {
  try {
    // Pre-check dedupe so we don't upload bytes for a message we've seen.
    const { data: existing } = await admin
      .from("documents")
      .select("id")
      .eq("ingest_message_key", opts.dedupeKey)
      .maybeSingle();
    if (existing?.id) return "duplicate";

    const docId = crypto.randomUUID();
    const path = documentStoragePath(orgId, docId, documentExtForType(attachment.mimeType));
    const buf = Buffer.from(attachment.bytes);

    const { error: upErr } = await admin.storage
      .from(DOCUMENTS_BUCKET)
      .upload(path, buf, { contentType: attachment.mimeType, upsert: false });
    if (upErr) return null;

    const sha256 = createHash("sha256").update(buf).digest("hex");
    const nowIso = new Date().toISOString();

    const { error: insErr } = await admin.from("documents").insert({
      id: docId,
      organization_id: orgId,
      // appliance_id / expense_id stay NULL until the landlord confirms from the
      // review queue (Slice 2), which promotes via the existing addAppliance /
      // logScanExpense paths.
      title: defaultTitleFromFilename(attachment.filename),
      doc_type: opts.docType,
      storage_path: path,
      mime_type: attachment.mimeType,
      size_bytes: attachment.bytes.length,
      sha256,
      source: "ingest_email",
      pending_until: pendingCaptureUntil(nowIso, INGEST_PENDING_GRACE_HOURS),
      ingest_message_key: opts.dedupeKey,
      ingest_draft: opts.draft, // parsed fields for the review-queue prefill (or NULL)
    });
    if (insErr) {
      // Unique-violation on the dedupe key => a concurrent duplicate; treat as such.
      // Otherwise roll back the orphaned object.
      await admin.storage.from(DOCUMENTS_BUCKET).remove([path]);
      const code = (insErr as { code?: string }).code;
      if (code === "23505") return "duplicate";
      return null;
    }
    return docId;
  } catch {
    return null;
  }
}
