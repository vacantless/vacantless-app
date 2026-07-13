// Tenant-facing render of a prepared/served Form N4 (Notice to End a Tenancy
// Early for Non-payment of Rent) — the HTML companion at /notice/[token].
//
// This is a PLAIN-LANGUAGE SUMMARY of the notice the operator served; the
// authoritative legal document is the official Board-approved Form N4 PDF
// (linked as officialPdfUrl, filled by lib/n4-official-pdf.ts). We deliberately
// do NOT reproduce the government form in HTML — the summary orients the tenant
// (who served it, the unit, the arrears table, the total to pay to void, and the
// termination date) and points to the official PDF for the legal text.
//
// Built ONLY from the immutable notices.snapshot (frozen at prepare time), so the
// tenant always sees exactly what was served — it can never drift. Pure (no I/O).

import { escapeHtml, formatLongDate } from "@/lib/n1-render";
import { formatMoneyCents } from "@/lib/payments";
import type { N4Snapshot } from "@/lib/n4-snapshot";

export type N4RenderRow = {
  from: string | null;
  to: string | null;
  charged: string;
  paid: string;
  owing: string;
};

export type N4RenderModel = {
  landlordName: string;
  landlordPhone: string | null;
  tenantNames: string[];
  rentalUnitAddress: string | null;
  totalOwing: string;
  noticeDate: string | null;
  terminationDate: string | null;
  rows: N4RenderRow[];
  officialPdfUrl: string | null;
  generatedAtIso: string;
};

/** Map the immutable snapshot to the tenant-facing render model. Pure. */
export function n4ModelFromSnapshot(
  s: N4Snapshot,
  opts?: { officialPdfUrl?: string | null },
): N4RenderModel {
  return {
    landlordName: s.landlordName,
    landlordPhone: s.landlordPhone ?? null,
    tenantNames: s.tenantNames ?? [],
    rentalUnitAddress: s.rentalUnitAddress ?? null,
    totalOwing: formatMoneyCents(s.totalOwingCents),
    noticeDate: s.noticeDateISO ?? null,
    terminationDate: s.terminationDateISO ?? null,
    rows: (s.arrearsRows ?? []).map((r) => ({
      from: r.fromISO ?? null,
      to: r.toISO ?? null,
      charged: formatMoneyCents(r.chargedCents),
      paid: formatMoneyCents(r.paidCents),
      owing: formatMoneyCents(r.owingCents),
    })),
    officialPdfUrl: opts?.officialPdfUrl ?? null,
    generatedAtIso: new Date().toISOString(),
  };
}

function rowHtml(r: N4RenderRow): string {
  const from = formatLongDate(r.from) ?? "—";
  const to = formatLongDate(r.to) ?? "—";
  return (
    `<tr>` +
    `<td>${escapeHtml(from)} – ${escapeHtml(to)}</td>` +
    `<td class="num">${escapeHtml(r.charged)}</td>` +
    `<td class="num">${escapeHtml(r.paid)}</td>` +
    `<td class="num">${escapeHtml(r.owing)}</td>` +
    `</tr>`
  );
}

/** A self-contained, print-friendly HTML summary of the served N4. Pure. */
export function renderN4Html(model: N4RenderModel): string {
  const tenants =
    model.tenantNames.length > 0
      ? model.tenantNames.map((n) => escapeHtml(n)).join(", ")
      : "Tenant";
  const address = escapeHtml(model.rentalUnitAddress ?? "your rental unit");
  const landlord = escapeHtml(model.landlordName || "Your landlord");
  const phone = model.landlordPhone
    ? `<p class="muted">Questions? Contact ${landlord} at ${escapeHtml(model.landlordPhone)}.</p>`
    : "";
  const termination = formatLongDate(model.terminationDate) ?? "—";
  const notice = formatLongDate(model.noticeDate) ?? "—";
  const rows = model.rows.map(rowHtml).join("");
  const pdf = model.officialPdfUrl
    ? `<p class="cta"><a href="${escapeHtml(model.officialPdfUrl)}">Download the official Form N4 (PDF)</a></p>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Notice to End Your Tenancy for Non-payment of Rent (Form N4)</title>
<style>
  :root { color-scheme: light; }
  body { font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1a1a1a; max-width: 720px; margin: 0 auto; padding: 28px 20px 64px; background: #fff; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #555; margin: 0 0 20px; }
  .banner { background: #fff8e6; border: 1px solid #f0d98a; border-radius: 8px; padding: 12px 14px; margin: 0 0 20px; font-size: 14px; }
  .card { border: 1px solid #e4e4e7; border-radius: 10px; padding: 16px 18px; margin: 0 0 16px; }
  .label { color: #666; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; margin: 0 0 2px; }
  .big { font-size: 26px; font-weight: 700; margin: 0; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 0; font-size: 14px; }
  th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid #ececec; }
  th { color: #666; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .03em; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .cta { margin: 20px 0 0; }
  .cta a { display: inline-block; background: #111; color: #fff; text-decoration: none; padding: 11px 18px; border-radius: 8px; font-weight: 600; }
  .muted { color: #666; font-size: 13px; }
  .foot { color: #999; font-size: 12px; margin-top: 28px; }
</style>
</head>
<body>
  <h1>Notice to End Your Tenancy for Non-payment of Rent</h1>
  <p class="sub">Form N4 · ${address}</p>

  <div class="banner">
    This page is a plain-language summary. The <strong>official Form N4</strong> is the legal
    notice — please download and read it below. This notice does not by itself end your tenancy
    or evict you.
  </div>

  <div class="card">
    <p class="label">Total rent you owe as of ${escapeHtml(notice)}</p>
    <p class="big">${escapeHtml(model.totalOwing)}</p>
    <p class="muted">If you pay this amount in full on or before <strong>${escapeHtml(
      termination,
    )}</strong>, this notice becomes void and your tenancy continues.</p>
  </div>

  <div class="card">
    <p class="label">Rent owing</p>
    <table>
      <thead>
        <tr><th>Rental period</th><th class="num">Rent charged</th><th class="num">Rent paid</th><th class="num">Owing</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>

  <div class="card">
    <p class="label">Served to</p>
    <p>${tenants}</p>
    <p class="label" style="margin-top:12px">From</p>
    <p>${landlord}</p>
    ${phone}
  </div>

  ${pdf}

  <p class="foot">Prepared with Vacantless. For questions about your rights, contact the Landlord and Tenant Board.</p>
</body>
</html>`;
}
