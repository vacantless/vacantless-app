// S751: official LTB Form N13 (2026/09) fill. Prepare-only: the landlord reviews,
// signs, and serves the notice themselves.
//
// FORM MAP (2026/09, 44 fields, 6 pages: a removable 2-page checklist + 4 form
// pages; read with pdf-lib after cleaning on 2026-11-05):
//   PartyAddressInfo.* (shared 2026 block)  InfofromLandlord1.TerminationDate
//   Reasons.Reason1.Reason1 / Reason2.Reason2 / Reason3.Reason3 (each a radio, "1")
//   Details.Table1.Row1.WorkPlanned (212x262) / WorkDetails (356x262), multi-line
//   Permits.NecessaryPermits "1" obtained / "2" will obtain / "3" none necessary
//   (widget order, top to bottom). Signature.* (shared). LegalRepInfo.* blank.
//   OUO.* is the LTB's office-use box and stays blank, as do the checklist ticks.

import { ltbDate, loadLtbTemplate, stripLtbScripts, ltbFields, fillLtbParties, fillLtbSigner } from "@/lib/forms/ltb-2026";
import {
  fitsBox,
  N13_PERMITS,
  N13_TEXT_FONT_PT,
  N13_WORK_DETAILS_BOX,
  N13_WORK_PLANNED_BOX,
  type N13Permits,
  type N13Reason,
} from "@/lib/n13";

const TEMPLATE_REL = "lib/forms/ltb-n13-2026.pdf";
export const N13_TEMPLATE_VERSION = "2026/09";

export type N13FillSnapshot = {
  tenantNames: string[];
  landlordName: string;
  rentalUnitAddress: string | null;
  terminationDateISO: string;
  reason: N13Reason;
  workPlanned: string;
  workDetails: string;
  permits: N13Permits;
  signer: { firstName?: string | null; lastName?: string | null; phone?: string | null };
};

export async function fillOfficialN13(snap: N13FillSnapshot): Promise<Uint8Array> {
  const date = ltbDate(snap.terminationDateISO);
  if (!date) throw new Error("fillOfficialN13: no valid termination date");
  if (![1, 2, 3].includes(snap.reason)) throw new Error("fillOfficialN13: reason must be 1, 2 or 3");
  const permitIdx = N13_PERMITS.indexOf(snap.permits);
  if (permitIdx < 0) throw new Error(`fillOfficialN13: unknown permits answer ${snap.permits}`);
  if (snap.reason === 2 && snap.permits === "none_needed") throw new Error("fillOfficialN13: Reason 2 needs a building permit");
  if (!snap.workPlanned.trim() || !snap.workDetails.trim()) throw new Error("fillOfficialN13: describe the work");
  if (!fitsBox(snap.workPlanned, N13_WORK_PLANNED_BOX) || !fitsBox(snap.workDetails, N13_WORK_DETAILS_BOX)) {
    throw new Error("fillOfficialN13: the work description doesn't fit the form");
  }

  const pdf = await loadLtbTemplate(TEMPLATE_REL);
  const f = ltbFields(pdf);

  fillLtbParties(f, {
    tenantNames: snap.tenantNames,
    landlordName: snap.landlordName,
    rentalUnitAddress: snap.rentalUnitAddress,
  });
  f.text("sfrmForm.InfofromLandlord1.TerminationDate", date);
  f.radio(`sfrmForm.Reasons.Reason${snap.reason}.Reason${snap.reason}`, "1");

  f.text("sfrmForm.Details.Table1.Row1.WorkPlanned", snap.workPlanned.trim());
  f.text("sfrmForm.Details.Table1.Row1.WorkDetails", snap.workDetails.trim());
  // The form's own 12 pt leaves little room; 10 pt is what the fit check assumes.
  const form = pdf.getForm();
  for (const fld of form.getFields()) {
    const n = fld.getName();
    if (n.includes("WorkPlanned") || n.includes("WorkDetails")) {
      (fld as unknown as { setFontSize: (s: number) => void }).setFontSize(N13_TEXT_FONT_PT);
    }
  }

  f.radio("sfrmForm.Permits.NecessaryPermits", String(permitIdx + 1));

  fillLtbSigner(f, {
    type: "landlord",
    firstName: snap.signer.firstName,
    lastName: snap.signer.lastName,
    phone: snap.signer.phone,
  });

  stripLtbScripts(pdf);
  return pdf.save();
}
