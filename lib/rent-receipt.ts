// Pure annual rent-receipt ("Statement of Rent Paid") builder + renderer (S382).
//
// A tenant needs a year-end record of rent paid for taxes (in Ontario, the rent
// total feeds the Ontario Trillium Benefit / OEPTC, and a landlord must provide a
// rent receipt free on request under the Residential Tenancies Act). The data is
// already captured in the rent_payments ledger (0032); this turns a calendar
// year's payments into a faithful, printable receipt.
//
// Render-path choice mirrors lib/n1-render.ts: a print-optimized standalone HTML
// document the operator opens, reviews, and Prints -> Saves as PDF. No server PDF
// renderer (Chromium / heavy JS lib) is introduced — the repo ships on Vercel and
// this matches the N1 + lease print pattern exactly.
//
// PURE + HTML-escaped + no I/O, so it is unit-testable and safe to render
// server-side. The route handler (app/dashboard/tenancies/[id]/receipt/route.ts)
// supplies the data via RLS-scoped queries.

import { escapeHtml, formatLongDate } from "./n1-render";
import { formatMoneyCents, paymentMethodLabel } from "./payments";

/** The minimal payment shape the receipt needs (a subset of a rent_payments row). */
export type RentReceiptPayment = {
  amount_cents: number;
  method: string;
  paid_on: string; // 'YYYY-MM-DD'
  period_month: string | null; // 'YYYY-MM-DD' (first of the rent month) or null
  reference: string | null;
  note: string | null;
};

export type RentReceiptModel = {
  landlordName: string;
  landlordPhone: string | null;
  landlordEmail: string | null;
  tenantNames: string[];
  rentalUnitAddress: string | null;
  year: number;
  payments: RentReceiptPayment[]; // sorted ascending by paid_on
  totalCents: number;
  count: number;
  firstPaidOn: string | null;
  lastPaidOn: string | null;
  generatedAtIso: string;
};

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** The 4-digit year of a 'YYYY-MM-DD' string, or null if malformed. */
export function paymentYear(paidOn: string | null | undefined): number | null {
  if (!paidOn) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(paidOn.trim());
  if (!m) return null;
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return Number(m[1]);
}

/** Payments whose paid_on falls in `year`, sorted ascending by paid_on. */
export function paymentsInYear(
  payments: RentReceiptPayment[],
  year: number,
): RentReceiptPayment[] {
  return payments
    .filter((p) => paymentYear(p.paid_on) === year)
    .slice()
    .sort((a, b) => a.paid_on.localeCompare(b.paid_on));
}

/** Sum of amount_cents across the given payments. */
export function sumPaymentsCents(payments: RentReceiptPayment[]): number {
  return payments.reduce((acc, p) => acc + (p.amount_cents || 0), 0);
}

/** Distinct years that have at least one payment, most recent first. */
export function availableReceiptYears(payments: RentReceiptPayment[]): number[] {
  const years = new Set<number>();
  for (const p of payments) {
    const y = paymentYear(p.paid_on);
    if (y != null) years.add(y);
  }
  return Array.from(years).sort((a, b) => b - a);
}

/** The year a receipt should default to: the most recent year with payments,
 *  else the supplied current year (so the picker has a sensible default). */
export function defaultReceiptYear(
  payments: RentReceiptPayment[],
  currentYear: number,
): number {
  const years = availableReceiptYears(payments);
  return years.length > 0 ? years[0] : currentYear;
}

/** Assemble the render model for one calendar year from the full ledger. */
export function buildRentReceiptModel(args: {
  landlordName: string;
  landlordPhone: string | null;
  landlordEmail: string | null;
  tenantNames: string[];
  rentalUnitAddress: string | null;
  year: number;
  payments: RentReceiptPayment[];
  generatedAtIso: string;
}): RentReceiptModel {
  const yearPayments = paymentsInYear(args.payments, args.year);
  return {
    landlordName: args.landlordName,
    landlordPhone: args.landlordPhone,
    landlordEmail: args.landlordEmail,
    tenantNames: args.tenantNames.map((n) => n.trim()).filter((n) => n.length > 0),
    rentalUnitAddress: args.rentalUnitAddress,
    year: args.year,
    payments: yearPayments,
    totalCents: sumPaymentsCents(yearPayments),
    count: yearPayments.length,
    firstPaidOn: yearPayments.length ? yearPayments[0].paid_on : null,
    lastPaidOn: yearPayments.length ? yearPayments[yearPayments.length - 1].paid_on : null,
    generatedAtIso: args.generatedAtIso,
  };
}

function filled(value: string | null | undefined): string {
  const v = value && value.trim() ? value.trim() : "";
  return v
    ? `<span class="val">${escapeHtml(v)}</span>`
    : `<span class="blank">&nbsp;</span>`;
}

/** "2025-03-01" -> "Mar 2025" (the rent month a payment is FOR). */
function formatPeriod(periodMonth: string | null): string {
  if (!periodMonth) return "—";
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(periodMonth.trim());
  if (!m) return "—";
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return "—";
  return `${MONTHS[mo - 1]} ${m[1]}`;
}

/**
 * Render a complete, standalone, print-optimized HTML rent receipt for one year.
 * Pure: same model -> same string. Full HTML page (doctype + inline print CSS) so
 * a route handler can return it directly; the operator Prints -> Saves as PDF with
 * no client JS beyond the print button.
 */
export function renderRentReceiptHtml(model: RentReceiptModel): string {
  const generated = (() => {
    const d = new Date(model.generatedAtIso);
    return isNaN(d.getTime())
      ? escapeHtml(model.generatedAtIso)
      : escapeHtml(d.toISOString().slice(0, 10));
  })();

  const tenantLine = model.tenantNames.length ? model.tenantNames.join(", ") : null;

  const rows = model.payments
    .map(
      (p) => `<tr>
      <td>${escapeHtml(formatLongDate(p.paid_on) ?? p.paid_on)}</td>
      <td>${escapeHtml(formatPeriod(p.period_month))}</td>
      <td>${escapeHtml(paymentMethodLabel(p.method))}${
        p.reference ? ` <span class="muted">· ${escapeHtml(p.reference)}</span>` : ""
      }</td>
      <td class="amt">${escapeHtml(formatMoneyCents(p.amount_cents))}</td>
    </tr>`,
    )
    .join("\n");

  const emptyNote =
    model.count === 0
      ? `<div class="banner warn">No rent payments are recorded for ${model.year} in this tenancy's ledger. If you collected rent this year, log it under "Payments received" first, then regenerate this receipt.</div>`
      : "";

  const periodSummary =
    model.firstPaidOn && model.lastPaidOn
      ? `${escapeHtml(formatLongDate(model.firstPaidOn) ?? model.firstPaidOn)} – ${escapeHtml(
          formatLongDate(model.lastPaidOn) ?? model.lastPaidOn,
        )}`
      : `January 1 – December 31, ${model.year}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Rent Receipt ${model.year}${
    model.rentalUnitAddress ? " — " + escapeHtml(model.rentalUnitAddress) : ""
  }</title>
<style>
  :root { --ink: #1a1a1a; --muted: #555; --line: #cfcfcf; }
  * { box-sizing: border-box; }
  body { font-family: Georgia, "Times New Roman", serif; color: var(--ink);
    line-height: 1.5; margin: 0; background: #f4f4f5; }
  .sheet { max-width: 7.5in; margin: 24px auto; background: #fff; padding: 0.9in 0.85in;
    box-shadow: 0 1px 6px rgba(0,0,0,0.12); }
  .eyebrow { font-family: Arial, sans-serif; font-size: 12px; letter-spacing: 0.08em;
    text-transform: uppercase; color: var(--muted); margin: 0 0 2px; }
  h1 { font-size: 22px; margin: 0 0 2px; }
  .sub { color: var(--muted); font-size: 13px; margin: 0 0 18px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em;
    border-bottom: 1px solid var(--line); padding-bottom: 4px; margin: 22px 0 10px; }
  p { font-size: 14px; margin: 8px 0; }
  table.terms { width: 100%; border-collapse: collapse; font-size: 14px; }
  table.terms th { text-align: left; width: 38%; vertical-align: top; padding: 5px 8px 5px 0;
    color: var(--muted); font-weight: normal; }
  table.terms td { padding: 5px 0; }
  .val { font-weight: bold; }
  .blank { display: inline-block; min-width: 180px; border-bottom: 1px solid var(--ink); }
  table.pay { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 6px; }
  table.pay th { text-align: left; background: #f3f4f6; color: var(--muted); font-weight: normal;
    font-family: Arial, sans-serif; font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em;
    padding: 7px 8px; border-bottom: 1px solid var(--line); }
  table.pay th.amt, table.pay td.amt { text-align: right; }
  table.pay td { padding: 7px 8px; border-bottom: 1px solid #ececec; vertical-align: top; }
  table.pay td.amt { font-weight: bold; white-space: nowrap; }
  .muted { color: var(--muted); font-size: 12px; }
  .total { display: flex; justify-content: space-between; align-items: baseline;
    margin-top: 14px; padding: 12px 8px; border-top: 2px solid var(--ink); }
  .total .label { font-family: Arial, sans-serif; font-size: 12px; text-transform: uppercase;
    letter-spacing: 0.05em; color: var(--muted); }
  .total .amount { font-size: 22px; font-weight: bold; }
  .banner { border-radius: 6px; padding: 8px 12px; font-family: Arial, sans-serif;
    font-size: 12px; margin: 0 0 14px; }
  .banner.warn { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; }
  .sig { margin-top: 30px; max-width: 300px; }
  .sig-line { border-bottom: 1px solid var(--ink); height: 26px; }
  .sig-meta { font-family: Arial, sans-serif; font-size: 11px; color: var(--muted); margin-top: 3px; }
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
    table.pay tr { break-inside: avoid; }
  }
  @page { margin: 0.8in; }
</style>
</head>
<body>
<button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
<div class="sheet">
  <p class="eyebrow">${escapeHtml(model.landlordName)} &middot; Statement of Rent Paid</p>
  <h1>Rent Receipt — ${model.year}</h1>
  <p class="sub">For the tenant's income-tax records</p>

  ${emptyNote}

  <h2>Tenant</h2>
  <table class="terms">
    <tr><th>Tenant name(s)</th><td>${filled(tenantLine)}</td></tr>
    <tr><th>Rental unit</th><td>${filled(model.rentalUnitAddress)}</td></tr>
    <tr><th>Period covered</th><td>${periodSummary}</td></tr>
  </table>

  <h2>Received from the Landlord</h2>
  <table class="terms">
    <tr><th>Landlord name</th><td>${filled(model.landlordName)}</td></tr>
    <tr><th>Phone</th><td>${filled(model.landlordPhone)}</td></tr>
    <tr><th>Email</th><td>${filled(model.landlordEmail)}</td></tr>
  </table>

  <h2>Payments received in ${model.year}</h2>
  <table class="pay">
    <thead>
      <tr><th>Date paid</th><th>Rent month</th><th>Method</th><th class="amt">Amount</th></tr>
    </thead>
    <tbody>
      ${rows || `<tr><td colspan="4" class="muted">No payments recorded.</td></tr>`}
    </tbody>
  </table>

  <div class="total">
    <span class="label">Total rent paid in ${model.year} (${model.count} payment${
      model.count === 1 ? "" : "s"
    })</span>
    <span class="amount">${escapeHtml(formatMoneyCents(model.totalCents))}</span>
  </div>

  <div class="sig">
    <div class="sig-line">&nbsp;</div>
    <div class="sig-meta">Signature of Landlord or Agent &middot; Date</div>
    <div class="sig-val">${filled(model.landlordName)}</div>
  </div>

  <p class="foot">
    Generated by Vacantless on ${generated} from the rent payments recorded for this
    tenancy. It reflects amounts logged in the system and is provided as a receipt for
    rent paid; confirm the figures against your own records. This document is not tax or
    legal advice.
  </p>
</div>
</body>
</html>`;
}
