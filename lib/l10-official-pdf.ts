// S751: official LTB Form L10 (2026/09) fill. Prepare-only: the landlord checks
// it, signs it and files it (Tribunals Ontario Portal, mail, courier or a
// ServiceOntario centre). Nothing is filed for them.
//
// FORM MAP (2026/09, 146 fields, 12 pages incl. a removable checklist and the
// payment page; read with pdf-lib after cleaning on 2026-11-05):
//   LanguagePreference.sfrmLanguagePreference.Language ("1" French, "2" English)
//   Part1.AddressRentalUnit.*; Part2.InfofromLandlord.txtTotalOwe (no date box)
//   Part3.LandlordNameAddress.* + CommunicationConsent.Communication ("1" mail, "2" email)
//   Part3.dptMoveOutDate; Part3.FormerTenantNameAddress.txtTenant{1,2}* + ONE current
//   address block (txtNumber ... txtPostalCode)
//   Part4.Reason1.chkReason1 / TotalArrears / RentOwing.Row{1..3}.* / TotalRentOwing /
//   DepositAmount / DepositDate / DepositDateFrom / DepositDateTo
//   Part4.Reason2 NSF table and Reason3 utilities table: left for the landlord.
//   Part4.Reason4.chkReason4 / DamageCost / Reason4Detail (572x104)
//   Part4.Reason5.chkReason5 / InterferenceCost / Reason5Detail (572x104)
//   Part5.TotalArrears / TotalNSF / UtilityCost / DamageCost / InterferenceCost /
//   ApplicationFee / TotalAmountOwing
//   Part6.Signature.LandlordRep ("1" landlord); signature and date blank.

import { ltbDate, ltbMoney, ltbAddress, loadLtbTemplate, stripLtbScripts, ltbFields } from "@/lib/forms/ltb-2026";
import { splitName } from "@/lib/standard-lease";
import { fitsBox } from "@/lib/n13";
import { L10_DETAIL_BOX, L10_DETAIL_FONT_PT } from "@/lib/l10";
import type { N4FormRow } from "@/lib/n4";

export const L10_TEMPLATE_REL = "lib/forms/ltb-l10-2026.pdf";
export const L10_TEMPLATE_VERSION = "2026/09";

export type L10FillInput = {
  rentalUnitAddress: string | null;
  moveOutISO: string;
  landlord: {
    firstName?: string | null;
    lastName?: string | null;
    company?: string | null;
    email?: string | null;
    phone?: string | null;
    mailingAddress?: string | null;
    byEmail: boolean;
  };
  tenants: { name: string; email?: string | null; phone?: string | null }[];
  /** The former tenant's current address, if known. Never the rental unit. */
  tenantCurrentAddress?: string | null;
  deposit?: { cents: number; collectedISO?: string | null; interestFromISO?: string | null; interestToISO?: string | null } | null;
  rows: N4FormRow[];
  rentOwingCents: number;
  damageCents: number;
  damageDetail?: string | null;
  interferenceCents: number;
  interferenceDetail?: string | null;
  feeCents: number;
  totalCents: number;
  french?: boolean;
};

export async function fillOfficialL10(d: L10FillInput): Promise<Uint8Array> {
  if (!ltbDate(d.moveOutISO)) throw new Error("fillOfficialL10: no valid move-out date");
  if (d.rows.length > 3) throw new Error("fillOfficialL10: more than 3 rent rows (pack them first)");
  const rowsOwe = d.rows.reduce((s, r) => s + Math.round(r.owingCents), 0);
  if (rowsOwe !== Math.round(d.rentOwingCents)) throw new Error(`fillOfficialL10: rows owe ${rowsOwe}c but rent owing is ${d.rentOwingCents}c`);
  if (Math.round(d.rentOwingCents + d.damageCents + d.interferenceCents + d.feeCents) !== Math.round(d.totalCents)) {
    throw new Error("fillOfficialL10: total does not add up");
  }
  if (d.tenants.length === 0) throw new Error("fillOfficialL10: no tenant");
  if (d.damageCents > 0 && !d.damageDetail?.trim()) throw new Error("fillOfficialL10: explain the damage");
  if (d.interferenceCents > 0 && !d.interferenceDetail?.trim()) throw new Error("fillOfficialL10: explain the interference costs");
  for (const t of [d.damageDetail, d.interferenceDetail]) {
    if (t && !fitsBox(t, L10_DETAIL_BOX, L10_DETAIL_FONT_PT)) throw new Error("fillOfficialL10: an explanation doesn't fit");
  }
  const sameAsUnit =
    d.tenantCurrentAddress && d.rentalUnitAddress &&
    d.tenantCurrentAddress.replace(/\W/g, "").toLowerCase() === d.rentalUnitAddress.replace(/\W/g, "").toLowerCase();
  if (sameAsUnit) throw new Error("fillOfficialL10: the tenant's current address can't be the rental unit");

  const pdf = await loadLtbTemplate(L10_TEMPLATE_REL);
  const f = ltbFields(pdf);

  f.radio("sfrmForm.LanguagePreference.sfrmLanguagePreference.Language", d.french ? "1" : "2");

  const a = ltbAddress(d.rentalUnitAddress);
  const p1 = "sfrmForm.Part1.AddressRentalUnit.";
  f.text(p1 + "txtNumber", a.streetNumber);
  f.text(p1 + "txtName", a.streetName);
  f.text(p1 + "txtUnit", a.unit);
  f.text(p1 + "txtCity", a.city);
  f.text(p1 + "txtProvince", a.province);
  f.text(p1 + "txtPostalCode", a.postalCode);

  f.text("sfrmForm.Part2.InfofromLandlord.txtTotalOwe", ltbMoney(d.totalCents));

  const l = "sfrmForm.Part3.LandlordNameAddress.";
  f.text(l + "txtFirstName", d.landlord.firstName ?? "");
  f.text(l + "txtLastName", d.landlord.lastName ?? "");
  f.text(l + "txtCompanyName", d.landlord.company ?? "");
  f.text(l + "txtEmail", d.landlord.email ?? "");
  f.text(l + "txtPhone", d.landlord.phone ?? "");
  if (d.landlord.mailingAddress?.trim()) {
    const m = ltbAddress(d.landlord.mailingAddress);
    f.text(l + "txtNumber", m.streetNumber);
    f.text(l + "txtName", m.streetName);
    f.text(l + "txtUnit", m.unit);
    f.text(l + "txtCity", m.city);
    f.text(l + "txtProvince", m.province);
    f.text(l + "txtPostalCode", m.postalCode);
  }
  f.radio("sfrmForm.Part3.CommunicationConsent.Communication", d.landlord.byEmail ? "2" : "1");
  f.text("sfrmForm.Part3.dptMoveOutDate", ltbDate(d.moveOutISO));

  const t = "sfrmForm.Part3.FormerTenantNameAddress.";
  d.tenants.slice(0, 2).forEach((tn, i) => {
    const n = i + 1;
    const nm = splitName(tn.name);
    f.text(`${t}txtTenant${n}FirstName`, nm.first);
    f.text(`${t}txtTenant${n}LastName`, nm.last);
    f.text(`${t}txtTenant${n}Email`, tn.email ?? "");
    f.text(`${t}txtTenant${n}Phone`, tn.phone ?? "");
  });
  if (d.tenantCurrentAddress?.trim()) {
    const c = ltbAddress(d.tenantCurrentAddress);
    f.text(t + "txtNumber", c.streetNumber);
    f.text(t + "txtName", c.streetName);
    f.text(t + "txtUnit", c.unit);
    f.text(t + "txtCity", c.city);
    f.text(t + "txtProvince", c.province);
    f.text(t + "txtPostalCode", c.postalCode);
  }

  const r1 = "sfrmForm.Part4.Reason1.";
  if (d.rentOwingCents > 0) {
    f.check(r1 + "chkReason1");
    f.text(r1 + "TotalArrears", ltbMoney(d.rentOwingCents));
    d.rows.forEach((row, i) => {
      const n = i + 1;
      f.text(`${r1}RentOwing.Row${n}.DateFrom${n}`, ltbDate(row.fromISO));
      f.text(`${r1}RentOwing.Row${n}.DateTo${n}`, ltbDate(row.toISO));
      f.text(`${r1}RentOwing.Row${n}.Charged${n}`, ltbMoney(row.chargedCents));
      f.text(`${r1}RentOwing.Row${n}.Paid${n}`, ltbMoney(row.paidCents));
      f.text(`${r1}RentOwing.Row${n}.Owing${n}`, ltbMoney(row.owingCents));
    });
    f.text(r1 + "TotalRentOwing", ltbMoney(d.rentOwingCents));
    if (d.deposit && d.deposit.cents > 0) {
      f.text(r1 + "DepositAmount", ltbMoney(d.deposit.cents));
      f.text(r1 + "DepositDate", ltbDate(d.deposit.collectedISO));
      f.text(r1 + "DepositDateFrom", ltbDate(d.deposit.interestFromISO));
      f.text(r1 + "DepositDateTo", ltbDate(d.deposit.interestToISO));
    }
  }

  const form = pdf.getForm();
  const small = (suffix: string) => {
    const fld = form.getFields().find((x) => x.getName().endsWith(suffix)) as unknown as { setFontSize?: (n: number) => void };
    fld?.setFontSize?.(L10_DETAIL_FONT_PT);
  };
  if (d.damageCents > 0) {
    f.check("sfrmForm.Part4.Reason4.chkReason4");
    f.text("sfrmForm.Part4.Reason4.DamageCost", ltbMoney(d.damageCents));
    f.text("sfrmForm.Part4.Reason4.Reason4Detail", (d.damageDetail ?? "").trim());
    small("Reason4Detail[0]");
  }
  if (d.interferenceCents > 0) {
    f.check("sfrmForm.Part4.Reason5.chkReason5");
    f.text("sfrmForm.Part4.Reason5.InterferenceCost", ltbMoney(d.interferenceCents));
    f.text("sfrmForm.Part4.Reason5.Reason5Detail", (d.interferenceDetail ?? "").trim());
    small("Reason5Detail[0]");
  }

  const p5 = "sfrmForm.Part5.";
  // Lines with nothing claimed stay blank; NSF and utility totals are the landlord's to add with their tables.
  if (d.rentOwingCents > 0) f.text(p5 + "TotalArrears", ltbMoney(d.rentOwingCents));
  if (d.damageCents > 0) f.text(p5 + "DamageCost", ltbMoney(d.damageCents));
  if (d.interferenceCents > 0) f.text(p5 + "InterferenceCost", ltbMoney(d.interferenceCents));
  f.text(p5 + "ApplicationFee", ltbMoney(d.feeCents));
  f.text(p5 + "TotalAmountOwing", ltbMoney(d.totalCents));

  f.radio("sfrmForm.Part6.Signature.LandlordRep", "1");

  stripLtbScripts(pdf);
  return pdf.save();
}
