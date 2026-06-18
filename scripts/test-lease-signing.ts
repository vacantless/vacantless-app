// Unit tests for the homegrown ECA-2000 e-sign domain logic (lib/lease-signing).
// Run: npx tsx scripts/test-lease-signing.ts
import {
  generateSignToken,
  hashDocument,
  deriveSigners,
  validateSignature,
  isLeaseFullyExecuted,
  pendingSignerCount,
  nextLeaseStatusAfterSign,
  canWithdraw,
  renderAuditCertificateHtml,
  isSignerRole,
  type AuditCertificateModel,
} from "../lib/lease-signing";

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error("  ✗ " + msg);
  }
}

// --- generateSignToken -------------------------------------------------------
{
  const a = generateSignToken();
  const b = generateSignToken();
  assert(a !== b, "two tokens differ");
  assert(a.length >= 30, "token is long (>=30 chars)");
  assert(/^[A-Za-z0-9_-]+$/.test(a), "token is url-safe (base64url charset only)");
  const many = new Set(Array.from({ length: 500 }, () => generateSignToken()));
  assert(many.size === 500, "500 tokens are all unique");
}

// --- hashDocument ------------------------------------------------------------
{
  const h1 = hashDocument("<html>lease A</html>");
  const h2 = hashDocument("<html>lease A</html>");
  const h3 = hashDocument("<html>lease B</html>");
  assert(h1 === h2, "hash is deterministic for identical input");
  assert(h1 !== h3, "hash changes when the document changes (tamper-evidence)");
  assert(/^[0-9a-f]{64}$/.test(h1), "hash is 64 hex chars (SHA-256)");
}

// --- deriveSigners -----------------------------------------------------------
{
  const signers = deriveSigners("Agile Real Estate Group", "landlord@agile.ca", [
    { name: "Sam Cotenant", email: "sam@x.com", is_primary: false },
    { name: "Dana Primary", email: "dana@x.com", is_primary: true },
  ]);
  assert(signers.length === 3, "landlord + 2 tenants = 3 signers");
  assert(signers[0].role === "landlord", "landlord is first");
  assert(signers[0].email === "landlord@agile.ca", "landlord email carried");
  assert(signers[1].name === "Dana Primary", "primary tenant before co-tenant");
  assert(signers[2].name === "Sam Cotenant", "co-tenant after primary");
  assert(
    signers[0].sign_order === 1 && signers[1].sign_order === 2 && signers[2].sign_order === 3,
    "sign_order is sequential from 1",
  );
}
{
  // tenants with neither name nor email are dropped (nothing to address/attest).
  const signers = deriveSigners("Org", null, [
    { name: "  ", email: null, is_primary: true },
    { name: null, email: "real@x.com", is_primary: false },
  ]);
  assert(signers.length === 2, "blank tenant dropped; email-only tenant kept");
  assert(signers[1].email === "real@x.com", "email-only tenant retained");
  assert(signers[0].role === "landlord" && signers[0].email === null, "landlord kept even with null email");
}
{
  const signers = deriveSigners("Org", null, []);
  assert(signers.length === 1 && signers[0].role === "landlord", "no tenants → landlord-only");
}

// --- validateSignature (mirrors the SQL RPC) ---------------------------------
{
  const ok = validateSignature({
    signedName: "Dana Tenant",
    consent: true,
    signatureKind: "typed",
    signatureData: "Dana Tenant",
  });
  assert(ok.ok === true, "valid submission passes");

  const noConsent = validateSignature({
    signedName: "Dana",
    consent: false,
    signatureKind: "typed",
    signatureData: "Dana",
  });
  assert(noConsent.ok === false && noConsent.reason === "consent_required", "consent required");

  const noName = validateSignature({
    signedName: "   ",
    consent: true,
    signatureKind: "drawn",
    signatureData: "data:image/png;base64,xxx",
  });
  assert(noName.ok === false && noName.reason === "name_required", "name required");

  const badKind = validateSignature({
    signedName: "Dana",
    consent: true,
    signatureKind: "scribbled",
    signatureData: "x",
  });
  assert(badKind.ok === false && badKind.reason === "bad_kind", "bad signature kind rejected");

  const noSig = validateSignature({
    signedName: "Dana",
    consent: true,
    signatureKind: "drawn",
    signatureData: "",
  });
  assert(noSig.ok === false && noSig.reason === "signature_required", "signature payload required");
}

// --- state machine -----------------------------------------------------------
{
  const allSigned = [{ status: "signed" }, { status: "signed" }];
  const partial = [{ status: "signed" }, { status: "pending" }];
  const none = [{ status: "pending" }, { status: "pending" }];

  assert(isLeaseFullyExecuted(allSigned), "all signed → fully executed");
  assert(!isLeaseFullyExecuted(partial), "partial → not executed");
  assert(!isLeaseFullyExecuted([]), "empty signer set → not executed");

  assert(pendingSignerCount(partial) === 1, "one pending in partial");
  assert(pendingSignerCount(allSigned) === 0, "zero pending when all signed");

  assert(nextLeaseStatusAfterSign(allSigned) === "executed", "all-signed → executed status");
  assert(nextLeaseStatusAfterSign(partial) === "sent", "partial → stays sent");

  assert(canWithdraw("sent", none), "sent + nobody signed → can withdraw");
  assert(!canWithdraw("sent", partial), "sent + someone signed → cannot withdraw");
  assert(!canWithdraw("executed", allSigned), "executed → cannot withdraw");
  assert(!canWithdraw("draft", none), "draft → not in a withdrawable state");
}

// --- isSignerRole ------------------------------------------------------------
assert(isSignerRole("tenant") && isSignerRole("landlord") && isSignerRole("guarantor"), "valid roles");
assert(!isSignerRole("squatter"), "invalid role rejected");

// --- renderAuditCertificateHtml ---------------------------------------------
{
  const base: AuditCertificateModel = {
    leaseTitle: "Residential Lease",
    propertyAddress: "159 Pillette Rd, Unit 22, Windsor ON",
    orgName: "Agile Real Estate Group",
    leaseStatus: "executed",
    documentHash: "a".repeat(64),
    sentAtIso: "2026-06-18T13:00:00.000Z",
    executedAtIso: "2026-06-18T15:30:00.000Z",
    signers: [
      {
        role: "landlord",
        name: "Agile Real Estate Group",
        email: "landlord@agile.ca",
        signedName: "N. Muscovitch",
        status: "signed",
        signatureKind: "typed",
        signedAtIso: "2026-06-18T14:00:00.000Z",
        signerIp: "203.0.113.7",
        userAgent: "Mozilla/5.0 (Macintosh)",
        documentHash: "a".repeat(64),
      },
      {
        role: "tenant",
        name: "Dana Tenant",
        email: "dana@x.com",
        signedName: "Dana Tenant",
        status: "signed",
        signatureKind: "drawn",
        signedAtIso: "2026-06-18T15:30:00.000Z",
        signerIp: "198.51.100.4",
        userAgent: "Mozilla/5.0 (iPhone)",
        documentHash: "a".repeat(64),
      },
    ],
  };
  const html = renderAuditCertificateHtml(base);
  assert(html.startsWith("<!doctype html>"), "certificate is a full HTML document");
  assert(html.includes("Certificate of Completion"), "has the certificate title");
  assert(html.includes("Dana Tenant"), "lists a tenant signer");
  assert(html.includes("203.0.113.7") && html.includes("198.51.100.4"), "captures each signer IP");
  assert(html.includes("a".repeat(64)), "shows the full document hash in the summary");
  assert(html.includes("Executed (all parties signed)"), "executed status text");
  assert(html.includes("Drawn signature") && html.includes("Typed signature"), "shows both signature methods");

  // in-progress wording
  const partial = renderAuditCertificateHtml({
    ...base,
    leaseStatus: "sent",
    executedAtIso: null,
    signers: [
      base.signers[0],
      { ...base.signers[1], status: "pending", signedAtIso: null, signerIp: null },
    ],
  });
  assert(partial.includes("In progress (1 of 2 signed)"), "in-progress count when partial");
  assert(partial.includes("Awaiting signature"), "pending signer shown as awaiting");
}
{
  // XSS: a malicious org/signer name must be escaped in the certificate.
  const html = renderAuditCertificateHtml({
    leaseTitle: "Lease",
    propertyAddress: "<script>alert(1)</script>",
    orgName: "<b>Evil</b>",
    leaseStatus: "executed",
    documentHash: "f".repeat(64),
    sentAtIso: null,
    executedAtIso: null,
    signers: [
      {
        role: "tenant",
        name: "<img src=x onerror=alert(1)>",
        email: "x@x.com",
        signedName: "\"';drop",
        status: "signed",
        signatureKind: "typed",
        signedAtIso: "2026-06-18T15:30:00.000Z",
        signerIp: "1.2.3.4",
        userAgent: "<svg/onload=alert(1)>",
        documentHash: "f".repeat(64),
      },
    ],
  });
  assert(!html.includes("<script>alert(1)</script>"), "raw <script> not present (escaped)");
  assert(html.includes("&lt;script&gt;"), "address script tag escaped");
  assert(!html.includes("<img src=x onerror"), "raw img/onerror not present (escaped)");
  assert(!html.includes("<svg/onload="), "raw svg/onload not present (escaped)");
  assert(html.includes("&lt;b&gt;Evil&lt;/b&gt;"), "org name escaped");
}

// --- report ------------------------------------------------------------------
console.log(`\nlease-signing: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
