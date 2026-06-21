// Pure Ontario N1 (Notice of Rent Increase) renderer — N1 PDF pre-fill (S284).
//
// The rent-increase engine (lib/rent-increase.ts) already computes WHEN the next
// legal increase can take effect, by WHEN the N1 must be served, the guideline %
// and the new rent — but the per-tenancy card only LINKED to the blank government
// form, leaving the operator to hand-copy every value. This module closes the
// "act" loop: it renders a faithful, PRE-FILLED Form N1 the operator opens, reviews,
// completes the few remaining by-hand fields (landlord mailing address, signature),
// and Prints → Saves as PDF to serve the tenant.
//
// Render-path choice mirrors lib/lease-render.ts: print-optimized standalone HTML,
// NOT server-generated PDF bytes. The repo has zero render dependencies and ships on
// Vercel; a true PDF would need Chromium (won't build cleanly) or a heavy JS PDF lib.
// Printable HTML + the browser's Print → Save as PDF is the lowest-risk artifact and
// is exactly the pattern already used for the lease document.
//
// PURE + HTML-escaped + no I/O, so it is unit-testable and safe to render server-side.
//
// Scope: a GUIDELINE-increase N1 pre-fill only. Out of scope: above-guideline (AGI)
// applications; auto-bumping rent in Stripe/Rotessa; e-signing the N1 (the legal-gated
// tail). The document is a working copy for the operator to verify against the official
// LTB form before serving — never a substitute for legal advice.

export type N1RenderModel = {
  // The landlord party (organizations.name).
  landlordName: string;
  // Public contact info, pre-filled into the signature block when available.
  landlordPhone: string | null;
  landlordEmail: string | null;
  // Every tenant on the tenancy, primary first.
  tenantNames: string[];
  // The rental unit address (properties.address); a single freeform string.
  rentalUnitAddress: string | null;
  // Current lawful rent, already $-formatted upstream (e.g. "$1,500").
  currentRent: string | null;
  // New rent after the increase, $-formatted; null when not computable (exempt
  // unit → the guideline cap doesn't apply, so the amount is entered by hand).
  newRent: string | null;
  // The dollar increase, $-formatted; null alongside newRent.
  increaseAmount: string | null;
  // The guideline percent for the effective year; null when exempt / unpublished.
  guidelinePercent: number | null;
  // The first day the new rent is payable (ISO YYYY-MM-DD).
  effectiveDate: string | null;
  // Serve the N1 on or before this date to hit effectiveDate (ISO YYYY-MM-DD).
  serveByDate: string | null;
  // Post-2018-11-15 rent-control exemption (guideline cap doesn't apply).
  exempt: boolean;
  // When this working copy was generated (ISO); shown in the footer.
  generatedAtIso: string;
};

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// "2027-03-01" → "March 1, 2027". Parsed as UTC to avoid TZ drift; an unparseable
// or null value renders as the supplied string (or a blank fill line via caller).
export function formatLongDate(iso: string | null): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return iso;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return iso;
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

// A pre-filled value or, when absent, an underlined blank for the operator to
// complete by hand on the printed form.
function filled(value: string | null | undefined): string {
  const v = value && value.trim() ? value.trim() : "";
  return v
    ? `<span class="val">${escapeHtml(v)}</span>`
    : `<span class="blank">&nbsp;</span>`;
}

function box(checked: boolean): string {
  return `<span class="box">${checked ? "&#10003;" : "&nbsp;"}</span>`;
}

/**
 * Render a complete, standalone, print-optimized HTML Form N1 (Notice of Rent
 * Increase). Pure: given the same model it always returns the same string. The
 * output is a full HTML page (doctype + inline print CSS) so a route handler can
 * return it directly and the operator can Print → Save as PDF with no client JS.
 */
export function renderN1Html(model: N1RenderModel): string {
  const generated = (() => {
    const d = new Date(model.generatedAtIso);
    return isNaN(d.getTime())
      ? escapeHtml(model.generatedAtIso)
      : escapeHtml(d.toISOString().slice(0, 10));
  })();

  const tenants = model.tenantNames
    .map((n) => n.trim())
    .filter((n) => n.length > 0);
  const tenantLine = tenants.length ? tenants.join(", ") : null;

  const effective = formatLongDate(model.effectiveDate);
  const serveBy = formatLongDate(model.serveByDate);

  const pct =
    model.guidelinePercent != null ? `${model.guidelinePercent}%` : null;

  // The increase basis: a guideline increase (the only kind this pre-fill builds)
  // is checked when an amount is computable; exempt units leave it for the operator.
  const guidelineChecked = !model.exempt && model.newRent != null;

  const reviewBanner = `<div class="banner review">WORKING COPY &mdash; review every field, complete the landlord mailing address and signature, then verify against the official LTB Form N1 before serving. This is not legal advice.</div>`;

  const exemptNote = model.exempt
    ? `<div class="banner warn">This unit appears exempt from the guideline cap (first occupied after Nov 15, 2018). Enter the new rent you intend to charge and confirm any notice your tenancy agreement requires.</div>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Form N1 — Notice of Rent Increase${
    model.rentalUnitAddress ? " — " + escapeHtml(model.rentalUnitAddress) : ""
  }</title>
<style>
  :root { --ink: #1a1a1a; --muted: #555; --line: #cfcfcf; }
  * { box-sizing: border-box; }
  body { font-family: Georgia, "Times New Roman", serif; color: var(--ink);
    line-height: 1.5; margin: 0; background: #f4f4f5; }
  .sheet { max-width: 7.5in; margin: 24px auto; background: #fff; padding: 0.9in 0.85in;
    box-shadow: 0 1px 6px rgba(0,0,0,0.12); }
  .formno { font-family: Arial, sans-serif; font-size: 12px; letter-spacing: 0.08em;
    text-transform: uppercase; color: var(--muted); margin: 0 0 2px; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  .sub { color: var(--muted); font-size: 13px; margin: 0 0 18px; }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.04em;
    border-bottom: 1px solid var(--line); padding-bottom: 4px; margin: 22px 0 10px; }
  p { font-size: 14px; margin: 8px 0; }
  table.terms { width: 100%; border-collapse: collapse; font-size: 14px; }
  table.terms th { text-align: left; width: 38%; vertical-align: top; padding: 5px 8px 5px 0;
    color: var(--muted); font-weight: normal; }
  table.terms td { padding: 5px 0; }
  .val { font-weight: bold; }
  .blank { display: inline-block; min-width: 180px; border-bottom: 1px solid var(--ink); }
  .box { display: inline-block; width: 15px; height: 15px; border: 1px solid var(--ink);
    text-align: center; line-height: 14px; font-size: 12px; margin-right: 6px;
    font-family: Arial, sans-serif; vertical-align: -2px; }
  .choice { font-size: 14px; margin: 8px 0; }
  .banner { border-radius: 6px; padding: 8px 12px; font-family: Arial, sans-serif;
    font-size: 12px; margin: 0 0 14px; }
  .banner.review { background: #fff7ed; border: 1px solid #fed7aa; color: #9a3412; font-weight: bold; }
  .banner.warn { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; }
  .sigs { display: flex; flex-wrap: wrap; gap: 28px 40px; margin-top: 14px; }
  .sig { flex: 1 1 240px; min-width: 220px; }
  .sig-line { border-bottom: 1px solid var(--ink); height: 26px; }
  .sig-meta { display: flex; justify-content: space-between; font-family: Arial, sans-serif;
    font-size: 11px; color: var(--muted); margin-top: 3px; }
  .sig-val { font-size: 13px; margin-top: 6px; }
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
  <p class="formno">Form N1 &middot; Residential Tenancies Act, 2006</p>
  <h1>Notice of Rent Increase</h1>
  <p class="sub">Landlord and Tenant Board (Ontario)</p>

  ${reviewBanner}
  ${exemptNote}

  <h2>To the Tenant(s)</h2>
  <table class="terms">
    <tr><th>Tenant name(s)</th><td>${filled(tenantLine)}</td></tr>
    <tr><th>Address of the rental unit</th><td>${filled(model.rentalUnitAddress)}</td></tr>
  </table>

  <h2>From the Landlord</h2>
  <table class="terms">
    <tr><th>Landlord name</th><td>${filled(model.landlordName)}</td></tr>
    <tr><th>Phone</th><td>${filled(model.landlordPhone)}</td></tr>
    <tr><th>Email</th><td>${filled(model.landlordEmail)}</td></tr>
    <tr><th>Landlord mailing address</th><td>${filled(null)}</td></tr>
  </table>

  <h2>Rent Increase</h2>
  <p>This is a notice that your rent will increase.</p>
  <table class="terms">
    <tr><th>Your current rent is</th><td>${filled(model.currentRent)} per month</td></tr>
    <tr><th>Your new rent will be</th><td>${filled(model.newRent)} per month</td></tr>
    <tr><th>The amount of the increase is</th><td>${filled(model.increaseAmount)}${
      pct ? ` &nbsp;(${escapeHtml(pct)})` : ""
    }</td></tr>
    <tr><th>The first new rent payment is due on</th><td>${filled(effective)}</td></tr>
  </table>

  <h2>How this increase is allowed</h2>
  <p class="choice">${box(
    guidelineChecked,
  )} This rent increase is equal to or less than the rent increase guideline${
    pct ? ` of ${escapeHtml(pct)}` : ""
  } and is allowed under the Residential Tenancies Act, 2006.</p>
  <p class="choice">${box(
    false,
  )} The Landlord and Tenant Board has approved this increase above the guideline (attach the order).</p>
  <p class="choice">${box(
    false,
  )} This increase is allowed because of a notice or agreement (e.g. a new or additional service).</p>

  <h2>Important — notice period</h2>
  <p>The landlord must give this notice at least 90 days before the increase takes effect.${
    serveBy
      ? ` To take effect on ${escapeHtml(
          effective ?? "",
        )}, this notice should be served on or before <strong>${escapeHtml(
          serveBy,
        )}</strong>.`
      : ""
  } The rent can be increased only once every 12 months.</p>

  <h2>Signature</h2>
  <div class="sigs">
    <div class="sig">
      <div class="sig-line">&nbsp;</div>
      <div class="sig-meta"><span>Signature of Landlord or Agent</span><span>Date</span></div>
      <div class="sig-val">${filled(model.landlordName)}</div>
    </div>
    <div class="sig">
      <div class="sig-line">&nbsp;</div>
      <div class="sig-meta"><span>Phone number</span><span></span></div>
      <div class="sig-val">${filled(model.landlordPhone)}</div>
    </div>
  </div>

  <p class="foot">
    Pre-filled by Vacantless on ${generated} from your tenancy record. Confirm every field
    against the official LTB Form N1 (tribunalsontario.ca) before serving. Guideline amounts
    follow the Ontario rent-increase guideline; above-guideline increases require a Board order.
    This document is not legal advice.
  </p>
</div>
</body>
</html>`;
}
