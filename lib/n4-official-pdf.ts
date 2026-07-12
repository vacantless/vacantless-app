// Official LTB Form N4 (Notice to End a Tenancy Early for Non-payment of Rent)
// PDF fill — Slice B of the N-form library (N-FORM-LIBRARY-DESIGN-2026-07-12.md).
//
// Extends the proven N1 pattern (lib/n1-official-pdf.ts): a PRE-CLEANED gov
// template at lib/forms/ltb-n4-2015.pdf (the hybrid AcroForm+XFA raw was
// XFA-stripped + normalized offline via qpdf -> pdf-lib), filled from an immutable
// snapshot with the shared comb formatters (lib/forms/shared-combs.ts).
//
// POSTURE: prepare-only. This produces the real Board-approved form for the
// OPERATOR to review + serve themselves; serve-on-behalf (agent signer) stays
// gated behind the per-form legal-verify pass (design section 6). We deliberately
// do NOT flatten (pdf-lib flatten corrupts this hybrid template's xref) and we
// strip any leftover LiveCycle document scripts.
//
// FORM MAP (verified via the field-map spike, 43 fields, 3 pages):
//   subform[1]  TO_TenameName / From_LandlordName / RentalUnitAddress
//               OweMeAmount (comb 10)  PayDate (comb 10 = the termination date;
//               the LTB instructions confirm pay-to-void date == termination date)
//   subform[4]  Table1.Row{1..3}: ArrearFrom/ArrearTo (comb 10 dates),
//               RentCharge/RentPaid (comb 9), RentOwe (comb 10); TotalRentOwe
//               (comb 11); SelectSign radio (1=landlord, 2=agent); signer +
//               agent blocks. Page-1 CheckList{1..7} are the landlord's manual
//               checklist — left blank by the app.

import fs from "node:fs";
import path from "node:path";
import { PDFDocument, PDFName, PDFDict } from "pdf-lib";
import { combAmountCents, combDateISO } from "@/lib/forms/shared-combs";
import type { N4FormRow } from "@/lib/n4";

const TEMPLATE_REL = "lib/forms/ltb-n4-2015.pdf";
export const N4_TEMPLATE_VERSION = "2015/11/30";

export type N4FillSnapshot = {
  tenantNames: string[];
  landlordName: string;
  rentalUnitAddress: string;
  /** Total arrears the tenant must pay to void (resolveN4OwingCents). */
  totalOwingCents: number;
  /** The termination date === the pay-by-to-void date (deriveN4TerminationDate). */
  terminationDateISO: string;
  /** Already packed to <= 3 rows (packN4ArrearsRows). */
  arrearsRows: N4FormRow[];
  signer: {
    type: "landlord" | "agent";
    firstName?: string;
    lastName?: string;
    dayPhone?: string;
  };
  agent?: {
    name?: string;
    lsoNumber?: string;
    company?: string;
    address?: string;
    phone?: string;
    municipality?: string;
    province?: string;
    postalCode?: string;
    fax?: string;
  };
};

const leaf = (name: string) => name.split(".").pop()!.replace(/\[\d+\]$/, "");

let templateCache: Uint8Array | null = null;
function loadTemplate(): Uint8Array {
  if (templateCache) return templateCache;
  const p = path.join(process.cwd(), TEMPLATE_REL);
  if (!fs.existsSync(p)) {
    throw new Error(`LTB N4 template missing at ${TEMPLATE_REL} (Vercel file-trace?)`);
  }
  templateCache = new Uint8Array(fs.readFileSync(p));
  return templateCache;
}

function stripDocumentScripts(pdf: PDFDocument): void {
  const cat = pdf.catalog;
  cat.delete(PDFName.of("OpenAction"));
  cat.delete(PDFName.of("AA"));
  const names = cat.lookupMaybe(PDFName.of("Names"), PDFDict);
  if (names) names.delete(PDFName.of("JavaScript"));
}

/**
 * Fill the official Form N4 from a prepared snapshot. Returns PDF bytes. The
 * Signature + SignDate fields are left blank by design (wet / e-signature step).
 * Amounts route through the comb formatters, which THROW on an over-wide amount
 * (never silently drop a digit on a legal notice).
 */
export async function fillOfficialN4(snap: N4FillSnapshot): Promise<Uint8Array> {
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

  // Header (subform[1]).
  setText("TO_TenameName", (snap.tenantNames ?? []).filter(Boolean).join(", "));
  setText("From_LandlordName", snap.landlordName ?? "");
  setText("RentalUnitAddress", snap.rentalUnitAddress ?? "");
  setText("OweMeAmount", combAmountCents(snap.totalOwingCents, 10));
  setText("PayDate", combDateISO(snap.terminationDateISO) ?? "");

  // Arrears table (subform[4], Row1..3) — snap.arrearsRows is pre-packed to <=3.
  snap.arrearsRows.slice(0, 3).forEach((row, i) => {
    const n = i + 1;
    setText(`ArrearFrom${n}`, combDateISO(row.fromISO) ?? "");
    setText(`ArrearTo${n}`, combDateISO(row.toISO) ?? "");
    setText(`RentCharge${n}`, combAmountCents(row.chargedCents, 9));
    setText(`RentPaid${n}`, combAmountCents(row.paidCents, 9));
    setText(`RentOwe${n}`, combAmountCents(row.owingCents, 10));
  });
  setText("TotalRentOwe", combAmountCents(snap.totalOwingCents, 11));

  // Signer: landlord (SelectSign=1) or agent/representative (SelectSign=2).
  const signOpt = snap.signer.type === "agent" ? "2" : "1";
  const selectSign = byLeaf["SelectSign"];
  if (selectSign && "select" in selectSign) {
    const opts = (selectSign as unknown as { getOptions: () => string[] }).getOptions();
    if (opts.includes(signOpt)) {
      (selectSign as unknown as { select: (o: string) => void }).select(signOpt);
    }
  }
  setText("RFirstName", snap.signer.firstName ?? "");
  setText("RLastName", snap.signer.lastName ?? "");
  setText("RDayPhone", snap.signer.dayPhone ?? "");
  // Signature + SignDate intentionally left blank (wet / e-sign step).

  if (snap.signer.type === "agent" && snap.agent) {
    setText("AgentName", snap.agent.name ?? "");
    setText("AgentLSUC", snap.agent.lsoNumber ?? "");
    setText("AgentCompany", snap.agent.company ?? "");
    setText("AgentAddress", snap.agent.address ?? "");
    setText("AgentPhoneNum", snap.agent.phone ?? "");
    setText("AgentMunicipality", snap.agent.municipality ?? "");
    setText("AgentProvince", snap.agent.province ?? "");
    setText("AgentPostCode", snap.agent.postalCode ?? "");
    setText("AgentFaxNum", snap.agent.fax ?? "");
  }

  stripDocumentScripts(pdf);
  return pdf.save();
}
