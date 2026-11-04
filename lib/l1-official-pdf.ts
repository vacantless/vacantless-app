// S748g: official LTB Form L1 (2026/09) fill. Prepare-only: the landlord checks
// it, signs it and files it (Tribunals Ontario Portal, mail, courier or a
// ServiceOntario centre) with a copy of the N4 and its Certificate of Service.
//
// FORM MAP (2026/09, 113 fields, 10 pages incl. a removable checklist):
//   LanguagePreference.Language (1 French, 2 English)
//   Part1.AddressRentalUnit.* (address split)
//   Part2.InfofromLandlord.txtTotalOwe + dptDepositDate (the "as of" = filing date)
//   Part3.LandlordNameAddress.* (+ CommunicationConsent.Communication 1 mail, 2 email)
//   Part3.TenantNameAddress.txtTenant{1,2}*
//   Part4.chkReason1 (rent) / chkReason2 (NSF), Possession (1 yes), Period (1 month),
//   DepositAmount / DepositDate / DepositDateFrom / DepositDateTo
//   Part5.Section1.RentOwing.Row{1..3}.*, TotalRentOwing; Section2 NSF table
//   Part6.TotalRentOwe / TotalNSFOwe / ApplicationFee / TotalAmountOwe
//   Part7.Signature.LandlordRep (1 landlord, 3 representative); signature + date blank.

import { ltbDate, ltbMoney, ltbAddress, loadLtbTemplate, stripLtbScripts, ltbFields } from "@/lib/forms/ltb-2026";
import { splitName } from "@/lib/standard-lease";
import type { N4FormRow } from "@/lib/n4";

const TEMPLATE_REL = "lib/forms/ltb-l1-2026.pdf";
export const L1_TEMPLATE_VERSION = "2026/09";

export type L1FillInput = {
  rentalUnitAddress: string | null;
  filingDateISO: string;
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
  deposit?: { cents: number; collectedISO?: string | null; interestFromISO?: string | null; interestToISO?: string | null } | null;
  rows: N4FormRow[];
  rentOwingCents: number;
  nsfCents: number;
  feeCents: number;
  totalCents: number;
  french?: boolean;
};

export async function fillOfficialL1(d: L1FillInput): Promise<Uint8Array> {
  const asOf = ltbDate(d.filingDateISO);
  if (!asOf) throw new Error("fillOfficialL1: no valid filing date");
  if (d.rows.length > 3) throw new Error("fillOfficialL1: more than 3 rent rows (pack them first)");
  const rowsOwe = d.rows.reduce((s, r) => s + Math.round(r.owingCents), 0);
  if (rowsOwe !== Math.round(d.rentOwingCents)) {
    throw new Error(`fillOfficialL1: rows owe ${rowsOwe}c but rent owing is ${d.rentOwingCents}c`);
  }
  if (Math.round(d.rentOwingCents + d.nsfCents + d.feeCents) !== Math.round(d.totalCents)) {
    throw new Error("fillOfficialL1: total does not add up");
  }
  if (d.tenants.length === 0) throw new Error("fillOfficialL1: no tenant");

  const pdf = await loadLtbTemplate(TEMPLATE_REL);
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
  f.text("sfrmForm.Part2.InfofromLandlord.dptDepositDate", asOf);

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

  const t = "sfrmForm.Part3.TenantNameAddress.";
  d.tenants.slice(0, 2).forEach((tn, i) => {
    const n = i + 1;
    const nm = splitName(tn.name);
    f.text(`${t}txtTenant${n}FirstName`, nm.first);
    f.text(`${t}txtTenant${n}LastName`, nm.last);
    f.text(`${t}txtTenant${n}Email`, tn.email ?? "");
    f.text(`${t}txtTenant${n}Phone`, tn.phone ?? "");
  });

  const p4 = "sfrmForm.Part4.";
  f.check(p4 + "chkReason1");
  if (d.nsfCents > 0) f.check(p4 + "chkReason2");
  f.radio(p4 + "Possession", "1");
  f.radio(p4 + "sfrmPeriod_1.Period", "1");
  if (d.deposit && d.deposit.cents > 0) {
    f.text(p4 + "DepositAmount", ltbMoney(d.deposit.cents));
    f.text(p4 + "DepositDate", ltbDate(d.deposit.collectedISO));
    f.text(p4 + "DepositDateFrom", ltbDate(d.deposit.interestFromISO));
    f.text(p4 + "DepositDateTo", ltbDate(d.deposit.interestToISO));
  }

  const r = "sfrmForm.Part5.Section1.RentOwing.";
  d.rows.forEach((row, i) => {
    const n = i + 1;
    f.text(`${r}Row${n}.DateFrom${n}`, ltbDate(row.fromISO));
    f.text(`${r}Row${n}.DateTo${n}`, ltbDate(row.toISO));
    f.text(`${r}Row${n}.Charged${n}`, ltbMoney(row.chargedCents));
    f.text(`${r}Row${n}.Paid${n}`, ltbMoney(row.paidCents));
    f.text(`${r}Row${n}.Owing${n}`, ltbMoney(row.owingCents));
  });
  f.text("sfrmForm.Part5.Section1.TotalRentOwing", ltbMoney(d.rentOwingCents));
  if (d.nsfCents > 0) f.text("sfrmForm.Part5.Section2.TotalNSFCharge", ltbMoney(d.nsfCents));

  const p6 = "sfrmForm.Part6.";
  f.text(p6 + "TotalRentOwe", ltbMoney(d.rentOwingCents));
  f.text(p6 + "TotalNSFOwe", ltbMoney(d.nsfCents));
  f.text(p6 + "ApplicationFee", ltbMoney(d.feeCents));
  f.text(p6 + "TotalAmountOwe", ltbMoney(d.totalCents));

  f.radio("sfrmForm.Part7.Signature.LandlordRep", "1");

  stripLtbScripts(pdf);
  return pdf.save();
}
