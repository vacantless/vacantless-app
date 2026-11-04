// S749: official LTB Form L2 (2026/09) fill, notice-based path (Reason 1).
// Prepare-only: the landlord checks it, signs it and files it (Tribunals Ontario
// Portal, mail, courier or a ServiceOntario centre) with a copy of the notice and
// its Certificate of Service; for an N12, with Schedule B and the declaration of
// the person moving in.
//
// FORM MAP (2026/09, 15 pages incl. Schedule A, Schedule B and the payment page):
//   LanguagePreference.sfrmLanguagePreference.Language
//   Part1.AddressRentalUnit.*, Part1.LandlordNameAddress.*, Part1.CommunicationConsent.Communication,
//   Part1.TenantNameAddress.txtTenant{1,2}{FirstName,LastName,Email,Phone} (+ tenant mailing address
//   only when different, left blank), Part1.Possession.LiveStatus (Yes first)
//   Part2.Reason1.Reason + N5/N6/N7/N8/N12/N13 + TerminationDate
//   Part3.Reason1.R1 (daily compensation); Part3.Reason2.CurrentRent / RentDeposit /
//   DepositDate / DepositDateFrom / DepositDateTo (the rent and deposit block)
//   Part4.Table.ApplicationFee / TotalAmountOwing
//   Part5.Signature.LandlordRep; signature + date blank
//   sfrmScheduleB.PartA.Reason{1,2}selected.Compensation (gave, offered, will give[, not required])
//   sfrmScheduleB.PartC.Table1.Row{1..3}.{NoticeDate,RentalAddress,Intended,FileNumber}{n};
//   sfrmScheduleB.PartC.Previous_N12_N13_B (none in the past 2 years)

import { ltbDate, ltbMoney, ltbAddress, loadLtbTemplate, stripLtbScripts, ltbFields } from "@/lib/forms/ltb-2026";
import { splitName } from "@/lib/standard-lease";
import { L2_N12_COMPENSATION, L2_PRIOR_NOTICE_ROWS, type L2N12Compensation, type L2NoticeType, type L2PriorNotice } from "@/lib/l2";

const TEMPLATE_REL = "lib/forms/ltb-l2-2026.pdf";
export const L2_TEMPLATE_VERSION = "2026/09";

/** Radio option values in the cleaned template (pdf-lib, widget order). Checked by the fill test. */
export const L2_RADIO = {
  french: "1",
  english: "2",
  byMail: "1",
  byEmail: "2",
  possessionYes: "1",
  reasonOn: "1",
  landlord: "1",
} as const;

export type L2FillInput = {
  rentalUnitAddress: string | null;
  noticeType: L2NoticeType;
  terminationISO: string;
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
  dailyCompensation: boolean;
  rentCents?: number | null;
  deposit?: { cents: number; collectedISO?: string | null; interestFromISO?: string | null; interestToISO?: string | null } | null;
  feeCents: number;
  totalCents: number;
  n12?: {
    reason: 1 | 2;
    compensation: L2N12Compensation;
    priorNotices: L2PriorNotice[];
    /** Others were given outside Vacantless: leave the table for the landlord, never tick "none". */
    priorOutside: boolean;
  } | null;
  french?: boolean;
};

export async function fillOfficialL2(d: L2FillInput): Promise<Uint8Array> {
  const term = ltbDate(d.terminationISO);
  if (!term) throw new Error("fillOfficialL2: no valid termination date");
  if (d.tenants.length === 0) throw new Error("fillOfficialL2: no tenant");
  if (Math.round(d.totalCents) < Math.round(d.feeCents)) throw new Error("fillOfficialL2: total below the fee");
  if (d.noticeType === "N12") {
    if (!d.n12) throw new Error("fillOfficialL2: N12 needs Schedule B answers");
    if (d.n12.priorNotices.length > L2_PRIOR_NOTICE_ROWS) throw new Error("fillOfficialL2: more than 3 prior notices");
    if (d.n12.reason === 2 && d.n12.compensation === "not_required") {
      throw new Error("fillOfficialL2: purchaser's own use always owes compensation");
    }
  }

  const pdf = await loadLtbTemplate(TEMPLATE_REL);
  const f = ltbFields(pdf);

  f.radio("sfrmForm.LanguagePreference.sfrmLanguagePreference.Language", d.french ? L2_RADIO.french : L2_RADIO.english);

  const a = ltbAddress(d.rentalUnitAddress);
  const p1 = "sfrmForm.Part1.AddressRentalUnit.";
  f.text(p1 + "txtNumber", a.streetNumber);
  f.text(p1 + "txtName", a.streetName);
  f.text(p1 + "txtUnit", a.unit);
  f.text(p1 + "txtCity", a.city);
  f.text(p1 + "txtProvince", a.province);
  f.text(p1 + "txtPostalCode", a.postalCode);

  const l = "sfrmForm.Part1.LandlordNameAddress.";
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
  f.radio("sfrmForm.Part1.CommunicationConsent.Communication", d.landlord.byEmail ? L2_RADIO.byEmail : L2_RADIO.byMail);

  const t = "sfrmForm.Part1.TenantNameAddress.";
  d.tenants.slice(0, 2).forEach((tn, i) => {
    const n = i + 1;
    const nm = splitName(tn.name);
    f.text(`${t}txtTenant${n}FirstName`, nm.first);
    f.text(`${t}txtTenant${n}LastName`, nm.last);
    f.text(`${t}txtTenant${n}Email`, tn.email ?? "");
    f.text(`${t}txtTenant${n}Phone`, tn.phone ?? "");
  });
  f.radio("sfrmForm.Part1.Possession.LiveStatus", L2_RADIO.possessionYes);

  const p2 = "sfrmForm.Part2.Reason1.";
  f.radio(p2 + "Reason", L2_RADIO.reasonOn);
  f.check(p2 + d.noticeType);
  f.text(p2 + "TerminationDate", term);

  if (d.dailyCompensation) {
    f.check("sfrmForm.Part3.Reason1.R1");
    const r = "sfrmForm.Part3.Reason2.";
    if (d.rentCents && d.rentCents > 0) f.text(r + "CurrentRent", ltbMoney(d.rentCents));
    if (d.deposit && d.deposit.cents > 0) {
      f.text(r + "RentDeposit", ltbMoney(d.deposit.cents));
      f.text(r + "DepositDate", ltbDate(d.deposit.collectedISO));
      f.text(r + "DepositDateFrom", ltbDate(d.deposit.interestFromISO));
      f.text(r + "DepositDateTo", ltbDate(d.deposit.interestToISO));
    }
  }

  f.text("sfrmForm.Part4.Table.ApplicationFee", ltbMoney(d.feeCents));
  f.text("sfrmForm.Part4.Table.TotalAmountOwing", ltbMoney(d.totalCents));

  f.radio("sfrmForm.Part5.Signature.LandlordRep", L2_RADIO.landlord);

  if (d.noticeType === "N12" && d.n12) {
    const idx = L2_N12_COMPENSATION.indexOf(d.n12.compensation);
    const group = d.n12.reason === 2 ? "Reason2selected" : "Reason1selected";
    f.radio(`sfrmScheduleB.PartA.${group}.Compensation`, String(idx + 1));
    const c = "sfrmScheduleB.PartC.Table1.";
    d.n12.priorNotices.forEach((p, i) => {
      const n = i + 1;
      f.text(`${c}Row${n}.NoticeDate${n}`, ltbDate(p.dateISO));
      f.text(`${c}Row${n}.RentalAddress${n}`, p.address);
      f.text(`${c}Row${n}.Intended${n}`, p.intended);
    });
    if (d.n12.priorNotices.length === 0 && !d.n12.priorOutside) f.check("sfrmScheduleB.PartC.Previous_N12_N13_B");
  }

  stripLtbScripts(pdf);
  return pdf.save();
}
