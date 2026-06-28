// ============================================================================
// Email-in / text-in INGRESS — the pure trust-boundary layer (Capture Phase 3,
// EMAIL-IN-INGRESS-DESIGN-LOCK-2026-06-28.md). A landlord forwards a phone photo
// of an appliance plate or a store receipt to a per-org address
// (u-<token>@in.vacantless.com) or texts it to a number; an inbound provider
// POSTs a webhook to app/api/inbound/asset, which uses THIS module to decide —
// deterministically and unit-testably — what is trustworthy and what to drop.
//
// THE SECURITY IS THE BULK OF THIS FEATURE, NOT THE PARSING (the parse is the
// already-live parseAssetImage). A forged request must clear EVERY layer below,
// and even a full bypass can only queue a review card — never an unattended
// write to unit_appliances/expenses (the landlord confirms a pending capture
// from the dashboard). Layers, fail-closed:
//   1. webhook authenticity   — verifyIngestSecret (constant-time)
//   2. recipient token -> org — parseIngestToken / pickIngestToken
//   3. per-org sender allow-list (THE real authority, cf. Expensify's "forward
//      from your registered email address") — isAllowedSenderEmail / ...Phone
//   4. attachment validation  — selectIngestAttachment (magic-byte sniff + cap,
//      body IGNORED entirely)
//   5. abuse/loop drop        — isAutoReplyOrLoop
//   6. idempotency            — ingestDedupeKey
//
// PII posture (standing rule): store ONLY the validated attachment; never persist
// raw email/SMS bodies or headers (only the From + a hashed message-id for
// dedupe). A non-image/PDF payload (e.g. a mailed-in ID) is dropped at layer 4.
//
// PURE + dependency-light: only node:crypto + the existing pure helpers
// (sniffImageType, MAX_DOCUMENT_BYTES, normalizePhoneE164). No Supabase / Next /
// provider SDK imports, so the webhook route and scripts/test-email-ingest.ts
// agree on exactly one set of rules. Unit-tested: npx tsx scripts/test-email-ingest.ts
// ============================================================================

import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { sniffImageType } from "./image-url-import";
import { MAX_DOCUMENT_BYTES } from "./documents";
import { normalizePhoneE164 } from "./sms";

// ---------------------------------------------------------------------------
// Addressing — the per-org ingest token (the u-<token>@in.vacantless.com model,
// mirroring the feed/[org] unguessable-token route).
// ---------------------------------------------------------------------------

/** The local-part prefix that marks an ingest address: u-<token>@<domain>. */
export const INGEST_LOCALPART_PREFIX = "u-";

/** The MX subdomain ingest addresses live on (overridable in the route via env;
 * the matcher takes the domain as an arg so tests don't depend on env). */
export const DEFAULT_INGEST_DOMAIN = "in.vacantless.com";

/** Token charset/length. Lowercase base32hex-ish (no vowels-only constraint —
 * we generate from random bytes), 24..64 chars. Unguessable (>=120 bits) and
 * rotatable. Validated lowercased; generated lowercase, so compare lowercased. */
const TOKEN_RE = /^[a-z0-9]{24,64}$/;

export function isValidIngestToken(token: unknown): token is string {
  return typeof token === "string" && TOKEN_RE.test(token);
}

/** Generate a fresh, unguessable token (~160 bits -> 32 base32 chars). Server-
 * side provisioning helper; only its SHAPE is asserted in tests, never a value. */
export function generateIngestToken(): string {
  // base32 (lowercase, no padding) of 20 random bytes = 32 chars in [a-z2-7].
  const ALPH = "abcdefghijklmnopqrstuvwxyz234567";
  const buf = randomBytes(20);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPH[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
}

/** The full local-part for a token: "u-<token>". */
export function formatIngestLocalPart(token: string): string {
  return `${INGEST_LOCALPART_PREFIX}${token}`;
}

/** The full, user-facing ingest address for a token: "u-<token>@<domain>". The
 * value the settings panel shows the landlord to forward/text photos to. */
export function ingestAddressFromToken(
  token: string,
  domain: string = DEFAULT_INGEST_DOMAIN,
): string {
  return `${formatIngestLocalPart(token)}@${domain.trim().toLowerCase()}`;
}

/**
 * Given ONE recipient address, return the ingest token iff it is exactly
 * u-<token>@<ingestDomain> (domain + prefix matched case-insensitively; the
 * token must validate). Tolerates a display-name wrapper ("X <u-..@..>") and
 * surrounding angle brackets. Returns null for anything else (a normal To, a
 * different subdomain, a malformed/over-/under-length token).
 */
export function parseIngestToken(
  recipient: unknown,
  ingestDomain: string = DEFAULT_INGEST_DOMAIN,
): string | null {
  const addr = extractAddress(recipient);
  if (!addr) return null;
  const at = addr.lastIndexOf("@");
  if (at <= 0) return null;
  const local = addr.slice(0, at); // already lowercased + trimmed by extractAddress
  const domain = addr.slice(at + 1);
  if (domain !== ingestDomain.trim().toLowerCase()) return null;
  if (!local.startsWith(INGEST_LOCALPART_PREFIX)) return null;
  const token = local.slice(INGEST_LOCALPART_PREFIX.length);
  return isValidIngestToken(token) ? token : null;
}

/**
 * Scan a list of recipient addresses (To + Cc, a provider gives several) and
 * return the FIRST valid ingest token. Accepts a string[] or a single
 * comma-separated header value. Returns null if none match our ingest domain.
 */
export function pickIngestToken(
  recipients: unknown,
  ingestDomain: string = DEFAULT_INGEST_DOMAIN,
): string | null {
  const list = toRecipientList(recipients);
  for (const r of list) {
    const tok = parseIngestToken(r, ingestDomain);
    if (tok) return tok;
  }
  return null;
}

/** Normalize a recipients input into individual address strings. A header value
 * may be "a@x, B <b@y>"; an array may hold either form. */
export function toRecipientList(recipients: unknown): string[] {
  if (Array.isArray(recipients)) {
    return recipients.flatMap((r) => splitAddressList(r));
  }
  return splitAddressList(recipients);
}

function splitAddressList(value: unknown): string[] {
  if (typeof value !== "string") return [];
  // Split on commas that are NOT inside angle brackets / quotes is overkill for
  // our case (we only need to find OUR address); a plain comma split is safe
  // because our address has no comma. Filter empties.
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ---------------------------------------------------------------------------
// Sender identity + the per-org allow-list (layer 3 — the real authority).
// ---------------------------------------------------------------------------

/**
 * Pull a bare lowercased email address out of a From-style value:
 *   "Noam <noam@x.com>"  -> "noam@x.com"
 *   "<noam@x.com>"       -> "noam@x.com"
 *   "noam@x.com"         -> "noam@x.com"
 * Returns null if there is no plausible address.
 */
export function extractAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v) return null;
  const angled = v.match(/<([^<>]+)>/);
  const candidate = (angled ? angled[1] : v).trim().toLowerCase();
  // A minimal address shape: local@domain.tld with no spaces.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) return null;
  return candidate;
}

/** Normalize an email for allow-list comparison (lowercase bare address). */
export function normalizeSenderEmail(value: unknown): string | null {
  return extractAddress(value);
}

/**
 * Is the message From an address the org has verified? The capture is created
 * ONLY when this is true; an unknown sender is quarantined (recorded, surfaced
 * as "verify this sender?"), never turned into a usable capture. Comparison is
 * on normalized bare addresses. An empty/garbage From or an empty allow-list
 * -> false (fail closed).
 */
export function isAllowedSenderEmail(from: unknown, allowlist: unknown[]): boolean {
  const sender = normalizeSenderEmail(from);
  if (!sender) return false;
  const allowed = new Set(
    (Array.isArray(allowlist) ? allowlist : [])
      .map((a) => normalizeSenderEmail(a))
      .filter((a): a is string => a != null),
  );
  return allowed.has(sender);
}

/** Normalize a sender the SAME way for both the allow-list store and the inbound
 * compare, by channel: a lowercased bare email, or an E.164 phone. Returns null
 * for an unparseable value (the provisioning action rejects it). Used when the
 * landlord adds a verified sender so what's stored matches what the webhook
 * compares against. */
export function normalizeIngestSender(channel: IngestChannel, raw: unknown): string | null {
  if (channel === "sms") {
    return typeof raw === "string" ? normalizePhoneE164(raw) : null;
  }
  return normalizeSenderEmail(raw);
}

/** Channel C (text/MMS) variant: compare normalized E.164 phone numbers. */
export function isAllowedSenderPhone(from: unknown, allowlist: unknown[]): boolean {
  const sender = typeof from === "string" ? normalizePhoneE164(from) : null;
  if (!sender) return false;
  const allowed = new Set(
    (Array.isArray(allowlist) ? allowlist : [])
      .map((a) => (typeof a === "string" ? normalizePhoneE164(a) : null))
      .filter((a): a is string => a != null),
  );
  return allowed.has(sender);
}

// ---------------------------------------------------------------------------
// Attachment validation (layer 4). The body is IGNORED entirely — only an
// attachment whose ACTUAL bytes are a supported image (vision-parseable) or a
// PDF (stored, not vision-parsed in v1) is accepted.
// ---------------------------------------------------------------------------

/** Max bytes for an ingested attachment — same envelope as the vault. */
export const MAX_INGEST_ATTACHMENT_BYTES = MAX_DOCUMENT_BYTES;

/** %PDF- magic. A receipt PDF is stored as proof but not vision-parsed in v1
 * (the engine takes images), so it yields a no-prefill pending capture. */
export function sniffIsPdf(bytes: Uint8Array | number[]): boolean {
  const b = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes ?? []);
  return (
    b.length >= 5 &&
    b[0] === 0x25 && // %
    b[1] === 0x50 && // P
    b[2] === 0x44 && // D
    b[3] === 0x46 && // F
    b[4] === 0x2d // -
  );
}

/** The minimal shape of a provider attachment this layer reads. `bytes` is the
 * decoded content (a provider gives base64; the route decodes before calling). */
export type IngestAttachmentInput = {
  filename?: string | null;
  contentType?: string | null;
  bytes: Uint8Array;
};

export type SelectedIngestAttachment = {
  filename: string;
  // The AUTHORITATIVE mime from the magic bytes (never the claimed Content-Type).
  mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" | "application/pdf";
  bytes: Uint8Array;
  // images are vision-parseable -> prefill; a PDF is store-only in v1.
  parseable: boolean;
};

export type IngestAttachmentReject =
  | { ok: false; reason: "none" } // no attachment at all
  | { ok: false; reason: "type" } // had attachments, none a supported image/PDF
  | { ok: false; reason: "size" }; // a candidate exceeded the cap

/**
 * Pick the FIRST attachment whose real bytes are a supported image or PDF and
 * are within the size cap. The claimed Content-Type is advisory only — the
 * stored type comes from sniffing the bytes (a sender can claim anything). A
 * candidate that sniffs as image/PDF but is over the cap fails with "size" so
 * the caller can message precisely; an attachment that sniffs as neither is
 * skipped (we keep scanning), and "type" is returned only if NONE qualified.
 */
export function selectIngestAttachment(
  attachments: IngestAttachmentInput[] | null | undefined,
  maxBytes: number = MAX_INGEST_ATTACHMENT_BYTES,
): { ok: true; attachment: SelectedIngestAttachment } | IngestAttachmentReject {
  const list = Array.isArray(attachments) ? attachments : [];
  if (list.length === 0) return { ok: false, reason: "none" };

  let sawOversize = false;
  let sawAnyBytes = false;
  for (const a of list) {
    const bytes = a?.bytes;
    if (!(bytes instanceof Uint8Array) || bytes.length === 0) continue;
    sawAnyBytes = true;

    const img = sniffImageType(bytes);
    const isPdf = sniffIsPdf(bytes);
    if (!img && !isPdf) continue; // not a supported asset — skip, keep scanning

    if (bytes.length > maxBytes) {
      sawOversize = true;
      continue; // a valid-type-but-too-big candidate; remember and keep scanning
    }

    return {
      ok: true,
      attachment: {
        filename: safeFilename(a?.filename, img ?? "application/pdf"),
        mimeType: (img ?? "application/pdf") as SelectedIngestAttachment["mimeType"],
        bytes,
        parseable: img != null, // images parse; PDFs are store-only in v1
      },
    };
  }

  // Had list entries, but none usable: an oversize valid candidate -> "size";
  // some real bytes that sniffed as neither image nor PDF -> "type"; nothing
  // with any bytes at all -> "none" (empty/zero-byte entries behave as absent).
  if (sawOversize) return { ok: false, reason: "size" };
  return sawAnyBytes ? { ok: false, reason: "type" } : { ok: false, reason: "none" };
}

function safeFilename(name: unknown, mime: string): string {
  const ext =
    mime === "image/jpeg" ? "jpg" :
    mime === "image/png" ? "png" :
    mime === "image/webp" ? "webp" :
    mime === "image/gif" ? "gif" : "pdf";
  if (typeof name === "string") {
    const base = name.split(/[\\/]/).pop()?.trim();
    if (base && /\.[a-z0-9]{1,5}$/i.test(base) && base.length <= 200) return base;
  }
  return `capture.${ext}`;
}

// ---------------------------------------------------------------------------
// Abuse / loop drop (layer 5). Never auto-respond to a bot, a bounce, or a
// mailing list — that is how mail loops and amplification happen.
// ---------------------------------------------------------------------------

/** The minimal header shape the loop check reads (case-insensitive keys handled
 * by the route before calling; here keys are assumed already-lowercased). */
export type IngestLoopHeaders = {
  from?: string | null;
  ["auto-submitted"]?: string | null;
  precedence?: string | null;
  ["x-autoreply"]?: string | null;
  ["x-autorespond"]?: string | null;
};

const LOOP_SENDER_RE =
  /(mailer-daemon|postmaster|no[-_.]?reply|noreply|do[-_.]?not[-_.]?reply|bounce|notifications?@)/i;

/**
 * Should this message be dropped as an auto-reply / bounce / list mail / loop?
 *   - Auto-Submitted present and not "no" (RFC 3834: auto-generated/auto-replied)
 *   - Precedence: bulk | list | junk
 *   - X-Autoreply / X-Autorespond present
 *   - From is a daemon/no-reply/bounce-style address
 */
export function isAutoReplyOrLoop(headers: IngestLoopHeaders | null | undefined): boolean {
  if (!headers) return false;
  const auto = (headers["auto-submitted"] ?? "").trim().toLowerCase();
  if (auto && auto !== "no") return true;
  const prec = (headers.precedence ?? "").trim().toLowerCase();
  if (prec === "bulk" || prec === "list" || prec === "junk") return true;
  if ((headers["x-autoreply"] ?? "").trim()) return true;
  if ((headers["x-autorespond"] ?? "").trim()) return true;
  const from = headers.from ?? "";
  if (typeof from === "string" && LOOP_SENDER_RE.test(from)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Webhook authenticity (layer 1) + idempotency (layer 6).
// ---------------------------------------------------------------------------

/**
 * Constant-time comparison of a provider-supplied shared secret (the Basic-Auth
 * / bearer credential we configure on the webhook URL) against the expected
 * value. Length-mismatch and any non-string fail closed. This is the default,
 * provider-agnostic verifier; a Mailgun HMAC verifier can slot beside it without
 * changing the route's call site (it stays a boolean predicate).
 */
export function verifyIngestSecret(
  provided: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!expected || typeof provided !== "string" || provided.length === 0) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Extract the bearer/basic credential a provider sends. Supports
 * "Authorization: Bearer <x>" and "Authorization: Basic <base64(user:pass)>"
 * (returns the password half — Postmark's inbound Basic-Auth model) and a raw
 * "?key=" style value passed straight through. Returns null if absent. */
export function readIngestSecretFromAuth(authHeader: unknown): string | null {
  if (typeof authHeader !== "string") return null;
  const v = authHeader.trim();
  if (!v) return null;
  const bearer = v.match(/^Bearer\s+(.+)$/i);
  if (bearer) return bearer[1].trim();
  const basic = v.match(/^Basic\s+(.+)$/i);
  if (basic) {
    try {
      const decoded = Buffer.from(basic[1].trim(), "base64").toString("utf8");
      const colon = decoded.indexOf(":");
      return colon >= 0 ? decoded.slice(colon + 1) : decoded;
    } catch {
      return null;
    }
  }
  return v; // a raw secret passed as the whole header value
}

/**
 * A stable dedupe key for an inbound message so a provider retry (or a deliberate
 * replay) does not create a second capture. Hash so we never store a raw
 * provider message-id. Falls back to hashing the From+token+size when no
 * message-id is present.
 */
export function ingestDedupeKey(
  provider: string,
  messageId: string | null | undefined,
  fallback?: string,
): string {
  const basis =
    messageId && messageId.trim()
      ? `${provider}:mid:${messageId.trim()}`
      : `${provider}:fb:${fallback ?? ""}`;
  return createHash("sha256").update(basis).digest("hex");
}

// ---------------------------------------------------------------------------
// The composed decision — one call the route makes after decoding attachments.
// Returns exactly what the route should DO, so the security policy lives here
// (tested) and the route is thin glue.
// ---------------------------------------------------------------------------

export type IngestChannel = "email" | "sms";

export type IngestDecisionInput = {
  channel: IngestChannel;
  /** verified by the route already (verifyIngestSecret). */
  authenticated: boolean;
  /** the org resolved from the recipient token, or null if unknown/inactive. */
  orgResolved: boolean;
  /** the message From (email address or phone). */
  from: unknown;
  /** the org's verified senders for this channel. */
  allowlist: unknown[];
  /** loop/auto-reply headers (email). */
  loopHeaders?: IngestLoopHeaders | null;
  /** decoded attachments. */
  attachments: IngestAttachmentInput[] | null | undefined;
};

export type IngestDecision =
  | { action: "reject"; status: 401; reason: "unauthenticated" }
  | { action: "drop"; reason: "unknown_token" | "loop" | "no_attachment" }
  | { action: "quarantine"; reason: "unknown_sender" }
  | { action: "reject_attachment"; reason: "type" | "size" }
  | { action: "accept"; attachment: SelectedIngestAttachment };

/**
 * The full ingress policy in one deterministic function. Order matters (fail
 * closed, cheapest/safest checks first):
 *   1. not authenticated            -> reject 401 (a forged POST)
 *   2. unknown/inactive token       -> drop (200 no-op; don't retry-storm, don't
 *                                      reveal which tokens exist)
 *   3. auto-reply / loop            -> drop (never engage a bot/bounce)
 *   4. sender not on allow-list     -> quarantine (record, prompt to verify;
 *                                      never a usable capture, never bounce)
 *   5. no/invalid attachment        -> drop or reject_attachment(type|size)
 *   6. all clear                    -> accept(attachment)
 * The body is never consulted.
 */
export function decideIngest(input: IngestDecisionInput): IngestDecision {
  if (!input.authenticated) {
    return { action: "reject", status: 401, reason: "unauthenticated" };
  }
  if (!input.orgResolved) {
    return { action: "drop", reason: "unknown_token" };
  }
  if (input.channel === "email" && isAutoReplyOrLoop(input.loopHeaders)) {
    return { action: "drop", reason: "loop" };
  }
  const senderOk =
    input.channel === "sms"
      ? isAllowedSenderPhone(input.from, input.allowlist)
      : isAllowedSenderEmail(input.from, input.allowlist);
  if (!senderOk) {
    return { action: "quarantine", reason: "unknown_sender" };
  }
  const picked = selectIngestAttachment(input.attachments);
  if (!picked.ok) {
    if (picked.reason === "none") return { action: "drop", reason: "no_attachment" };
    return { action: "reject_attachment", reason: picked.reason };
  }
  return { action: "accept", attachment: picked.attachment };
}
