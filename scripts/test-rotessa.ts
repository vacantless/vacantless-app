// Unit tests for the Rotessa connection layer: lib/crypto.ts (AES-256-GCM
// secret encryption) + lib/rotessa.ts pure helpers. The impure pieces
// (testConnection fetch, env-reading encryptSecret/decryptSecret wrappers) are
// excluded — they're covered by the live Test-connection button.
// Run: npx tsx scripts/test-rotessa.ts
import { randomBytes } from "crypto";
import {
  parseKey,
  encryptWithKey,
  decryptWithKey,
} from "../lib/crypto";
import {
  ROTESSA_ENVIRONMENTS,
  isRotessaEnvironment,
  normalizeEnvironment,
  rotessaBaseUrl,
  environmentLabel,
  rotessaAuthHeader,
  validateApiKey,
  maskApiKey,
  classifyConnectionStatus,
  validateCustomerInput,
  buildCustomerBody,
  extractRotessaErrors,
  parseCreateCustomerResponse,
  addBusinessDays,
  toIsoDate,
  minProcessDate,
  defaultFirstProcessDate,
  isValidProcessDate,
  formatProcessDate,
  validateScheduleInput,
  centsToAmount,
  buildScheduleBody,
  parseCreateScheduleResponse,
  normalizeTransaction,
  parseTransactionReport,
  csvCell,
  transactionsToCsv,
  buildReportQuery,
} from "../lib/rotessa";

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

function throws(name: string, fn: () => unknown) {
  try {
    fn();
    failed++;
    console.error(`  ✗ ${name} (expected throw)`);
  } catch {
    passed++;
  }
}

// --- crypto: parseKey -------------------------------------------------------
const keyBytes = randomBytes(32);
ok("parseKey accepts base64 32-byte", parseKey(keyBytes.toString("base64")).equals(keyBytes));
ok("parseKey accepts hex 32-byte", parseKey(keyBytes.toString("hex")).equals(keyBytes));
throws("parseKey rejects empty", () => parseKey(""));
throws("parseKey rejects null", () => parseKey(null));
throws("parseKey rejects wrong-length base64", () => parseKey(randomBytes(16).toString("base64")));
throws("parseKey rejects garbage", () => parseKey("not-a-real-key"));

// --- crypto: round-trip -----------------------------------------------------
const key = randomBytes(32);
const secret = 'rotessa_live_key_abc123XYZ="weird"chars';
const ct1 = encryptWithKey(secret, key);
const ct2 = encryptWithKey(secret, key);
ok("roundtrip recovers plaintext", decryptWithKey(ct1, key) === secret);
ok("ciphertext is versioned v1", ct1.startsWith("v1."));
ok("ciphertext has 4 dot-parts", ct1.split(".").length === 4);
ok("same plaintext -> different ciphertext (random IV)", ct1 !== ct2);
ok("both ciphertexts decrypt to same plaintext", decryptWithKey(ct2, key) === secret);
ok("empty-string plaintext roundtrips", decryptWithKey(encryptWithKey("", key), key) === "");

// --- crypto: failure modes --------------------------------------------------
throws("decrypt with wrong key fails (auth tag)", () => decryptWithKey(ct1, randomBytes(32)));
throws("decrypt unknown format fails", () => decryptWithKey("v2.aaa.bbb.ccc", key));
throws("decrypt malformed (too few parts) fails", () => decryptWithKey("v1.aaa.bbb", key));
throws("decrypt empty fails", () => decryptWithKey("", key));
{
  // tamper with the ciphertext body -> auth tag must reject
  const parts = ct1.split(".");
  const tamperedBody = Buffer.from(parts[3], "base64");
  tamperedBody[0] ^= 0xff;
  parts[3] = tamperedBody.toString("base64");
  throws("decrypt detects tampering", () => decryptWithKey(parts.join("."), key));
}

// --- rotessa: environment ---------------------------------------------------
ok("environments are sandbox,live", ROTESSA_ENVIRONMENTS.join(",") === "sandbox,live");
ok("isRotessaEnvironment accepts sandbox", isRotessaEnvironment("sandbox"));
ok("isRotessaEnvironment accepts live", isRotessaEnvironment("live"));
ok("isRotessaEnvironment rejects junk", !isRotessaEnvironment("prod"));
ok("normalizeEnvironment unknown -> sandbox (safe default)", normalizeEnvironment("prod") === "sandbox");
ok("normalizeEnvironment null -> sandbox", normalizeEnvironment(null) === "sandbox");
ok("normalizeEnvironment keeps live", normalizeEnvironment("live") === "live");
ok("base url sandbox", rotessaBaseUrl("sandbox") === "https://sandbox-api.rotessa.com/v1");
ok("base url live", rotessaBaseUrl("live") === "https://api.rotessa.com/v1");
ok("environmentLabel sandbox", environmentLabel("sandbox") === "Sandbox (test)");
ok("environmentLabel live", environmentLabel("live") === "Live");

// --- rotessa: auth header ---------------------------------------------------
ok('auth header is Token token="..."', rotessaAuthHeader("KEY123") === 'Token token="KEY123"');

// --- rotessa: validateApiKey ------------------------------------------------
ok("validateApiKey rejects empty", validateApiKey("") .ok === false);
ok("validateApiKey rejects whitespace-only", validateApiKey("   ").ok === false);
ok("validateApiKey rejects too short", validateApiKey("abc").ok === false);
ok("validateApiKey rejects internal spaces", validateApiKey("abc def ghij").ok === false);
{
  const v = validateApiKey("  validlookingkey123  ");
  ok("validateApiKey trims + accepts", v.ok === true && v.ok && v.value === "validlookingkey123");
}

// --- rotessa: maskApiKey ----------------------------------------------------
ok("maskApiKey empty -> empty", maskApiKey("") === "");
ok("maskApiKey shows last 4", maskApiKey("abcdefghij1234").endsWith("1234"));
ok("maskApiKey hides the head", !maskApiKey("abcdefghij1234").includes("abcdef"));
ok("maskApiKey short -> all dots", maskApiKey("ab") === "••••");

// --- rotessa: classifyConnectionStatus --------------------------------------
ok("200 -> connected ok", classifyConnectionStatus(200).ok === true && classifyConnectionStatus(200).status === "connected");
ok("204 -> connected ok", classifyConnectionStatus(204).ok === true);
ok("401 -> error (key rejected)", classifyConnectionStatus(401).ok === false && classifyConnectionStatus(401).status === "error");
ok("403 -> error", classifyConnectionStatus(403).ok === false);
ok("404 -> error", classifyConnectionStatus(404).ok === false);
ok("500 -> error (unavailable)", classifyConnectionStatus(500).ok === false);
ok("418 -> error (unexpected)", classifyConnectionStatus(418).ok === false);

// --- rotessa: validateCustomerInput (increment 2) ---------------------------
{
  const v = validateCustomerInput({ name: "  Jane Doe ", email: " jane@x.io ", phone: " 555 ", customIdentifier: " ten-1 " });
  ok("validateCustomerInput trims + accepts", v.ok === true);
  if (v.ok) {
    ok("validateCustomerInput trims name", v.value.name === "Jane Doe");
    ok("validateCustomerInput trims email", v.value.email === "jane@x.io");
    ok("validateCustomerInput trims phone", v.value.phone === "555");
    ok("validateCustomerInput trims customIdentifier", v.value.customIdentifier === "ten-1");
  }
}
ok("validateCustomerInput rejects empty name", validateCustomerInput({ name: "  ", email: "a@b.c", phone: null, customIdentifier: "ten-1" }).ok === false);
ok("validateCustomerInput rejects null name", validateCustomerInput({ name: null, email: null, phone: null, customIdentifier: "ten-1" }).ok === false);
ok("validateCustomerInput rejects missing customIdentifier", validateCustomerInput({ name: "Jane", email: null, phone: null, customIdentifier: "  " }).ok === false);
{
  const v = validateCustomerInput({ name: "Jane", email: "", phone: "", customIdentifier: "ten-1" });
  ok("validateCustomerInput blank email/phone -> null", v.ok === true && v.value.email === null && v.value.phone === null);
}

// --- rotessa: buildCustomerBody ---------------------------------------------
{
  const body = buildCustomerBody({ name: "Jane Doe", email: "jane@x.io", phone: "555-1234", customIdentifier: "ten-1" });
  ok("buildCustomerBody has name", body.name === "Jane Doe");
  ok("buildCustomerBody has custom_identifier", body.custom_identifier === "ten-1");
  ok("buildCustomerBody has email", body.email === "jane@x.io");
  ok("buildCustomerBody has phone", body.phone === "555-1234");
  ok("buildCustomerBody never sends bank fields", !("account_number" in body) && !("transit_number" in body) && !("institution_number" in body));
}
{
  const body = buildCustomerBody({ name: "Jane Doe", email: null, phone: null, customIdentifier: "ten-1" });
  ok("buildCustomerBody omits empty email", !("email" in body));
  ok("buildCustomerBody omits empty phone", !("phone" in body));
  ok("buildCustomerBody keeps name + identifier when contact blank", body.name === "Jane Doe" && body.custom_identifier === "ten-1");
}

// --- rotessa: extractRotessaErrors ------------------------------------------
ok("extractRotessaErrors pulls messages", extractRotessaErrors({ errors: [{ error_code: "x", error_message: "Custom identifier has already been taken" }] })[0] === "Custom identifier has already been taken");
ok("extractRotessaErrors empty on non-object", extractRotessaErrors(null).length === 0);
ok("extractRotessaErrors empty on missing errors", extractRotessaErrors({ foo: 1 }).length === 0);
ok("extractRotessaErrors skips malformed entries", extractRotessaErrors({ errors: [{ nope: true }, { error_message: "kept" }] }).join("|") === "kept");

// --- rotessa: parseCreateCustomerResponse -----------------------------------
{
  const r = parseCreateCustomerResponse(200, { id: 12345, uuid: "u-1", custom_identifier: "ten-1" });
  ok("parse 200 numeric id -> ok customerId string", r.ok === true && r.customerId === "12345");
  ok("parse 200 carries uuid", r.ok === true && r.uuid === "u-1");
  ok("parse 200 carries custom_identifier", r.ok === true && r.customIdentifier === "ten-1");
}
ok("parse 201 string id -> ok", (() => { const r = parseCreateCustomerResponse(201, { id: "98" }); return r.ok === true && r.customerId === "98"; })());
ok("parse 2xx without id -> error (defensive)", parseCreateCustomerResponse(200, { uuid: "u" }).ok === false);
ok("parse 401 -> error", parseCreateCustomerResponse(401, null).ok === false);
{
  const r = parseCreateCustomerResponse(422, { errors: [{ error_message: "Custom identifier has already been taken" }] });
  ok("parse 422 -> error", r.ok === false);
  ok("parse 422 surfaces Rotessa message", r.ok === false && r.message.includes("already been taken"));
}
ok("parse 400 -> error", parseCreateCustomerResponse(400, null).ok === false);
ok("parse 500 -> error (unavailable)", parseCreateCustomerResponse(503, null).ok === false);
ok("parse unexpected -> error", parseCreateCustomerResponse(418, null).ok === false);

// --- rotessa: business-day + process-date helpers (increment 3) -------------
// 2026-06-15 is a Monday. +2 business days = Wednesday 2026-06-17.
ok("addBusinessDays Mon +2 = Wed", toIsoDate(addBusinessDays(new Date(Date.UTC(2026, 5, 15)), 2)) === "2026-06-17");
// 2026-06-18 is a Thursday. +2 business days skips the weekend -> Mon 2026-06-22.
ok("addBusinessDays Thu +2 skips weekend = Mon", toIsoDate(addBusinessDays(new Date(Date.UTC(2026, 5, 18)), 2)) === "2026-06-22");
// Friday 2026-06-19 +1 business day = Monday 2026-06-22.
ok("addBusinessDays Fri +1 = Mon", toIsoDate(addBusinessDays(new Date(Date.UTC(2026, 5, 19)), 1)) === "2026-06-22");
ok("minProcessDate Mon = Wed", minProcessDate("2026-06-15") === "2026-06-17");
ok("defaultFirstProcessDate mid-month = 1st of next month", defaultFirstProcessDate("2026-06-15") === "2026-07-01");
// On the 31st, the 1st of next month is only 1 day away -> bumped to min (2 biz days).
ok("defaultFirstProcessDate bumps when next-1st too soon", defaultFirstProcessDate("2026-07-31") >= minProcessDate("2026-07-31"));
ok("isValidProcessDate accepts >= min", isValidProcessDate("2026-07-01", "2026-06-15") === true);
ok("isValidProcessDate rejects too soon", isValidProcessDate("2026-06-16", "2026-06-15") === false);
ok("isValidProcessDate rejects malformed", isValidProcessDate("not-a-date", "2026-06-15") === false);
ok("isValidProcessDate rejects impossible date", isValidProcessDate("2026-02-31", "2026-01-01") === false);
ok("formatProcessDate -> Month D, YYYY", formatProcessDate("2026-07-01") === "July 1, 2026");
ok("formatProcessDate handles double-digit day", formatProcessDate("2026-12-24") === "December 24, 2026");
ok("formatProcessDate bad input -> empty", formatProcessDate("nope") === "");

// --- rotessa: validateScheduleInput -----------------------------------------
{
  const v = validateScheduleInput({ customerId: "123", amountCents: 125000, processDateIso: "2026-07-01" }, "2026-06-15");
  ok("validateScheduleInput accepts good input", v.ok === true);
  if (v.ok) {
    ok("validateScheduleInput default comment", v.value.comment === "Monthly rent via Vacantless");
    ok("validateScheduleInput carries customerId", v.value.customerId === "123");
  }
}
ok("validateScheduleInput rejects no customer", validateScheduleInput({ customerId: "", amountCents: 1000, processDateIso: "2026-07-01" }, "2026-06-15").ok === false);
ok("validateScheduleInput rejects zero amount", validateScheduleInput({ customerId: "1", amountCents: 0, processDateIso: "2026-07-01" }, "2026-06-15").ok === false);
ok("validateScheduleInput rejects negative amount", validateScheduleInput({ customerId: "1", amountCents: -5, processDateIso: "2026-07-01" }, "2026-06-15").ok === false);
ok("validateScheduleInput rejects too-soon date", validateScheduleInput({ customerId: "1", amountCents: 1000, processDateIso: "2026-06-15" }, "2026-06-15").ok === false);
{
  const v = validateScheduleInput({ customerId: "1", amountCents: 1000, processDateIso: "2026-07-01", comment: " Unit 4 rent " }, "2026-06-15");
  ok("validateScheduleInput trims custom comment", v.ok === true && v.value.comment === "Unit 4 rent");
}

// --- rotessa: centsToAmount + buildScheduleBody -----------------------------
ok("centsToAmount whole dollars", centsToAmount(125000) === 1250);
ok("centsToAmount with cents", centsToAmount(125050) === 1250.5);
{
  const body = buildScheduleBody({ customerId: "789", amountCents: 125000, processDateIso: "2026-07-01", comment: "Rent" });
  ok("buildScheduleBody customer_id", body.customer_id === "789");
  ok("buildScheduleBody amount in dollars", body.amount === 1250);
  ok("buildScheduleBody frequency Monthly", body.frequency === "Monthly");
  ok("buildScheduleBody process_date formatted", body.process_date === "July 1, 2026");
  ok("buildScheduleBody omits installments (indefinite)", !("installments" in body));
}

// --- rotessa: parseCreateScheduleResponse -----------------------------------
{
  const r = parseCreateScheduleResponse(200, { id: 435194, next_process_date: "2026-07-01" });
  ok("parse schedule 200 -> ok id", r.ok === true && r.scheduleId === "435194");
  ok("parse schedule 200 carries next_process_date", r.ok === true && r.nextProcessDate === "2026-07-01");
}
ok("parse schedule 2xx without id -> error", parseCreateScheduleResponse(201, {}).ok === false);
ok("parse schedule 401 -> error", parseCreateScheduleResponse(401, null).ok === false);
{
  const r = parseCreateScheduleResponse(422, { errors: [{ error_message: "Customer bank information is incomplete." }] });
  ok("parse schedule 422 -> error", r.ok === false);
  ok("parse schedule 422 surfaces bank message", r.ok === false && r.message.includes("bank information"));
}
ok("parse schedule 422 no detail -> bank hint", (() => { const r = parseCreateScheduleResponse(422, null); return r.ok === false && r.message.toLowerCase().includes("authorize their bank"); })());
ok("parse schedule 500 -> error", parseCreateScheduleResponse(500, null).ok === false);

// --- rotessa: transaction report parsing + CSV ------------------------------
{
  const tx = normalizeTransaction({ id: 1233, custom_identifier: "ten-1", customer_id: 1, amount: "1250.00", process_date: "2026-07-01", settlement_date: "2026-07-08", status: "Approved", status_reason: null, comment: "Rent" });
  ok("normalizeTransaction id -> string", tx.id === "1233");
  ok("normalizeTransaction customerId -> string", tx.customerId === "1");
  ok("normalizeTransaction amount", tx.amount === "1250.00");
  ok("normalizeTransaction status", tx.status === "Approved");
  ok("normalizeTransaction null reason stays null", tx.statusReason === null);
}
ok("parseTransactionReport non-array -> []", parseTransactionReport({ foo: 1 }).length === 0);
ok("parseTransactionReport array -> rows", parseTransactionReport([{ id: 1 }, { id: 2 }]).length === 2);

ok("csvCell plain passes through", csvCell("Approved") === "Approved");
ok("csvCell null -> empty", csvCell(null) === "");
ok("csvCell with comma is quoted", csvCell("Smith, John") === '"Smith, John"');
ok("csvCell with quote is escaped", csvCell('a"b') === '"a""b"');
ok("csvCell with newline is quoted", csvCell("a\nb") === '"a\nb"');
{
  const csv = transactionsToCsv(parseTransactionReport([
    { id: 1, custom_identifier: "ten-1", customer_id: 1, amount: "1250.00", process_date: "2026-07-01", settlement_date: "2026-07-08", status: "Approved", status_reason: null, comment: "Rent" },
  ]));
  const lines = csv.split("\r\n");
  ok("transactionsToCsv has header", lines[0].startsWith("Transaction ID,Reference,"));
  ok("transactionsToCsv has data row", lines[1].startsWith("1,ten-1,1,1250.00,"));
  ok("transactionsToCsv row count", lines.length === 2);
}
ok("transactionsToCsv empty -> header only", transactionsToCsv([]).split("\r\n").length === 1);

// --- rotessa: buildReportQuery ----------------------------------------------
ok("buildReportQuery empty -> ''", buildReportQuery({}) === "");
ok("buildReportQuery start+end", buildReportQuery({ startDate: "2026-01-01", endDate: "2026-12-31" }) === "?start_date=2026-01-01&end_date=2026-12-31");
ok("buildReportQuery status only", buildReportQuery({ status: "Approved" }) === "?status=Approved");

console.log(`\nrotessa: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
