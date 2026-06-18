// Pure-ish homegrown ECA-2000 e-sign domain logic (lease vault #11, slice 4).
//
// The VACANTLESS-11-ESIGN-RAIL-SPIKE decision LOCKED a homegrown signer over
// DocuSign (parity-not-moat + ~$1.88-$7.20/envelope + wrong account structure).
// This module owns the rail's logic so the server actions + RPC stay thin and
// every rule is unit-testable:
//
//   * token + hash       — the magic-link token and the tamper-evidence hash.
//   * deriveSigners       — who must sign a lease (landlord + each tenant).
//   * validateSignature   — the submission rules (mirrored verbatim in the SQL
//                           RPC; the anon-RPC re-validate rule means BOTH must
//                           agree, so they share this single source of truth).
//   * state machine       — when the LAST signature flips a lease to executed.
//   * audit certificate   — the ECA-2000 "certificate of completion" HTML.
//
// Ontario law (Electronic Commerce Act, 2000): an e-signature binds the standard
// lease + LTB notices if the document is UNALTERED (the hash), signers are
// VERIFIABLE (name/email/IP/UA), and a full AUDIT LOG exists (the certificate).
//
// crypto is only used for token + hash (token generation + SHA-256). Everything
// else is pure string/array work. Node's webcrypto / crypto is available both in
// the route handlers (Node runtime) and the test harness.

import { createHash, randomBytes } from "crypto";
import { escapeHtml } from "@/lib/lease-render";

// --- Signer roles -----------------------------------------------------------

export const SIGNER_ROLES = ["landlord", "tenant", "guarantor"] as const;
export type SignerRole = (typeof SIGNER_ROLES)[number];

export function isSignerRole(v: string): v is SignerRole {
  return (SIGNER_ROLES as readonly string[]).includes(v);
}

// --- Token + tamper-evidence hash -------------------------------------------

/**
 * An unguessable per-signer magic-link token. base64url of 24 random bytes =
 * 32 url-safe chars, ~192 bits — far beyond brute force, and safe in a URL path
 * (no +/= to encode). This is the ONLY handle a tenant ever holds.
 */
export function generateSignToken(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * SHA-256 (hex) of the rendered lease HTML — the tamper-evidence anchor frozen
 * at send time. Deterministic: the same bytes always hash the same, so the
 * signer's attested hash can be checked against the stored document any time.
 */
export function hashDocument(html: string): string {
  return createHash("sha256").update(html, "utf8").digest("hex");
}

// --- Deriving the signer set from a tenancy ---------------------------------

export type TenantLike = { name: string | null; email: string | null; is_primary: boolean };

export type SignerSpec = {
  role: SignerRole;
  name: string | null;
  email: string | null;
  sign_order: number;
};

/**
 * Who must sign a lease: the landlord (the org) first, then every tenant on the
 * tenancy, primary tenant first. Pure — the action layers a token onto each.
 * Tenants with no usable name AND no email are dropped (nothing to address a
 * magic-link to and no identity to attest).
 */
export function deriveSigners(
  landlordName: string | null,
  landlordEmail: string | null,
  tenants: TenantLike[],
): SignerSpec[] {
  const out: SignerSpec[] = [
    { role: "landlord", name: landlordName, email: landlordEmail, sign_order: 1 },
  ];
  const ordered = tenants
    .slice()
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
    .filter((t) => (t.name && t.name.trim()) || (t.email && t.email.trim()));
  ordered.forEach((t, i) => {
    out.push({
      role: "tenant",
      name: t.name?.trim() || null,
      email: t.email?.trim() || null,
      sign_order: i + 2,
    });
  });
  return out;
}

// --- Submission validation (shared with the SQL RPC) ------------------------

export const SIGNATURE_KINDS = ["typed", "drawn"] as const;
export type SignatureKind = (typeof SIGNATURE_KINDS)[number];

export type SignatureSubmission = {
  signedName: string | null | undefined;
  consent: boolean | null | undefined;
  signatureKind: string | null | undefined;
  signatureData: string | null | undefined;
};

export type ValidationResult = { ok: true } | { ok: false; reason: string };

/**
 * Validate a signature submission. The SQL RPC re-checks each of these (the
 * anon-RPC rule), so the reason strings are kept identical on both sides.
 */
export function validateSignature(s: SignatureSubmission): ValidationResult {
  if (s.consent !== true) return { ok: false, reason: "consent_required" };
  if (!s.signedName || !s.signedName.trim()) return { ok: false, reason: "name_required" };
  if (!s.signatureKind || !(SIGNATURE_KINDS as readonly string[]).includes(s.signatureKind))
    return { ok: false, reason: "bad_kind" };
  if (!s.signatureData || !s.signatureData.trim())
    return { ok: false, reason: "signature_required" };
  return { ok: true };
}

// --- Signing state machine --------------------------------------------------

export type SignerStatusLike = { status: string };

/** Every required signer has signed. */
export function isLeaseFullyExecuted(signers: SignerStatusLike[]): boolean {
  return signers.length > 0 && signers.every((s) => s.status === "signed");
}

/** Count of signers still owing a signature. */
export function pendingSignerCount(signers: SignerStatusLike[]): number {
  return signers.filter((s) => s.status !== "signed").length;
}

/**
 * The lease status implied by the signer set: 'executed' once all have signed,
 * otherwise 'sent'. (The DB does this atomically inside sign_lease_document; this
 * mirror lets the UI + tests reason about it without a round-trip.)
 */
export function nextLeaseStatusAfterSign(signers: SignerStatusLike[]): "sent" | "executed" {
  return isLeaseFullyExecuted(signers) ? "executed" : "sent";
}

/**
 * Whether a sent lease can still be WITHDRAWN to draft for correction. Only
 * while NO ONE has signed — after any signature the document is frozen
 * (tamper-evidence), so a correction must become a new version + reissue.
 */
export function canWithdraw(leaseStatus: string, signers: SignerStatusLike[]): boolean {
  return leaseStatus === "sent" && signers.every((s) => s.status !== "signed");
}

// --- Audit certificate (ECA-2000 certificate of completion) -----------------

export type AuditSigner = {
  role: string;
  name: string | null;
  email: string | null;
  signedName: string | null;
  status: string;
  signatureKind: string | null;
  signedAtIso: string | null;
  signerIp: string | null;
  userAgent: string | null;
  documentHash: string | null;
};

export type AuditCertificateModel = {
  leaseTitle: string;
  propertyAddress: string | null;
  orgName: string;
  leaseStatus: string;
  documentHash: string | null;
  sentAtIso: string | null;
  executedAtIso: string | null;
  signers: AuditSigner[];
};

function fmtTs(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  // ISO-ish, second precision, UTC-explicit — an audit log wants no ambiguity.
  return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function roleLabel(role: string): string {
  if (role === "landlord") return "Landlord";
  if (role === "tenant") return "Tenant";
  if (role === "guarantor") return "Guarantor";
  return role;
}

/**
 * Render the ECA-2000 certificate of completion as standalone, print-optimized
 * HTML (same artifact strategy as lib/lease-render: printable HTML, no PDF dep).
 * Pure + every interpolated value HTML-escaped. This is the binding audit record
 * — the rendered lease shows the agreement; this shows WHO signed it, WHEN, FROM
 * WHERE, and AGAINST WHICH document hash.
 */
export function renderAuditCertificateHtml(m: AuditCertificateModel): string {
  const signed = m.signers.filter((s) => s.status === "signed").length;
  const total = m.signers.length;

  const rows = m.signers
    .map((s) => {
      const sigStatus =
        s.status === "signed"
          ? `<span class="ok">Signed</span>`
          : `<span class="pending">Awaiting signature</span>`;
      return `<div class="signer">
      <div class="signer-head">
        <span class="role">${escapeHtml(roleLabel(s.role))}</span>
        ${sigStatus}
      </div>
      <table class="kv">
        ${kv("Name on record", s.name)}
        ${kv("Email", s.email)}
        ${kv("Signed as", s.signedName)}
        ${kv("Method", s.signatureKind === "drawn" ? "Drawn signature" : s.signatureKind === "typed" ? "Typed signature" : null)}
        ${kv("Signed at", s.signedAtIso ? fmtTs(s.signedAtIso) : null)}
        ${kv("IP address", s.signerIp)}
        ${kv("Device / browser", s.userAgent)}
        ${kv("Document hash attested", s.documentHash ? shortHash(s.documentHash) : null)}
      </table>
    </div>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Certificate of Completion${m.propertyAddress ? " — " + escapeHtml(m.propertyAddress) : ""}</title>
<style>
  :root { --ink:#1a1a1a; --muted:#555; --line:#cfcfcf; --ok:#15803d; --pending:#92400e; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: var(--ink); line-height: 1.5;
    margin: 0; background: #f4f4f5; }
  .sheet { max-width: 7.5in; margin: 24px auto; background: #fff; padding: 0.9in 0.85in;
    box-shadow: 0 1px 6px rgba(0,0,0,0.12); }
  h1 { font-size: 19px; margin: 0 0 2px; }
  .sub { color: var(--muted); font-size: 13px; margin: 0 0 4px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em;
    border-bottom: 1px solid var(--line); padding-bottom: 4px; margin: 22px 0 10px; }
  table.kv { width: 100%; border-collapse: collapse; font-size: 13px; }
  table.kv th { text-align: left; width: 42%; vertical-align: top; padding: 3px 8px 3px 0;
    color: var(--muted); font-weight: normal; }
  table.kv td { padding: 3px 0; word-break: break-word; }
  .summary { width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 4px; }
  .summary th { text-align: left; width: 42%; color: var(--muted); font-weight: normal; padding: 3px 8px 3px 0; vertical-align: top; }
  .summary td { padding: 3px 0; word-break: break-word; }
  .signer { border: 1px solid var(--line); border-radius: 6px; padding: 12px 14px; margin: 0 0 12px; }
  .signer-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
  .role { font-weight: bold; font-size: 14px; }
  .ok { color: var(--ok); font-weight: bold; font-size: 12px; }
  .pending { color: var(--pending); font-weight: bold; font-size: 12px; }
  code { font-family: "SFMono-Regular", Consolas, monospace; font-size: 12px; }
  .foot { margin-top: 24px; border-top: 1px solid var(--line); padding-top: 10px;
    font-size: 11px; color: var(--muted); }
  .print-btn { position: fixed; top: 14px; right: 14px; font-size: 13px; padding: 8px 14px;
    border: 1px solid var(--line); border-radius: 6px; background: #fff; cursor: pointer; }
  @media print { body { background:#fff; } .sheet { box-shadow:none; margin:0; max-width:none; padding:0; } .print-btn { display:none; } .signer { break-inside: avoid; } }
  @page { margin: 0.8in; }
</style>
</head>
<body>
<button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
<div class="sheet">
  <h1>Certificate of Completion</h1>
  <p class="sub">${escapeHtml(m.leaseTitle)}${m.propertyAddress ? " — " + escapeHtml(m.propertyAddress) : ""}</p>

  <h2>Document</h2>
  <table class="summary">
    ${kvRow("Landlord", m.orgName)}
    ${kvRow("Status", m.leaseStatus === "executed" ? "Executed (all parties signed)" : `In progress (${signed} of ${total} signed)`)}
    ${kvRow("Sent for signature", m.sentAtIso ? fmtTs(m.sentAtIso) : null)}
    ${kvRow("Completed", m.executedAtIso ? fmtTs(m.executedAtIso) : null)}
    ${kvRow("Document hash (SHA-256)", m.documentHash ? `<code>${escapeHtml(m.documentHash)}</code>` : null, true)}
  </table>

  <h2>Signers</h2>
  ${rows || `<p class="sub">No signers recorded.</p>`}

  <p class="foot">
    This certificate is the audit record for the electronically signed document above.
    Electronic signatures are legally binding under Ontario's Electronic Commerce Act, 2000,
    provided the document is unaltered, the signers are verifiable, and a full audit log is
    retained. The document hash above is the SHA-256 of the lease as presented to each signer;
    any change to the document would change this hash. Generated by ${escapeHtml(m.orgName)} via Vacantless.
  </p>
</div>
</body>
</html>`;
}

// key/value row for the per-signer table; value HTML-escaped unless raw.
function kv(label: string, value: string | null): string {
  const v = value && value.trim() ? escapeHtml(value) : "&mdash;";
  return `<tr><th>${escapeHtml(label)}</th><td>${v}</td></tr>`;
}
// key/value row for the summary table; `raw` lets a pre-escaped <code> through.
function kvRow(label: string, value: string | null, raw = false): string {
  const v = value && value.trim() ? (raw ? value : escapeHtml(value)) : "&mdash;";
  return `<tr><th>${escapeHtml(label)}</th><td>${v}</td></tr>`;
}
// a hash is long; show a head…tail in the per-signer table but keep it verifiable.
function shortHash(h: string): string {
  return h.length > 20 ? `${h.slice(0, 10)}…${h.slice(-8)}` : h;
}
