// S748g: official LTB Form N5 (2026/09) fill. Prepare-only: the landlord signs
// and serves it themselves.
//
// FORM MAP (2026/09, 54 fields, 6 pages: a removable checklist + 4 form pages):
//   PartyAddressInfo.* (shared)  InfofromLandlord1.TerminationDate
//   Reasons.Reason1.Reason1 (box) + Reason1_1 (radio: 1 first / 2 second)
//   Reasons.Reason2.Reason2 (box) + Reason2_1 (first) | Reason2_2 (second),
//     PayMe1 (repair estimate), PayMe2 (replace estimate)
//   Reasons.Reason3.Reason3 (box) + Reason3_1 (first) | Reason3_2 (second),
//     Reason3Explain (the number to reduce to)
//   Details.Table1.Row{1..3}.EventDateTime{n} / Event{n} (multi-line)
//   Signature.* (shared). Checklist and office-use boxes stay blank.

import { ltbDate, ltbMoney, loadLtbTemplate, stripLtbScripts, ltbFields, fillLtbParties, fillLtbSigner } from "@/lib/forms/ltb-2026";
import { N5_MAX_EVENTS, N5_MAX_EVENT_CHARS, type N5Event, type N5Which } from "@/lib/n5";
import type { PDFDocument } from "pdf-lib";

const TEMPLATE_REL = "lib/forms/ltb-n5-2026.pdf";
export const N5_TEMPLATE_VERSION = "2026/09";

export type N5FillSnapshot = {
  tenantNames: string[];
  landlordName: string;
  rentalUnitAddress: string | null;
  terminationDateISO: string;
  which: N5Which;
  reasons: { interference: boolean; damage: boolean; overcrowding: boolean };
  repairCents?: number | null;
  replaceCents?: number | null;
  maxPeople?: string | null;
  events: N5Event[];
  signer: { firstName?: string | null; lastName?: string | null; phone?: string | null };
};

function setSize(pdf: PDFDocument, name: string, size: number) {
  const f = pdf.getForm().getFields().find((x) => x.getName().endsWith(name)) as unknown as {
    setFontSize?: (n: number) => void;
  };
  f?.setFontSize?.(size);
}

export async function fillOfficialN5(s: N5FillSnapshot): Promise<Uint8Array> {
  const date = ltbDate(s.terminationDateISO);
  if (!date) throw new Error("fillOfficialN5: no valid termination date");
  if (!s.reasons.interference && !s.reasons.damage && !s.reasons.overcrowding) {
    throw new Error("fillOfficialN5: no reason");
  }
  const events = s.events.filter((e) => e.when.trim() || e.details.trim());
  if (events.length === 0) throw new Error("fillOfficialN5: describe at least one event");
  if (events.length > N5_MAX_EVENTS) throw new Error("fillOfficialN5: more than 3 events");
  if (events.some((e) => e.details.length > N5_MAX_EVENT_CHARS)) throw new Error("fillOfficialN5: event too long");

  const pdf = await loadLtbTemplate(TEMPLATE_REL);
  const f = ltbFields(pdf);

  fillLtbParties(f, { tenantNames: s.tenantNames, landlordName: s.landlordName, rentalUnitAddress: s.rentalUnitAddress });
  f.text("sfrmForm.InfofromLandlord1.TerminationDate", date);

  const second = s.which === "second";
  const R = "sfrmForm.Reasons.";
  if (s.reasons.interference) {
    f.check(R + "Reason1.Reason1");
    f.radio(R + "Reason1.Reason1_1", second ? "2" : "1");
  }
  if (s.reasons.damage) {
    f.check(R + "Reason2.Reason2");
    f.radio(R + (second ? "Reason2.Reason2_2" : "Reason2.Reason2_1"), "1");
    if (!second && s.repairCents) f.text(R + "Reason2.PayMe1", ltbMoney(s.repairCents));
    if (!second && s.replaceCents) f.text(R + "Reason2.PayMe2", ltbMoney(s.replaceCents));
  }
  if (s.reasons.overcrowding) {
    f.check(R + "Reason3.Reason3");
    f.radio(R + (second ? "Reason3.Reason3_2" : "Reason3.Reason3_1"), "1");
    if (!second) f.text(R + "Reason3.Reason3Explain", (s.maxPeople ?? "").trim());
  }

  events.forEach((e, i) => {
    const n = i + 1;
    const base = `sfrmForm.Details.Table1.Row${n}.`;
    f.text(`${base}EventDateTime${n}`, e.when.trim());
    f.text(`${base}Event${n}`, e.details.trim());
    setSize(pdf, `EventDateTime${n}[0]`, 9);
    setSize(pdf, `Event${n}[0]`, 9);
  });

  fillLtbSigner(f, { type: "landlord", firstName: s.signer.firstName, lastName: s.signer.lastName, phone: s.signer.phone });

  stripLtbScripts(pdf);
  return pdf.save();
}
