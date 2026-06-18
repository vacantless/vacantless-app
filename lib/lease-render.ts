// Pure lease-document renderer (lease vault #11, slice 3 — render-before-sign).
//
// Slice 2 stores only the assembled CLAUSE block (lease_documents.assembled_body)
// — that is the additional-terms text, NOT a usable lease. A signer (homegrown
// ECA-2000 e-sign or DocuSign REST — see VACANTLESS-11-ESIGN-RAIL-SPIKE) and the
// per-person vault both need a rendered DOCUMENT. This module turns the draft +
// the tenancy/party fields into a standalone, print-optimized HTML lease the
// operator can read, print, or Save-as-PDF. Pure + HTML-escaped + no I/O, so it
// is unit-testable and safe to render server-side.
//
// Render path choice (slice 3): print-optimized HTML, NOT server-generated PDF
// bytes. The repo has zero render dependencies and ships on Vercel; a true PDF
// would need Chromium (won't build cleanly) or a heavy JS PDF lib (worse legal
// layout). Printable HTML + the browser's Print → Save as PDF is the lowest-risk
// artifact and is exactly what the signer/vault slices consume next.

import { tokensInBody } from "@/lib/clauses";

export type LeaseRenderModel = {
  // Document title (lease_documents.title), e.g. "Residential Lease".
  title: string;
  // lease_documents.status: draft | sent | executed | void. Drives the banner.
  status: string;
  // When the draft was generated (ISO); shown in the footer.
  generatedAtIso: string;
  // The org/landlord name (organizations.name) — the landlord party.
  landlordName: string;
  // The premises (properties.address); null if the unit was removed.
  propertyAddress: string | null;
  // Every tenant on the tenancy, primary first — each gets a signature block.
  tenantNames: string[];
  // Formatted economic terms (already $-formatted upstream); null = not set.
  rent: string | null;
  deposit: string | null;
  startDate: string | null;
  endDate: string | null;
  // Term length in months; null = month-to-month.
  termMonths: number | null;
  // The assembled, interpolated clause block (lease_documents.assembled_body).
  clauseBody: string;
};

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function termLabel(termMonths: number | null): string {
  if (termMonths == null) return "Month-to-month";
  return `${termMonths} month${termMonths === 1 ? "" : "s"}`;
}

function row(label: string, value: string | null): string {
  const v = value && value.trim() ? escapeHtml(value) : "&mdash;";
  return `<tr><th>${escapeHtml(label)}</th><td>${v}</td></tr>`;
}

// A signature block: signing line + printed-name line + date line. Names are
// pre-filled (printed) but the signature/date lines stay blank for signing —
// this is the deterministic-vs-editable split the rail will tag onto.
function signatureBlock(role: string, name: string | null): string {
  const printed = name && name.trim() ? escapeHtml(name) : "&nbsp;";
  return `<div class="sig">
      <div class="sig-line">&nbsp;</div>
      <div class="sig-meta"><span>${escapeHtml(role)} signature</span><span>Date</span></div>
      <div class="sig-name">${printed}</div>
    </div>`;
}

/**
 * Render a complete, standalone, print-optimized HTML lease document. Pure:
 * given the same model it always returns the same string. The output is a full
 * HTML page (doctype + inline print CSS) so it can be returned directly from a
 * route handler and printed to PDF with no client framework.
 */
export function renderLeaseDocumentHtml(model: LeaseRenderModel): string {
  const isDraft = model.status === "draft";
  const owed = tokensInBody(model.clauseBody);
  const generated = (() => {
    const d = new Date(model.generatedAtIso);
    return isNaN(d.getTime()) ? model.generatedAtIso : d.toISOString().slice(0, 10);
  })();

  const draftBanner = isDraft
    ? `<div class="banner draft">DRAFT &mdash; for review only, not for signature.</div>`
    : "";

  const tokenWarning =
    owed.length > 0
      ? `<div class="banner warn">Unfilled values remain in this lease: ${owed
          .map((t) => `<code>{{${escapeHtml(t)}}}</code>`)
          .join(", ")}. Complete them before sending for signature.</div>`
      : "";

  const tenantBlocks = model.tenantNames.length
    ? model.tenantNames.map((n) => signatureBlock("Tenant", n)).join("\n")
    : signatureBlock("Tenant", null);

  // pre-wrap preserves the clause block's paragraph breaks faithfully.
  const clauseHtml = escapeHtml(model.clauseBody);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(model.title)}${model.propertyAddress ? " — " + escapeHtml(model.propertyAddress) : ""}</title>
<style>
  :root { --ink: #1a1a1a; --muted: #555; --line: #cfcfcf; }
  * { box-sizing: border-box; }
  body { font-family: Georgia, "Times New Roman", serif; color: var(--ink);
    line-height: 1.5; margin: 0; background: #f4f4f5; }
  .sheet { max-width: 7.5in; margin: 24px auto; background: #fff; padding: 0.9in 0.85in;
    box-shadow: 0 1px 6px rgba(0,0,0,0.12); }
  h1 { font-size: 20px; margin: 0 0 2px; }
  .sub { color: var(--muted); font-size: 13px; margin: 0 0 18px; }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.04em;
    border-bottom: 1px solid var(--line); padding-bottom: 4px; margin: 22px 0 10px; }
  table.terms { width: 100%; border-collapse: collapse; font-size: 14px; }
  table.terms th { text-align: left; width: 38%; vertical-align: top; padding: 4px 8px 4px 0;
    color: var(--muted); font-weight: normal; }
  table.terms td { padding: 4px 0; }
  .clauses { white-space: pre-wrap; font-size: 14px; }
  .banner { border-radius: 6px; padding: 8px 12px; font-family: Arial, sans-serif;
    font-size: 12px; margin: 0 0 14px; }
  .banner.draft { background: #fff7ed; border: 1px solid #fed7aa; color: #9a3412; font-weight: bold; }
  .banner.warn { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; }
  .banner code { background: rgba(0,0,0,0.05); padding: 0 3px; border-radius: 3px; }
  .sigs { display: flex; flex-wrap: wrap; gap: 28px 40px; margin-top: 14px; }
  .sig { flex: 1 1 240px; min-width: 220px; }
  .sig-line { border-bottom: 1px solid var(--ink); height: 26px; }
  .sig-meta { display: flex; justify-content: space-between; font-family: Arial, sans-serif;
    font-size: 11px; color: var(--muted); margin-top: 3px; }
  .sig-name { font-size: 13px; margin-top: 6px; }
  .foot { margin-top: 28px; border-top: 1px solid var(--line); padding-top: 10px;
    font-family: Arial, sans-serif; font-size: 11px; color: var(--muted); }
  .print-btn { position: fixed; top: 14px; right: 14px; font-family: Arial, sans-serif;
    font-size: 13px; padding: 8px 14px; border: 1px solid var(--line); border-radius: 6px;
    background: #fff; cursor: pointer; }
  @media print {
    body { background: #fff; }
    .sheet { box-shadow: none; margin: 0; max-width: none; padding: 0; }
    .print-btn { display: none; }
    .sig { break-inside: avoid; }
  }
  @page { margin: 0.8in; }
</style>
</head>
<body>
<button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
<div class="sheet">
  <h1>${escapeHtml(model.title)}</h1>
  <p class="sub">${model.propertyAddress ? escapeHtml(model.propertyAddress) : "Premises not set"}</p>

  ${draftBanner}
  ${tokenWarning}

  <h2>Parties &amp; Premises</h2>
  <table class="terms">
    ${row("Landlord", model.landlordName)}
    ${row("Tenant(s)", model.tenantNames.length ? model.tenantNames.join(", ") : null)}
    ${row("Rental unit", model.propertyAddress)}
  </table>

  <h2>Lease Terms</h2>
  <table class="terms">
    ${row("Monthly rent", model.rent)}
    ${row("Deposit", model.deposit)}
    ${row("Term", termLabel(model.termMonths))}
    ${row("Start date", model.startDate)}
    ${row("End date", model.endDate)}
  </table>

  <h2>Additional Terms</h2>
  <div class="clauses">${clauseHtml}</div>

  <h2>Signatures</h2>
  <div class="sigs">
    ${signatureBlock("Landlord", model.landlordName)}
    ${tenantBlocks}
  </div>

  <p class="foot">
    Generated by ${escapeHtml(model.landlordName)} via Vacantless on ${escapeHtml(generated)}.
    Electronic signatures are legally binding under Ontario's Electronic Commerce Act, 2000,
    provided the document is unaltered, signers are verifiable, and an audit log is retained.
  </p>
</div>
</body>
</html>`;
}
