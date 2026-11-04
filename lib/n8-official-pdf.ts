// S749: official LTB Form N8 (2026/09) fill, Reason 1 (persistent late rent).
// Prepare-only: the landlord reviews, signs and serves the notice themselves.
//
// FORM MAP (2026/09, 4 pages: a removable checklist + 3 form pages):
//   PartyAddressInfo.* (shared 2026 block)  InfofromLandlord1.TerminationDate
//   Reasons.Reason{1..5}.Reason{n} (checkboxes)  Details.NoticeDetail (multi-line)
//   Signature.* (shared). OUO.* and the checklist ticks stay blank.

import type { PDFDocument } from "pdf-lib";
import { ltbDate, loadLtbTemplate, stripLtbScripts, ltbFields, fillLtbParties, fillLtbSigner } from "@/lib/forms/ltb-2026";
import { N8_MAX_DETAIL_CHARS } from "@/lib/n8";

const TEMPLATE_REL = "lib/forms/ltb-n8-2026.pdf";
export const N8_TEMPLATE_VERSION = "2026/09";

export type N8FillSnapshot = {
  tenantNames: string[];
  landlordName: string;
  rentalUnitAddress: string | null;
  terminationDateISO: string;
  details: string;
  signer: { firstName?: string | null; lastName?: string | null; phone?: string | null };
};

function setSize(pdf: PDFDocument, name: string, size: number) {
  const f = pdf.getForm().getFields().find((x) => x.getName().endsWith(name)) as unknown as {
    setFontSize?: (n: number) => void;
  };
  f?.setFontSize?.(size);
}

export async function fillOfficialN8(s: N8FillSnapshot): Promise<Uint8Array> {
  const date = ltbDate(s.terminationDateISO);
  if (!date) throw new Error("fillOfficialN8: no valid termination date");
  if (!s.details.trim()) throw new Error("fillOfficialN8: no details");
  if (s.details.length > N8_MAX_DETAIL_CHARS) throw new Error("fillOfficialN8: details too long");

  const pdf = await loadLtbTemplate(TEMPLATE_REL);
  const f = ltbFields(pdf);

  fillLtbParties(f, { tenantNames: s.tenantNames, landlordName: s.landlordName, rentalUnitAddress: s.rentalUnitAddress });
  f.text("sfrmForm.InfofromLandlord1.TerminationDate", date);
  f.check("sfrmForm.Reasons.Reason1.Reason1");
  f.text("sfrmForm.Details.NoticeDetail", s.details.trim());
  setSize(pdf, "NoticeDetail[0]", 9);

  fillLtbSigner(f, { type: "landlord", firstName: s.signer.firstName, lastName: s.signer.lastName, phone: s.signer.phone });

  stripLtbScripts(pdf);
  return pdf.save();
}
