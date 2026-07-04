// Unit tests for the pure bank-import seam. Run: npx tsx scripts/test-bank-import.ts
import {
  parseOfx,
  ofxTagValue,
  ofxDateToIso,
  ofxAmountToCents,
  maskAccountId,
  deriveAccountKey,
} from "../lib/bank-import/ofx";
import {
  parseImportFile,
  detectImportFormat,
  importConnectionExternalId,
  defaultImportLabel,
} from "../lib/bank-import";
import { filterNewTransactions } from "../lib/bank-feed";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

// --- Small pure helpers ------------------------------------------------------
ok("ofxTagValue reads a leaf value (unclosed SGML)", ofxTagValue("<FITID>ABC123\n<NAME>x", "FITID") === "ABC123");
ok("ofxTagValue reads a closed leaf", ofxTagValue("<TRNAMT>-42.30</TRNAMT>", "TRNAMT") === "-42.30");
ok("ofxTagValue is case-insensitive", ofxTagValue("<fitid>zz9", "FITID") === "zz9");
ok("ofxTagValue null when absent", ofxTagValue("<NAME>x", "FITID") === null);

ok("ofxDateToIso strips time", ofxDateToIso("20260704120000") === "2026-07-04");
ok("ofxDateToIso strips tz suffix", ofxDateToIso("20260704120000.000[-5:EST]") === "2026-07-04");
ok("ofxDateToIso plain date", ofxDateToIso("20251231") === "2025-12-31");
ok("ofxDateToIso rejects short", ofxDateToIso("2026") === null);
ok("ofxDateToIso rejects bad month", ofxDateToIso("20261301") === null);

ok("ofxAmountToCents negative", ofxAmountToCents("-42.30") === -4230);
ok("ofxAmountToCents positive whole", ofxAmountToCents("1200") === 120000);
ok("ofxAmountToCents strips grouping comma", ofxAmountToCents("1,200.00") === 120000);
ok("ofxAmountToCents leading plus", ofxAmountToCents("+9.99") === 999);
ok("ofxAmountToCents rejects junk", ofxAmountToCents("abc") === null);
ok("ofxAmountToCents rejects empty", ofxAmountToCents("") === null);

ok("maskAccountId keeps last 4 only", maskAccountId("4510123456781234") === "1234");
ok("maskAccountId ignores separators", maskAccountId("4510-1234-5678-9abc") === "9abc");
ok("maskAccountId null for empty", maskAccountId("") === null);

// --- A representative OFX/QFX body -------------------------------------------
const OFX = `OFXHEADER:100
DATA:OFXSGML
<OFX>
<CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS>
<CURDEF>CAD
<CCACCTFROM><ACCTID>5412345678901234<ACCTTYPE>CREDITCARD</CCACCTFROM>
<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260703120000.000[-5:EST]<TRNAMT>-42.30<FITID>F1<NAME>ENBRIDGE GAS<MEMO>Autopay</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260701<TRNAMT>1200.00<FITID>F2<NAME>PAYMENT THANK YOU</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260704<TRNAMT>-15.00<FITID>F3<MEMO>HYDRO ONE</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260705<TRNAMT>-9.99<NAME>NO FITID ROW</STMTTRN>
</BANKTRANLIST>
</CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1>
</OFX>`;

const r = parseOfx(OFX);
ok("parseOfx ok", r.ok === true);
if (r.ok) {
  ok("currency parsed", r.currency === "CAD");
  ok("account masked to last 4 only", r.accountMask === "1234");
  ok("account type read", r.accountType === "CREDITCARD");
  ok("4 STMTTRN blocks seen", r.totalBlocks === 4);
  ok("1 skipped (missing FITID)", r.skipped === 1);
  ok("3 valid txns", r.txns.length === 3);

  const f1 = r.txns.find((t) => t.externalId === "F1")!;
  ok("F1 is a debit (negative = outflow)", f1.direction === "debit");
  ok("F1 amount is absolute cents", f1.amountCents === 4230);
  ok("F1 date stripped of time+tz", f1.postedOn === "2026-07-03");
  ok("F1 merchant from NAME", f1.merchant === "ENBRIDGE GAS");
  ok("F1 description from MEMO", f1.description === "Autopay");
  ok("F1 no provider enrichment", f1.merchantEntityId === null && f1.streamId === null);

  const f2 = r.txns.find((t) => t.externalId === "F2")!;
  ok("F2 is a credit (positive = inflow)", f2.direction === "credit");
  ok("F2 amount cents", f2.amountCents === 120000);

  const f3 = r.txns.find((t) => t.externalId === "F3")!;
  ok("F3 merchant falls back to MEMO", f3.merchant === "HYDRO ONE");

  // Full ACCTID must NEVER survive anywhere in the output.
  ok("raw ACCTID never leaked in txns", !JSON.stringify(r.txns).includes("5412345678901234"));
  ok("raw ACCTID never leaked in mask", r.accountMask !== "5412345678901234");
}

// --- Re-import stability + dedupe --------------------------------------------
const again = parseOfx(OFX);
if (r.ok && again.ok) {
  const ids1 = r.txns.map((t) => t.externalId).sort();
  const ids2 = again.txns.map((t) => t.externalId).sort();
  ok("re-parse yields identical external_ids", JSON.stringify(ids1) === JSON.stringify(ids2));

  // Simulate an overlapping re-import where F1/F2 already staged: only F3 is new.
  const existing = new Set(["F1", "F2"]);
  const fresh = filterNewTransactions(again.txns, existing);
  ok("overlapping re-import stages only new rows", fresh.length === 1 && fresh[0].externalId === "F3");

  // A file with no overlap re-imported against all-known stages nothing.
  const none = filterNewTransactions(again.txns, new Set(["F1", "F2", "F3"]));
  ok("fully-overlapping re-import stages nothing", none.length === 0);
}

// --- P2: per-account key separation (two accounts sharing a last-4) ----------
const SECRET = "test-hmac-secret-key";
// Same last-4 (1234) as OFX (ACCTID 5412345678901234), DIFFERENT full number.
const OFX_SAME_LAST4 = OFX.replace("5412345678901234", "9999888877771234");

ok("deriveAccountKey null without a secret", deriveAccountKey("5412345678901234", "CREDITCARD", "") === null);
ok("deriveAccountKey null without an acctid", deriveAccountKey("", "CREDITCARD", SECRET) === null);
ok("deriveAccountKey is 24 hex chars", /^[0-9a-f]{24}$/.test(deriveAccountKey("5412345678901234", "CREDITCARD", SECRET) || ""));
ok(
  "deriveAccountKey deterministic for the same account",
  deriveAccountKey("5412345678901234", "CREDITCARD", SECRET) === deriveAccountKey("5412345678901234", "CREDITCARD", SECRET),
);
ok(
  "deriveAccountKey differs for different full numbers with the SAME last-4",
  deriveAccountKey("5412345678901234", "CREDITCARD", SECRET) !== deriveAccountKey("9999888877771234", "CREDITCARD", SECRET),
);
ok(
  "deriveAccountKey never contains the raw acctid",
  !(deriveAccountKey("5412345678901234", "CREDITCARD", SECRET) || "").includes("5412345678901234"),
);

const keyed = parseOfx(OFX, { accountKeySecret: SECRET });
const keyedSame4 = parseOfx(OFX_SAME_LAST4, { accountKeySecret: SECRET });
if (keyed.ok && keyedSame4.ok) {
  ok("keyed parse sets a 24-hex accountKey", typeof keyed.accountKey === "string" && /^[0-9a-f]{24}$/.test(keyed.accountKey));
  ok("both files share the same last-4 mask", keyed.accountMask === "1234" && keyedSame4.accountMask === "1234");
  ok("P2: same last-4 + different account -> DIFFERENT accountKey", keyed.accountKey !== keyedSame4.accountKey);
  ok(
    "P2: -> different connection external_id (no merge)",
    importConnectionExternalId("ofx", keyed.accountKey, "MBNA") !== importConnectionExternalId("ofx", keyedSame4.accountKey, "MBNA"),
  );
  ok("raw acctid never leaks into the keyed parse output", !JSON.stringify(keyed).includes("5412345678901234"));
  const keyedAgain = parseOfx(OFX, { accountKeySecret: SECRET });
  ok("same account re-import reuses the same key (idempotent)", keyedAgain.ok && keyedAgain.accountKey === keyed.accountKey);
}
const unkeyed = parseOfx(OFX); // no secret -> falls back to the label key downstream
ok("no secret -> accountKey null", unkeyed.ok && unkeyed.accountKey === null);

// --- Empty / no-transaction bodies -------------------------------------------
ok("parseOfx empty -> not ok", parseOfx("   ").ok === false);
const noTxn = parseOfx("<OFX><BANKTRANLIST></BANKTRANLIST></OFX>");
ok("parseOfx no STMTTRN -> no_transactions", noTxn.ok === false && noTxn.reason === "no_transactions");

// --- Format detection + the file seam ----------------------------------------
ok("detect .ofx by extension", detectImportFormat("mbna.ofx", "") === "ofx");
ok("detect .qfx by extension", detectImportFormat("mbna.QFX", "") === "ofx");
ok("detect ofx by content when extension unknown", detectImportFormat("download.txt", "OFXHEADER:100") === "ofx");
ok("detect .csv by extension", detectImportFormat("mbna.csv", "") === "csv");
ok("detect unknown", detectImportFormat("notes.pdf", "%PDF-1.7") === null);

const pf = parseImportFile({ filename: "mbna.ofx", content: OFX });
ok("parseImportFile ofx ok", pf.ok === true && pf.format === "ofx" && pf.txns.length === 3);
const pfCsv = parseImportFile({ filename: "mbna.csv", content: "Date,Description,Amount\n2026-07-01,x,-5.00" });
ok("parseImportFile csv -> csv_unsupported (slice 3)", pfCsv.ok === false && pfCsv.reason === "csv_unsupported");
const pfUnknown = parseImportFile({ filename: "x.pdf", content: "%PDF" });
ok("parseImportFile unknown -> unknown_format", pfUnknown.ok === false && pfUnknown.reason === "unknown_format");

// --- Connection identity + labels --------------------------------------------
ok(
  "connection external_id keys on the account key (stable across re-import)",
  importConnectionExternalId("ofx", "abc123", "whatever") === importConnectionExternalId("ofx", "abc123", "different label"),
);
ok("connection external_id from an account key is tagged a:", importConnectionExternalId("ofx", "abc123", "x") === "ofx:a:abc123");
ok(
  "connection external_id falls back to a tagged label key when no account key",
  importConnectionExternalId("ofx", null, "MBNA Mastercard!") === "ofx:l:mbna-mastercard",
);
ok(
  "two different account keys never collide",
  importConnectionExternalId("ofx", "keyAAA", "x") !== importConnectionExternalId("ofx", "keyBBB", "x"),
);
ok("defaultImportLabel card + mask", defaultImportLabel("1234", "CREDITCARD") === "Imported card ····1234");
ok("defaultImportLabel account fallback", defaultImportLabel(null, "CHECKING") === "Imported account");

// --- Summary -----------------------------------------------------------------
console.log(`\nbank-import: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
