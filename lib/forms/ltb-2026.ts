// S748g: shared filler for the LTB's 2026 form layout (N4 2026/09, N12 2026/10,
// and the other forms replaced on 2026-09-21). These templates drop the old comb
// cells: every field is a plain text box, dates are typed dd/mm/yyyy, money is
// "1,400.00" (the form prints the $), and the rental address is split into street
// number / street name / unit / municipality / province / postal code. The party,
// address and signature blocks use the same field names on every form, so one
// helper fills them all. The old forms are refused by the LTB after 2026-11-30.
//
// Templates are pre-cleaned offline (qpdf --decrypt, then pdf-lib: XFA dropped,
// document and field scripts removed) so the viewer never reformats our values.

import fs from "node:fs";
import path from "node:path";
import { PDFDocument, PDFName, PDFDict } from "pdf-lib";
import { parseCanadianAddress } from "@/lib/standard-lease";

/** ISO YYYY-MM-DD -> "dd/mm/yyyy"; "" for anything unparseable (leave the box blank, never guess). */
export function ltbDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? "").trim());
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/** Cents -> "1,400.00". Negative amounts are refused: a legal notice never shows a credit as owing. */
export function ltbMoney(cents: number): string {
  const v = Math.round(cents || 0);
  if (v < 0) throw new Error(`ltbMoney: negative amount ${v}c`);
  const dollars = Math.floor(v / 100).toLocaleString("en-CA");
  return `${dollars}.${String(v % 100).padStart(2, "0")}`;
}

export type LtbAddress = {
  streetNumber: string;
  streetName: string;
  unit: string;
  city: string;
  province: string;
  postalCode: string;
};

/** One stored address string -> the form's address boxes. Province defaults to ON (the form pre-prints it). */
export function ltbAddress(address: string | null | undefined): LtbAddress {
  const a = parseCanadianAddress(address);
  const prov = a.province && a.province !== "Ontario" ? a.province : "ON";
  return {
    streetNumber: a.streetNumber,
    streetName: a.streetName,
    unit: a.unit,
    city: a.city,
    province: prov,
    postalCode: a.postalCode,
  };
}

const cache = new Map<string, Uint8Array>();
export async function loadLtbTemplate(rel: string): Promise<PDFDocument> {
  let bytes = cache.get(rel);
  if (!bytes) {
    const p = path.join(process.cwd(), rel);
    if (!fs.existsSync(p)) throw new Error(`LTB template missing at ${rel} (Vercel file-trace?)`);
    bytes = new Uint8Array(fs.readFileSync(p));
    cache.set(rel, bytes);
  }
  return PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
}

export function stripLtbScripts(pdf: PDFDocument): void {
  const cat = pdf.catalog;
  cat.delete(PDFName.of("OpenAction"));
  cat.delete(PDFName.of("AA"));
  const names = cat.lookupMaybe(PDFName.of("Names"), PDFDict);
  if (names) names.delete(PDFName.of("JavaScript"));
}

/** Field setter keyed by the full field name minus the "form1[0]." root and "[0]" indexes. */
export function ltbFields(pdf: PDFDocument) {
  const form = pdf.getForm();
  const byKey = new Map<string, ReturnType<typeof form.getFields>[number]>();
  for (const f of form.getFields()) {
    byKey.set(f.getName().replace(/^form1\[0\]\./, "").replace(/\[\d+\]/g, ""), f);
  }
  const get = (key: string) => {
    const f = byKey.get(key);
    if (!f) throw new Error(`LTB form field not found: ${key}`);
    return f;
  };
  return {
    has: (key: string) => byKey.has(key),
    text(key: string, val: string | null | undefined) {
      const f = get(key) as unknown as { setText?: (s: string) => void };
      if (!f.setText) throw new Error(`LTB field ${key} is not a text field`);
      f.setText(val ?? "");
    },
    check(key: string) {
      const f = get(key) as unknown as { check?: () => void };
      if (!f.check) throw new Error(`LTB field ${key} is not a checkbox`);
      f.check();
    },
    radio(key: string, option: string) {
      const f = get(key) as unknown as { select?: (o: string) => void; getOptions?: () => string[] };
      if (!f.select || !f.getOptions) throw new Error(`LTB field ${key} is not a radio group`);
      if (!f.getOptions().includes(option)) throw new Error(`LTB radio ${key} has no option ${option}`);
      f.select(option);
    },
    textOf(key: string): string {
      const f = get(key) as unknown as { getText?: () => string | undefined };
      return f.getText?.() ?? "";
    },
  };
}

export type LtbFieldSetter = ReturnType<typeof ltbFields>;

export type LtbParties = {
  tenantNames: string[];
  landlordName: string;
  rentalUnitAddress: string | null | undefined;
};

/** The "To / From / Address of the Rental Unit" block (sfrmForm.PartyAddressInfo on every 2026 form). */
export function fillLtbParties(f: LtbFieldSetter, p: LtbParties): void {
  const base = "sfrmForm.PartyAddressInfo.";
  f.text(base + "txtTenant", p.tenantNames.map((n) => n.trim()).filter(Boolean).join(", "));
  f.text(base + "txtLandlord", p.landlordName.trim());
  const a = ltbAddress(p.rentalUnitAddress);
  f.text(base + "txtNumber", a.streetNumber);
  f.text(base + "txtName", a.streetName);
  f.text(base + "txtUnit", a.unit);
  f.text(base + "txtCity", a.city);
  f.text(base + "txtProvince", a.province);
  f.text(base + "txtPostalCode", a.postalCode);
}

export type LtbSigner = {
  type: "landlord" | "representative";
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
};

/** The signature block. The signature and its date stay blank: the landlord signs and dates it. */
export function fillLtbSigner(f: LtbFieldSetter, s: LtbSigner): void {
  const base = "sfrmForm.Signature.";
  f.radio(base + "PartyType", s.type === "representative" ? "2" : "1");
  f.text(base + "txtFirstName", s.firstName ?? "");
  f.text(base + "txtLastName", s.lastName ?? "");
  f.text(base + "txtPhone1", s.phone ?? "");
}
