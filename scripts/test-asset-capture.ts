// Unit tests for the PURE asset-capture parse contract (S364): JSON extraction,
// the normalizer (plate + receipt branches, clamping, junk rejection), the
// empty-draft guard, and the query round-trip. The impure vision call
// (lib/asset-capture-vision.ts) is NOT tested here — it live-proves on deploy.
// Run:  npx tsx scripts/test-asset-capture.ts
import {
  extractJsonObject,
  normalizeAssetDraft,
  isEmptyDraft,
  plateFieldsToQuery,
  appliancePrefillFromQuery,
  scanExpensePrefillFromQuery,
  primaryConsumable,
  buildExtractionPrompt,
  MAX_INSTALL_YEAR,
  MIN_INSTALL_YEAR,
  MAX_WARRANTY_MONTHS,
  MAX_CONSUMABLE_MONTHS,
  MAX_TEXT_LEN,
  type AssetDraft,
  type PlateDraft,
  type ReceiptDraft,
} from "../lib/asset-capture";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

// --- extractJsonObject ------------------------------------------------------
ok("plain json", extractJsonObject('{"a":1}')?.a === 1);
ok(
  "json in prose",
  extractJsonObject('Here you go: {"make":"Whirlpool"} hope that helps')?.make === "Whirlpool",
);
ok(
  "json in fences",
  extractJsonObject('```json\n{"model":"WRF555"}\n```')?.model === "WRF555",
);
ok(
  "nested braces not truncated",
  (extractJsonObject('{"a":{"b":2},"c":3}')?.c as number) === 3,
);
ok(
  "brace inside string ignored",
  extractJsonObject('{"note":"a } b","x":9}')?.x === 9,
);
ok("no object -> null", extractJsonObject("nothing here") === null);
ok("array -> null", extractJsonObject("[1,2,3]") === null);
ok("non-string -> null", extractJsonObject(42 as unknown) === null);
ok("malformed -> null", extractJsonObject('{"a":') === null);

// --- normalizeAssetDraft: plate branch --------------------------------------
const plate = normalizeAssetDraft({
  kind: "plate",
  appliance_type: "Fridge", // case-insensitive -> normalizes to "fridge"
  make: "  Whirlpool  ",
  model: "WRF555SDFZ",
  serial: "ABC123",
  install_year: 2021,
  warranty_months: 24,
}) as PlateDraft;
ok("plate kind", plate.kind === "plate");
ok("appliance_type case-insensitive (Fridge -> fridge)", plate.appliance_type === "fridge");
ok("text trimmed/collapsed", plate.make === "Whirlpool");
ok("model kept", plate.model === "WRF555SDFZ");
ok("install_year kept", plate.install_year === 2021);
ok("warranty kept", plate.warranty_months === 24);

const plate2 = normalizeAssetDraft({
  appliance_type: "dishwasher", // no kind key -> defaults to plate
  serial: "n/a", // junk sentinel -> null
  install_year: "1700", // below min -> null
  warranty_months: 99999, // above max -> null
}) as PlateDraft;
ok("kindless defaults to plate", plate2.kind === "plate");
ok("valid lowercase type kept", plate2.appliance_type === "dishwasher");
ok("sentinel 'n/a' -> null", plate2.serial === null);
ok("year below min rejected", plate2.install_year === null);
ok("warranty above max rejected", plate2.warranty_months === null);

ok(
  "year ceiling respected",
  (normalizeAssetDraft({ install_year: MAX_INSTALL_YEAR + 5 }) as PlateDraft).install_year === null,
);
ok(
  "year at min kept",
  (normalizeAssetDraft({ install_year: MIN_INSTALL_YEAR }) as PlateDraft).install_year ===
    MIN_INSTALL_YEAR,
);
ok(
  "warranty at max kept",
  (normalizeAssetDraft({ warranty_months: MAX_WARRANTY_MONTHS }) as PlateDraft).warranty_months ===
    MAX_WARRANTY_MONTHS,
);
ok(
  "long text truncated to ceiling",
  ((normalizeAssetDraft({ make: "x".repeat(500) }) as PlateDraft).make ?? "").length ===
    MAX_TEXT_LEN,
);
ok(
  "numeric string year coerced",
  (normalizeAssetDraft({ install_year: "2019" }) as PlateDraft).install_year === 2019,
);

// --- normalizeAssetDraft: receipt branch ------------------------------------
const receipt = normalizeAssetDraft({
  kind: "receipt",
  merchant: "Home Depot",
  purchase_date: "2026-03-15",
  total_cents: 129999,
  make: "LG",
  model: "LFXS26973S",
}) as ReceiptDraft;
ok("receipt kind", receipt.kind === "receipt");
ok("merchant kept", receipt.merchant === "Home Depot");
ok("date kept", receipt.purchase_date === "2026-03-15");
ok("total kept", receipt.total_cents === 129999);
ok("receipt also carries appliance fields", receipt.make === "LG" && receipt.model === "LFXS26973S");

// kindless but receipt-signal (merchant/total present) routes to receipt
const inferredReceipt = normalizeAssetDraft({ merchant: "Costco", total: 89900 }) as ReceiptDraft;
ok("merchant signal infers receipt", inferredReceipt.kind === "receipt");
ok("total alias accepted", inferredReceipt.total_cents === 89900);

ok(
  "bad receipt date rejected",
  (normalizeAssetDraft({ kind: "receipt", purchase_date: "March 5th" }) as ReceiptDraft)
    .purchase_date === null,
);
ok(
  "impossible month rejected",
  (normalizeAssetDraft({ kind: "receipt", purchase_date: "2026-13-01" }) as ReceiptDraft)
    .purchase_date === null,
);

// --- normalizer guards ------------------------------------------------------
ok("null input -> null", normalizeAssetDraft(null) === null);
ok("array input -> null", normalizeAssetDraft([1, 2]) === null);
ok("string input -> null", normalizeAssetDraft("nope") === null);

// --- isEmptyDraft -----------------------------------------------------------
ok("all-null plate is empty", isEmptyDraft(normalizeAssetDraft({ kind: "plate" })));
ok("all-null receipt is empty", isEmptyDraft(normalizeAssetDraft({ kind: "receipt" })));
ok("one-field plate not empty", !isEmptyDraft(normalizeAssetDraft({ make: "GE" })));
ok("null draft is empty", isEmptyDraft(null));

// --- query round-trip (the scan-redirect prefill) ---------------------------
const src: AssetDraft = {
  kind: "plate",
  appliance_type: "washer",
  make: "Samsung",
  model: "WA50R5400AV",
  serial: "S9-001",
  install_year: 2022,
  warranty_months: 36,
  recommended_consumables: [],
};
const q = plateFieldsToQuery(src);
ok("query has type", q.sc_type === "washer");
ok("query has make", q.sc_make === "Samsung");
ok("query has year", q.sc_year === "2022");
ok("query has warranty", q.sc_warranty === "36");
const back = appliancePrefillFromQuery(q)!;
ok("round-trip type", back.appliance_type === "washer");
ok("round-trip make", back.make === "Samsung");
ok("round-trip serial", back.serial === "S9-001");
ok("round-trip year", back.install_year === 2022);
ok("round-trip warranty", back.warranty_months === 36);

// hand-edited / junk query is re-clamped
const dirty = appliancePrefillFromQuery({
  sc_type: "spaceship", // not a valid type -> null
  sc_year: "1700", // below min -> null
  sc_make: "GE",
})!;
ok("dirty type rejected", dirty.appliance_type === null);
ok("dirty year rejected", dirty.install_year === null);
ok("dirty make survives", dirty.make === "GE");
ok("empty query -> null", appliancePrefillFromQuery({}) === null);

// receipt-only fields don't populate the appliance prefill query unnecessarily
const receiptSrc: AssetDraft = {
  kind: "receipt",
  merchant: "Lowes",
  purchase_date: "2026-01-02",
  total_cents: 50000,
  appliance_type: "stove",
  make: "Frigidaire",
  model: "FFEF3054TS",
  serial: null,
  recommended_consumables: [],
};
const rq = plateFieldsToQuery(receiptSrc);
ok("receipt feeds appliance query subset", rq.sc_type === "stove" && rq.sc_make === "Frigidaire");
ok("receipt query omits plate-only year", rq.sc_year === undefined);
// S366: a receipt also carries the expense fields (merchant / date / total).
ok("receipt query carries merchant", rq.sc_merchant === "Lowes");
ok("receipt query carries purchase date", rq.sc_pdate === "2026-01-02");
ok("receipt query carries total cents", rq.sc_total === "50000");

// scanExpensePrefillFromQuery rebuilds the receipt expense prefill (re-clamped).
const exp = scanExpensePrefillFromQuery(rq)!;
ok("scan-expense prefill total", exp.total_cents === 50000);
ok("scan-expense prefill merchant", exp.merchant === "Lowes");
ok("scan-expense prefill date", exp.purchase_date === "2026-01-02");
ok("scan-expense prefill carries appliance type", exp.appliance_type === "stove");
ok("scan-expense prefill carries make", exp.make === "Frigidaire");
// gated on a parseable total: a plate scan (no total) offers no expense
ok("plate query -> no expense prefill", scanExpensePrefillFromQuery(plateFieldsToQuery(src)) === null);
ok("no total -> no expense prefill", scanExpensePrefillFromQuery({ sc_merchant: "Lowes" }) === null);
ok("zero total -> no expense prefill", scanExpensePrefillFromQuery({ sc_total: "0" }) === null);
ok(
  "hand-edited junk total rejected",
  scanExpensePrefillFromQuery({ sc_total: "abc", sc_merchant: "X" }) === null,
);
// a total alone (no merchant/date) is still a valid expense offer
const totalOnly = scanExpensePrefillFromQuery({ sc_total: "1299" })!;
ok("total-only prefill is offered", totalOnly.total_cents === 1299 && totalOnly.merchant === null);

// --- recommended consumables (manufacturer replacement schedule, S364) -------
const withConsumables = normalizeAssetDraft({
  kind: "plate",
  appliance_type: "fridge",
  make: "Whirlpool",
  recommended_consumables: [
    { label: "Water filter", interval_months: 6 },
    { label: "Air filter", months: 12 }, // alias accepted
    { label: "", interval_months: 3 }, // no label -> dropped
    { label: "Bad", interval_months: 999 }, // out of range -> dropped
  ],
}) as PlateDraft;
ok("two valid consumables kept", withConsumables.recommended_consumables.length === 2);
ok(
  "first consumable parsed",
  withConsumables.recommended_consumables[0].label === "Water filter" &&
    withConsumables.recommended_consumables[0].interval_months === 6,
);
ok("interval alias 'months' accepted", withConsumables.recommended_consumables[1].interval_months === 12);
ok("primaryConsumable is the first", primaryConsumable(withConsumables)?.label === "Water filter");
ok(
  "consumable interval ceiling enforced",
  (normalizeAssetDraft({
    recommended_consumables: [{ label: "x", interval_months: MAX_CONSUMABLE_MONTHS + 1 }],
  }) as PlateDraft).recommended_consumables.length === 0,
);
ok(
  "single consumable object (not array) tolerated",
  (normalizeAssetDraft({ recommended_consumables: { label: "Filter", interval_months: 4 } }) as PlateDraft)
    .recommended_consumables.length === 1,
);
ok(
  "plate with only a consumable is NOT empty",
  !isEmptyDraft(normalizeAssetDraft({ recommended_consumables: [{ label: "Filter", months: 6 }] })),
);

// consumable rides the query round-trip into the prefill
const cq = plateFieldsToQuery(withConsumables);
ok("query carries consumable label", cq.sc_clabel === "Water filter");
ok("query carries consumable months", cq.sc_cmonths === "6");
const cback = appliancePrefillFromQuery(cq)!;
ok("prefill consumable label", cback.consumable_label === "Water filter");
ok("prefill consumable months", cback.consumable_interval_months === 6);

// --- prompt sanity ----------------------------------------------------------
const prompt = buildExtractionPrompt();
ok("prompt names plate branch", prompt.includes('"kind":"plate"'));
ok("prompt names receipt branch", prompt.includes('"kind":"receipt"'));
ok("prompt lists fridge type", prompt.includes("fridge"));
ok("prompt asks for recommended_consumables", prompt.includes("recommended_consumables"));

// ---------------------------------------------------------------------------
console.log(`\nasset-capture: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
