// Official LTB Form N1 (Notice of Rent Increase) PDF fill — S469 (+S470 folds).
//
// The on-screen served notice (lib/n1-render.ts) is a faithful HTML facsimile.
// This module produces the ACTUAL Board-approved government form (Form N1,
// v.01/04/2022) filled from the frozen n1_snapshot, so the operator can serve /
// file the real LTB PDF, not a look-alike.
//
// The government template is a hybrid AcroForm + XFA LiveCycle PDF that pdf-lib
// cannot parse raw. We ship a PRE-CLEANED copy (XFA stripped + structure
// normalized once, offline) at lib/forms/ltb-n1-2022.pdf; pdf-lib fills the
// AcroForm layer of that. See LTB-N1-OFFICIAL-FORM-FILL-SPIKE-2026-07-12.md.
//
// COMB fields: StartDate (10 cells, "/" pre-printed at cells 3 & 6) and the two
// amount fields RentIncAmount1/2 (9 cells, "." pre-printed at cell 7) place each
// character in its own cell. We feed positional strings with a BLANK where the
// form pre-prints a separator, so nothing doubles (KI: "cents in twice" bug).
//
// S470: (a) the amount comb has only 6 dollar cells — throw rather than silently
// truncate an amount above $999,999.99 (Codex P2). (b) strip leftover document
// JavaScript from the served PDF. We deliberately do NOT flatten: pdf-lib's
// flatten() leaves dangling widget refs (corrupt xref) on this hybrid template.
// Non-flattened is structurally clean and renders in every real viewer (XFA was
// stripped offline, so Adobe uses the filled AcroForm layer).

import fs from "node:fs";
import path from "node:path";
import { PDFDocument, PDFName, PDFDict } from "pdf-lib";
import type { N1Snapshot } from "@/lib/n1-render";

const TEMPLATE_REL = "lib/forms/ltb-n1-2022.pdf";
export const N1_TEMPLATE_VERSION = "v.01/04/2022";

// --- pure comb formatters (exported for unit tests) ------------------------

/** 9-cell amount comb: 6 dollar cells (right-aligned) + blank decimal cell + 2 cents. */
export function combAmountCents(cents: number): string {
  const v = Math.max(0, Math.round(cents));
  const dstr = String(Math.floor(v / 100));
  if (dstr.length > 6) {
    // Only 6 dollar cells exist. NEVER silently truncate a legal amount
    // (a $1,234,567.89 rent would otherwise print as $234,567.89).
    throw new Error(
      `N1 amount $${dstr} exceeds the form's 6-digit dollar comb (max $999,999.99)`,
    );
  }
  const dollars = dstr.padStart(6, " ");
  const c = String(v % 100).padStart(2, "0");
  return `${dollars} ${c}`; // 6 + 1(blank, pre-printed ".") + 2 = 9
}

/** 10-cell date comb from ISO YYYY-MM-DD -> "DD MM YYYY" (blanks over pre-printed "/"). */
export function combDateISO(iso: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso ?? "").trim());
  if (!m) return null;
  const [, Y, M, D] = m;
  return `${D} ${M} ${Y}`; // 2 +1+ 2 +1+ 4 = 10
}

const leaf = (name: string) => name.split(".").pop()!.replace(/\[\d+\]$/, "");

let templateCache: Uint8Array | null = null;
function loadTemplate(): Uint8Array {
  if (templateCache) return templateCache;
  const p = path.join(process.cwd(), TEMPLATE_REL);
  if (!fs.existsSync(p)) {
    // Fail LOUD (never silently emit a blank legal form) — bundling regression.
    throw new Error(`LTB N1 template missing at ${TEMPLATE_REL} (Vercel file-trace?)`);
  }
  templateCache = new Uint8Array(fs.readFileSync(p));
  return templateCache;
}

/** Remove any leftover document-level JavaScript / open-action from the template. */
function stripDocumentScripts(pdf: PDFDocument): void {
  const cat = pdf.catalog;
  cat.delete(PDFName.of("OpenAction"));
  cat.delete(PDFName.of("AA"));
  const names = cat.lookupMaybe(PDFName.of("Names"), PDFDict);
  if (names) names.delete(PDFName.of("JavaScript"));
}

/**
 * Fill the official Form N1 from the immutable served snapshot. Returns PDF bytes.
 * The signature line + landlord mailing address are left blank by design (wet /
 * e-signature step). Only builds a GUIDELINE-increase notice (Check1); an exempt
 * snapshot (no newRentCents) is rejected by the caller before we get here.
 */
export async function fillOfficialN1(snap: N1Snapshot): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(loadTemplate(), { ignoreEncryption: true });
  const form = pdf.getForm();

  const byLeaf: Record<string, ReturnType<typeof form.getFields>[number]> = {};
  for (const f of form.getFields()) byLeaf[leaf(f.getName())] = f;

  const setText = (name: string, val: string | null | undefined) => {
    const f = byLeaf[name];
    if (f && "setText" in f && val != null && val !== "") {
      (f as unknown as { setText: (s: string) => void }).setText(val);
    }
  };

  const tenantBlock = [
    (snap.tenantNames ?? []).filter(Boolean).join(", "),
    snap.rentalUnitAddress ?? "",
  ].filter(Boolean).join("\n");

  setText("To_TenantName", tenantBlock);
  setText("From_LandlordName", snap.landlordName ?? "");
  setText("RentUnitAddress", snap.rentalUnitAddress ?? "");
  setText("StartDate", combDateISO(snap.effectiveDate ?? "") ?? "");
  if (snap.newRentCents != null) setText("RentIncAmount1", combAmountCents(snap.newRentCents));
  if (snap.increaseCents != null) setText("RentIncAmount2", combAmountCents(snap.increaseCents));
  if (snap.guidelinePercent != null) setText("RentIncPercent", String(snap.guidelinePercent));
  setText("SignName", snap.landlordName ?? "");
  setText("SignPhoneNum", snap.landlordPhone ?? "");

  // month period (BOTH period groups share the leaf "PaymentPeriodM"), landlord
  // signer, and the guideline-increase check are each the FIRST option of their
  // group in the frozen v.01/04/2022 template. Select on every matching field
  // (not via byLeaf, which would collapse the two period groups to one).
  for (const f of form.getFields()) {
    const l = leaf(f.getName());
    if (
      (l === "PaymentPeriodM" || l === "SelectSign" || l === "Check1") &&
      "select" in f &&
      "getOptions" in f
    ) {
      const optList = (f as unknown as { getOptions: () => string[] }).getOptions();
      if (optList.length) (f as unknown as { select: (o: string) => void }).select(optList[0]);
    }
  }

  // Remove any leftover document-level JavaScript from the LiveCycle template so
  // the served PDF carries no scripts. No flatten (see header): non-flattened is
  // structurally clean and renders in every real viewer.
  stripDocumentScripts(pdf);
  return pdf.save();
}
