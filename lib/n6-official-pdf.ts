// S751: official LTB Form N6 (2026/09) fill. Prepare-only: the landlord signs
// and serves it themselves.
//
// FORM MAP (2026/09, 45 fields, 4 pages: a removable checklist + 3 form pages;
// read with pdf-lib after cleaning on 2026-11-05):
//   PartyAddressInfo.* (shared)  InfofromLandlord1.TerminationDate
//   Reasons.Reason1.Reason1 / Reason2.Reason2 / Reason3.Reason3 (checkboxes)
//   Details.Table1.Row{1..3}.EventDateTime{n} (104x118) / Event{n} (464x118)
//   Signature.* (shared). Checklist, LegalRepInfo and office-use boxes stay blank.

import { ltbDate, loadLtbTemplate, stripLtbScripts, ltbFields, fillLtbParties, fillLtbSigner } from "@/lib/forms/ltb-2026";
import { fitsBox } from "@/lib/n13";
import { N6_EVENT_BOX, N6_EVENT_FONT_PT, N6_MAX_EVENTS, N6_WHEN_BOX, type N6Event, type N6Reasons } from "@/lib/n6";

const TEMPLATE_REL = "lib/forms/ltb-n6-2026.pdf";
export const N6_TEMPLATE_VERSION = "2026/09";

export type N6FillSnapshot = {
  tenantNames: string[];
  landlordName: string;
  rentalUnitAddress: string | null;
  terminationDateISO: string;
  reasons: N6Reasons;
  events: N6Event[];
  signer: { firstName?: string | null; lastName?: string | null; phone?: string | null };
};

export async function fillOfficialN6(s: N6FillSnapshot): Promise<Uint8Array> {
  const date = ltbDate(s.terminationDateISO);
  if (!date) throw new Error("fillOfficialN6: no valid termination date");
  if (!s.reasons.drugs && !s.reasons.illegal && !s.reasons.income) throw new Error("fillOfficialN6: no reason");
  const events = s.events.filter((e) => e.when.trim() || e.details.trim());
  if (events.length === 0) throw new Error("fillOfficialN6: describe at least one event");
  if (events.length > N6_MAX_EVENTS) throw new Error("fillOfficialN6: more than 3 events");
  if (events.some((e) => !fitsBox(e.details, N6_EVENT_BOX, N6_EVENT_FONT_PT) || !fitsBox(e.when, N6_WHEN_BOX, N6_EVENT_FONT_PT))) {
    throw new Error("fillOfficialN6: an event doesn't fit its box");
  }

  const pdf = await loadLtbTemplate(TEMPLATE_REL);
  const f = ltbFields(pdf);

  fillLtbParties(f, { tenantNames: s.tenantNames, landlordName: s.landlordName, rentalUnitAddress: s.rentalUnitAddress });
  f.text("sfrmForm.InfofromLandlord1.TerminationDate", date);

  const R = "sfrmForm.Reasons.";
  if (s.reasons.drugs) f.check(R + "Reason1.Reason1");
  if (s.reasons.illegal) f.check(R + "Reason2.Reason2");
  if (s.reasons.income) f.check(R + "Reason3.Reason3");

  const form = pdf.getForm();
  const setSize = (suffix: string) => {
    const fld = form.getFields().find((x) => x.getName().endsWith(suffix)) as unknown as { setFontSize?: (n: number) => void };
    fld?.setFontSize?.(N6_EVENT_FONT_PT);
  };
  events.forEach((e, i) => {
    const n = i + 1;
    const base = `sfrmForm.Details.Table1.Row${n}.`;
    f.text(`${base}EventDateTime${n}`, e.when.trim());
    f.text(`${base}Event${n}`, e.details.trim());
    setSize(`EventDateTime${n}[0]`);
    setSize(`Event${n}[0]`);
  });

  fillLtbSigner(f, { type: "landlord", firstName: s.signer.firstName, lastName: s.signer.lastName, phone: s.signer.phone });

  stripLtbScripts(pdf);
  return pdf.save();
}
