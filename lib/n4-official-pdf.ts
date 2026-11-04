// Official LTB Form N4 (Notice to End your Tenancy Early for Non-payment of Rent)
// PDF fill - Slice B of the N-form library (N-FORM-LIBRARY-DESIGN-2026-07-12.md).
//
// S748g: moved to the LTB's 2026/09 N4 (Version 1), issued with the 7-day notice
// period on 2026-09-21. The LTB refuses the old v.01/04/2022 form after
// 2026-11-30. The 2026 form has plain text boxes (no comb cells), dd/mm/yyyy
// dates, and the rental address split into parts; the shared 2026 helpers in
// lib/forms/ltb-2026.ts fill the party, address and signature blocks.
//
// POSTURE: prepare-only. This produces the real Board-approved form for the
// OPERATOR to review + serve themselves. We deliberately do NOT flatten, and we
// strip any leftover document scripts.
//
// FORM MAP (2026/09, 51 fields, 4 pages: a removable checklist + 3 form pages):
//   InfofromLandlord1.txtOweMeAmount / dptPayDate (pay-by == termination date)
//   PartyAddressInfo.* (shared block)   InfofromLandlord2.RentOwing.Row{1..3}
//   .DateFrom/DateTo/Charged/Paid/Owing{n}, TotalRentOwing; Signature.* (shared);
//   LegalRepInfo.* (representative). sfrmInfo.Checklist{1..7} stay blank: they are
//   the landlord's own checklist page, removed before service.

import { ltbDate, ltbMoney, loadLtbTemplate, stripLtbScripts, ltbFields, fillLtbParties, fillLtbSigner } from "@/lib/forms/ltb-2026";
import type { N4FormRow } from "@/lib/n4";

// The bundled template is the Board-approved Form N4 (2026/09), downloaded from
// tribunalsontario.ca on 2026-11-03.
const TEMPLATE_REL = "lib/forms/ltb-n4-2026-09.pdf";
export const N4_TEMPLATE_VERSION = "2026/09";

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

/**
 * Fill the official Form N4 (2026/09) from a prepared snapshot. Returns PDF bytes.
 * The signature and its date stay blank by design (the landlord signs). Fails
 * closed on a table the form can't honestly hold.
 */
export async function fillOfficialN4(snap: N4FillSnapshot): Promise<Uint8Array> {
  const pdf = await loadLtbTemplate(TEMPLATE_REL);
  const f = ltbFields(pdf);

  // FAIL CLOSED on a snapshot the official 3-row table can't honestly hold:
  // never silently drop a period, never show a negative (overpaid) row, never
  // let the rows sum past Total Rent Owing. The caller packs (packN4ArrearsRows)
  // and resolves overpayments BEFORE fill.
  const arrearsRows = snap.arrearsRows ?? [];
  if (arrearsRows.length > 3) {
    throw new Error(
      `fillOfficialN4: ${arrearsRows.length} arrears rows exceed the official N4 3-row table - pack with packN4ArrearsRows first (never truncate a legal notice)`,
    );
  }
  const totalOweCents = Math.max(0, Math.round(snap.totalOwingCents || 0));
  let rowsOweCents = 0;
  for (const row of arrearsRows) {
    const owe = Math.round(row.owingCents || 0);
    if (owe < 0) {
      throw new Error(
        "fillOfficialN4: a period row shows negative (overpaid) owing - resolve overpayments before fill so each row and the total reconcile",
      );
    }
    rowsOweCents += owe;
  }
  if (rowsOweCents > totalOweCents) {
    throw new Error(
      `fillOfficialN4: arrears rows owe ${rowsOweCents}c, exceeding Total Rent Owing ${totalOweCents}c - re-pack the rows to the resolved total before fill`,
    );
  }
  const payBy = ltbDate(snap.terminationDateISO);
  if (!payBy) throw new Error("fillOfficialN4: no valid termination date");

  // Page 1: amount + termination date, then the shared party/address block.
  f.text("sfrmForm.InfofromLandlord1.txtOweMeAmount", ltbMoney(totalOweCents));
  f.text("sfrmForm.InfofromLandlord1.dptPayDate", payBy);
  fillLtbParties(f, {
    tenantNames: snap.tenantNames ?? [],
    landlordName: snap.landlordName ?? "",
    rentalUnitAddress: snap.rentalUnitAddress,
  });

  // Page 3: the rent owing table.
  const t = "sfrmForm.InfofromLandlord2.RentOwing.";
  arrearsRows.forEach((row, i) => {
    const n = i + 1;
    f.text(`${t}Row${n}.DateFrom${n}`, ltbDate(row.fromISO));
    f.text(`${t}Row${n}.DateTo${n}`, ltbDate(row.toISO));
    f.text(`${t}Row${n}.Charged${n}`, ltbMoney(row.chargedCents));
    f.text(`${t}Row${n}.Paid${n}`, ltbMoney(row.paidCents));
    f.text(`${t}Row${n}.Owing${n}`, ltbMoney(row.owingCents));
  });
  f.text("sfrmForm.InfofromLandlord2.TotalRentOwing", ltbMoney(totalOweCents));

  // Signature block (signature + date blank: the landlord signs).
  fillLtbSigner(f, {
    type: snap.signer.type === "agent" ? "representative" : "landlord",
    firstName: snap.signer.firstName,
    lastName: snap.signer.lastName,
    phone: snap.signer.dayPhone,
  });

  if (snap.signer.type === "agent" && snap.agent) {
    const r = "sfrmForm.LegalRepInfo.sfrmLegalRepInfo_1.";
    const parts = (snap.agent.name ?? "").trim().split(/\s+/).filter(Boolean);
    f.text(r + "txtFirstName", parts.slice(0, -1).join(" "));
    f.text(r + "txtLastName", parts.slice(-1).join(""));
    f.text(r + "txtLSOnumber", snap.agent.lsoNumber ?? "");
    f.text(r + "txtCompanyName", snap.agent.company ?? "");
    f.text(r + "txtName", snap.agent.address ?? "");
    f.text(r + "txtCity", snap.agent.municipality ?? "");
    f.text(r + "txtProvince", snap.agent.province ?? "");
    f.text(r + "txtPostalCode", snap.agent.postalCode ?? "");
    f.text(r + "txtPhone1", snap.agent.phone ?? "");
  }

  stripLtbScripts(pdf);
  return pdf.save();
}
