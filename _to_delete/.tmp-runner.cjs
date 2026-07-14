"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// scripts/test-n4-pdf.ts
var import_node_fs2 = __toESM(require("node:fs"));
var import_pdf_lib2 = require("pdf-lib");

// lib/payments.ts
function normalizePeriodMonth(raw) {
  const v = (raw ?? "").trim();
  const m = v.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  if (!m) return null;
  const month = parseInt(m[2], 10);
  if (month < 1 || month > 12) return null;
  return `${m[1]}-${m[2]}-01`;
}
function formatPeriodMonth(period) {
  const v = (period ?? "").trim();
  const m = v.match(/^(\d{4})-(\d{2})/);
  if (!m) return "Unassigned";
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December"
  ];
  const idx = parseInt(m[2], 10) - 1;
  if (idx < 0 || idx > 11) return "Unassigned";
  return `${months[idx]} ${m[1]}`;
}

// lib/n4.ts
function parseYmd(iso) {
  const match = (iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) throw new Error(`n4: invalid date "${iso}"`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}
function addDaysISO(iso, days) {
  const { y, m, d } = parseYmd(iso);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
function endOfMonthISO(iso) {
  const m = /^(\d{4})-(\d{2})/.exec((iso ?? "").trim());
  if (!m) throw new Error(`n4: invalid month "${iso}"`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return `${m[1]}-${m[2]}-${String(lastDay).padStart(2, "0")}`;
}
function minN4NoticeDays(unit) {
  return unit === "daily" || unit === "weekly" ? 7 : 14;
}
function deriveN4TerminationDate(serviceDateISO, unit) {
  return addDaysISO(serviceDateISO, minN4NoticeDays(unit));
}
function monthlyPeriodKeys(firstISO, lastISO) {
  const first = normalizePeriodMonth(firstISO);
  const last = normalizePeriodMonth(lastISO);
  if (!first || !last || first > last) return [];
  const keys = [];
  let y = Number(first.slice(0, 4));
  let m = Number(first.slice(5, 7));
  const endY = Number(last.slice(0, 4));
  const endM = Number(last.slice(5, 7));
  let guard = 0;
  while ((y < endY || y === endY && m <= endM) && guard < 1200) {
    keys.push(`${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    guard += 1;
  }
  return keys;
}
function deriveN4Arrears(input) {
  const rent = Math.max(0, Math.round(input.rentCents || 0));
  const anchorISO = input.firstPeriodISO ?? input.startDateISO;
  const windowKeys = monthlyPeriodKeys(anchorISO, input.asOfISO);
  const windowSet = new Set(windowKeys);
  const paidByPeriod = /* @__PURE__ */ new Map();
  let unassignedPaidCents = 0;
  let outOfWindowPaidCents = 0;
  for (const p of input.payments) {
    const amt = Math.round(p.amount_cents || 0);
    if (amt === 0) continue;
    const key = normalizePeriodMonth(p.period_month ?? void 0);
    if (!key) {
      unassignedPaidCents += amt;
      continue;
    }
    if (!windowSet.has(key)) {
      outOfWindowPaidCents += amt;
      continue;
    }
    paidByPeriod.set(key, (paidByPeriod.get(key) ?? 0) + amt);
  }
  const rows = windowKeys.map((period) => {
    const paid = paidByPeriod.get(period) ?? 0;
    return {
      period,
      label: formatPeriodMonth(period),
      fromISO: period,
      toISO: endOfMonthISO(period),
      chargedCents: rent,
      paidCents: paid,
      owingCents: rent - paid
    };
  });
  const totalChargedCents = rows.reduce((s, r) => s + r.chargedCents, 0);
  const totalPaidCents = rows.reduce((s, r) => s + r.paidCents, 0);
  const computedOwingCents = Math.max(0, totalChargedCents - totalPaidCents);
  return {
    rows,
    totalChargedCents,
    totalPaidCents,
    computedOwingCents,
    unassignedPaidCents,
    outOfWindowPaidCents
  };
}
function resolveN4OwingCents(computedOwingCents, overrideCents) {
  if (overrideCents != null && Number.isFinite(overrideCents) && overrideCents >= 0) {
    return Math.round(overrideCents);
  }
  return Math.max(0, Math.round(computedOwingCents || 0));
}
function packN4ArrearsRows(rows) {
  const toForm = (r) => ({
    fromISO: r.fromISO,
    toISO: r.toISO,
    chargedCents: r.chargedCents,
    paidCents: r.paidCents,
    owingCents: r.owingCents
  });
  if (rows.length <= 3) {
    return { formRows: rows.map(toForm), combined: false };
  }
  const last = rows[rows.length - 1];
  const earlier = rows.slice(0, rows.length - 1);
  const combinedRow = {
    fromISO: earlier[0].fromISO,
    toISO: earlier[earlier.length - 1].toISO,
    chargedCents: earlier.reduce((s, r) => s + r.chargedCents, 0),
    paidCents: earlier.reduce((s, r) => s + r.paidCents, 0),
    owingCents: earlier.reduce((s, r) => s + r.owingCents, 0)
  };
  return { formRows: [combinedRow, toForm(last)], combined: true };
}

// lib/forms/shared-combs.ts
function combAmountCents(cents, cells = 9) {
  const dollarCells = cells - 3;
  if (dollarCells < 1) throw new Error(`comb: field too narrow (${cells} cells)`);
  const v = Math.max(0, Math.round(cents || 0));
  const dstr = String(Math.floor(v / 100));
  if (dstr.length > dollarCells) {
    throw new Error(
      `comb: amount $${dstr} exceeds the ${dollarCells}-dollar-cell comb (field width ${cells})`
    );
  }
  const dollars = dstr.padStart(dollarCells, " ");
  const c = String(v % 100).padStart(2, "0");
  return `${dollars} ${c}`;
}
function combDateISO(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso ?? "").trim());
  if (!m) return null;
  const [, Y, M, D] = m;
  return `${D} ${M} ${Y}`;
}

// lib/n4-official-pdf.ts
var import_node_fs = __toESM(require("node:fs"));
var import_node_path = __toESM(require("node:path"));
var import_pdf_lib = require("pdf-lib");
var TEMPLATE_REL = "lib/forms/ltb-n4-2015.pdf";
var leaf = (name) => name.split(".").pop().replace(/\[\d+\]$/, "");
var templateCache = null;
function loadTemplate() {
  if (templateCache) return templateCache;
  const p = import_node_path.default.join(process.cwd(), TEMPLATE_REL);
  if (!import_node_fs.default.existsSync(p)) {
    throw new Error(`LTB N4 template missing at ${TEMPLATE_REL} (Vercel file-trace?)`);
  }
  templateCache = new Uint8Array(import_node_fs.default.readFileSync(p));
  return templateCache;
}
function stripDocumentScripts(pdf) {
  const cat = pdf.catalog;
  cat.delete(import_pdf_lib.PDFName.of("OpenAction"));
  cat.delete(import_pdf_lib.PDFName.of("AA"));
  const names = cat.lookupMaybe(import_pdf_lib.PDFName.of("Names"), import_pdf_lib.PDFDict);
  if (names) names.delete(import_pdf_lib.PDFName.of("JavaScript"));
}
async function fillOfficialN4(snap) {
  const pdf = await import_pdf_lib.PDFDocument.load(loadTemplate(), { ignoreEncryption: true });
  const form = pdf.getForm();
  const byLeaf = {};
  for (const f of form.getFields()) byLeaf[leaf(f.getName())] = f;
  const setText = (name, val) => {
    const f = byLeaf[name];
    if (f && "setText" in f && val != null && val !== "") {
      f.setText(val);
    }
  };
  setText("TO_TenameName", (snap.tenantNames ?? []).filter(Boolean).join(", "));
  setText("From_LandlordName", snap.landlordName ?? "");
  setText("RentalUnitAddress", snap.rentalUnitAddress ?? "");
  setText("OweMeAmount", combAmountCents(snap.totalOwingCents, 10));
  setText("PayDate", combDateISO(snap.terminationDateISO) ?? "");
  snap.arrearsRows.slice(0, 3).forEach((row, i) => {
    const n = i + 1;
    setText(`ArrearFrom${n}`, combDateISO(row.fromISO) ?? "");
    setText(`ArrearTo${n}`, combDateISO(row.toISO) ?? "");
    setText(`RentCharge${n}`, combAmountCents(row.chargedCents, 9));
    setText(`RentPaid${n}`, combAmountCents(row.paidCents, 9));
    setText(`RentOwe${n}`, combAmountCents(row.owingCents, 10));
  });
  setText("TotalRentOwe", combAmountCents(snap.totalOwingCents, 11));
  const signOpt = snap.signer.type === "agent" ? "2" : "1";
  const selectSign = byLeaf["SelectSign"];
  if (selectSign && "select" in selectSign) {
    const opts = selectSign.getOptions();
    if (opts.includes(signOpt)) {
      selectSign.select(signOpt);
    }
  }
  setText("RFirstName", snap.signer.firstName ?? "");
  setText("RLastName", snap.signer.lastName ?? "");
  setText("RDayPhone", snap.signer.dayPhone ?? "");
  if (snap.signer.type === "agent" && snap.agent) {
    setText("AgentName", snap.agent.name ?? "");
    setText("AgentLSUC", snap.agent.lsoNumber ?? "");
    setText("AgentCompany", snap.agent.company ?? "");
    setText("AgentAddress", snap.agent.address ?? "");
    setText("AgentPhoneNum", snap.agent.phone ?? "");
    setText("AgentMunicipality", snap.agent.municipality ?? "");
    setText("AgentProvince", snap.agent.province ?? "");
    setText("AgentPostCode", snap.agent.postalCode ?? "");
    setText("AgentFaxNum", snap.agent.fax ?? "");
  }
  stripDocumentScripts(pdf);
  return pdf.save();
}

// scripts/test-n4-pdf.ts
var pass = 0;
var fail = 0;
function eq(got, want, msg) {
  if (got === want) pass++;
  else {
    fail++;
    console.error(`FAIL: ${msg} \u2014 got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}
async function main() {
  const rentCents = 22e4;
  const arrears = deriveN4Arrears({
    rentCents,
    startDateISO: "2026-05-01",
    asOfISO: "2026-07-12",
    payments: []
  });
  const packed = packN4ArrearsRows(arrears.rows);
  const totalOwingCents = resolveN4OwingCents(arrears.computedOwingCents);
  const terminationDateISO = deriveN4TerminationDate("2026-07-12", "monthly");
  const snap = {
    tenantNames: ["Liang Wu"],
    landlordName: "Agile Real Estate Group",
    rentalUnitAddress: "123 Example St, Unit 4, Toronto, ON M5V 1A1",
    totalOwingCents,
    terminationDateISO,
    arrearsRows: packed.formRows,
    signer: { type: "landlord", firstName: "Noam", lastName: "Muscovitch", dayPhone: "416-555-0132" }
  };
  const bytes = await fillOfficialN4(snap);
  if (process.env.N4_SAMPLE_OUT) {
    import_node_fs2.default.writeFileSync(process.env.N4_SAMPLE_OUT, bytes);
  }
  const doc = await import_pdf_lib2.PDFDocument.load(bytes, { updateMetadata: false });
  const form = doc.getForm();
  const leaf2 = (n) => n.split(".").pop().replace(/\[\d+\]$/, "");
  const text = (name) => {
    for (const f of form.getFields()) {
      if (leaf2(f.getName()) === name && "getText" in f) {
        return f.getText();
      }
    }
    return void 0;
  };
  eq(totalOwingCents, 66e4, "3 unpaid months => $6,600 owing");
  eq(terminationDateISO, "2026-07-26", "termination = notice + 14");
  eq(packed.formRows.length, 3, "3 periods => 3 rows");
  eq(text("TO_TenameName"), "Liang Wu", "tenant name");
  eq(text("From_LandlordName"), "Agile Real Estate Group", "landlord name");
  eq(text("RentalUnitAddress"), "123 Example St, Unit 4, Toronto, ON M5V 1A1", "address");
  eq(text("OweMeAmount"), combAmountCents(66e4, 10), "OweMeAmount comb");
  eq(text("PayDate"), combDateISO("2026-07-26"), "PayDate = termination date comb");
  eq(text("ArrearFrom1"), combDateISO("2026-05-01"), "row1 from");
  eq(text("ArrearTo1"), combDateISO("2026-05-31"), "row1 to");
  eq(text("RentCharge1"), combAmountCents(22e4, 9), "row1 charged");
  eq(text("RentPaid1"), combAmountCents(0, 9), "row1 paid = 0");
  eq(text("RentOwe1"), combAmountCents(22e4, 10), "row1 owing");
  eq(text("TotalRentOwe"), combAmountCents(66e4, 11), "total owing comb");
  eq(text("RFirstName"), "Noam", "signer first name");
  eq(text("RLastName"), "Muscovitch", "signer last name");
  const sign = form.getFields().find((f) => leaf2(f.getName()) === "SelectSign");
  const selected = sign && "getSelected" in sign ? sign.getSelected() : void 0;
  eq(selected, "1", "SelectSign = 1 (landlord)");
  console.log(`test-n4-pdf: ${pass}/${fail}`);
  if (fail > 0) process.exit(1);
}
main().catch((e) => {
  console.error("ERR", e);
  process.exit(1);
});
