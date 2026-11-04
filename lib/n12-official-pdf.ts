// S748g: official LTB Form N12 (2026/10) fill. Prepare-only: the landlord reviews,
// signs, and serves the notice themselves.
//
// FORM MAP (2026/10, 67 fields, 5 pages: a removable 2-page checklist + 3 form pages):
//   PartyAddressInfo.* (shared 2026 block)  InfofromLandlord1.TerminationDate
//   Reasons.Reason1.Reason1 (radio "1"), Reason1A.NameReason1, Reason1A.Reason1_A1..A6
//   (Me / My spouse / My child / My parent / My spouse's child / My spouse's parent),
//   Reason1B.Reason1_B (care services) + Reason1_B1..B6 (who receives the care);
//   Reason2.* the same for the purchaser. Signature.* (shared). OUO.* is the LTB's
//   office-use box and stays blank, as do the checklist ticks.

import { ltbDate, loadLtbTemplate, stripLtbScripts, ltbFields, fillLtbParties, fillLtbSigner } from "@/lib/forms/ltb-2026";
import { N12_RELATIONSHIPS, type N12Reason, type N12Relationship } from "@/lib/n12";

const TEMPLATE_REL = "lib/forms/ltb-n12-2026-10.pdf";
export const N12_TEMPLATE_VERSION = "2026/10";

export type N12FillSnapshot = {
  tenantNames: string[];
  landlordName: string;
  rentalUnitAddress: string | null;
  terminationDateISO: string;
  reason: N12Reason;
  personName: string;
  relationship: N12Relationship;
  /** The person moving in provides care services to `relationship`. */
  careProvider: boolean;
  signer: { firstName?: string | null; lastName?: string | null; phone?: string | null };
};

export async function fillOfficialN12(snap: N12FillSnapshot): Promise<Uint8Array> {
  const date = ltbDate(snap.terminationDateISO);
  if (!date) throw new Error("fillOfficialN12: no valid termination date");
  if (snap.reason !== 1 && snap.reason !== 2) throw new Error("fillOfficialN12: reason must be 1 or 2");
  const idx = N12_RELATIONSHIPS.indexOf(snap.relationship);
  if (idx < 0) throw new Error(`fillOfficialN12: unknown relationship ${snap.relationship}`);
  if (!snap.personName.trim()) throw new Error("fillOfficialN12: name the person moving in");

  const pdf = await loadLtbTemplate(TEMPLATE_REL);
  const f = ltbFields(pdf);

  fillLtbParties(f, {
    tenantNames: snap.tenantNames,
    landlordName: snap.landlordName,
    rentalUnitAddress: snap.rentalUnitAddress,
  });
  f.text("sfrmForm.InfofromLandlord1.TerminationDate", date);

  const r = `sfrmForm.Reasons.Reason${snap.reason}.`;
  f.radio(`${r}Reason${snap.reason}`, "1");
  f.text(`${r}Reason${snap.reason}A.NameReason${snap.reason}`, snap.personName.trim());
  const n = idx + 1;
  if (snap.careProvider) {
    f.check(`${r}Reason${snap.reason}B.Reason${snap.reason}_B`);
    f.check(`${r}Reason${snap.reason}B.Reason${snap.reason}_B${n}`);
  } else {
    f.check(`${r}Reason${snap.reason}A.Reason${snap.reason}_A${n}`);
  }

  fillLtbSigner(f, {
    type: "landlord",
    firstName: snap.signer.firstName,
    lastName: snap.signer.lastName,
    phone: snap.signer.phone,
  });

  stripLtbScripts(pdf);
  return pdf.save();
}
