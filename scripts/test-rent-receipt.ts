// Unit tests for the annual rent-receipt builder (S382).
// Run: npx tsx scripts/test-rent-receipt.ts
import {
  paymentYear,
  paymentsInYear,
  sumPaymentsCents,
  availableReceiptYears,
  defaultReceiptYear,
  buildRentReceiptModel,
  renderRentReceiptHtml,
  type RentReceiptPayment,
} from "../lib/rent-receipt";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

const pay = (paid_on: string, amount_cents: number, extra: Partial<RentReceiptPayment> = {}): RentReceiptPayment => ({
  amount_cents,
  method: "e_transfer",
  paid_on,
  period_month: null,
  reference: null,
  note: null,
  ...extra,
});

const ledger: RentReceiptPayment[] = [
  pay("2025-01-03", 220000, { period_month: "2025-01-01", method: "cheque", reference: "0101" }),
  pay("2025-02-02", 220000, { period_month: "2025-02-01" }),
  pay("2025-12-30", 220000, { period_month: "2025-12-01" }),
  pay("2024-11-01", 210000, { period_month: "2024-11-01", method: "cash" }),
  pay("2026-01-02", 230000, { period_month: "2026-01-01" }),
];

// --- paymentYear ------------------------------------------------------------
ok("paymentYear parses YYYY", paymentYear("2025-03-15") === 2025);
ok("paymentYear null on junk", paymentYear("nope") === null);
ok("paymentYear null on empty", paymentYear(null) === null);
ok("paymentYear null on bad month", paymentYear("2025-13-01") === null);

// --- paymentsInYear ---------------------------------------------------------
const y2025 = paymentsInYear(ledger, 2025);
ok("2025 has 3 payments", y2025.length === 3);
ok("2025 excludes 2024 + 2026", y2025.every((p) => paymentYear(p.paid_on) === 2025));
ok("paymentsInYear sorts ascending", y2025[0].paid_on === "2025-01-03" && y2025[2].paid_on === "2025-12-30");
ok("2024 has 1 payment", paymentsInYear(ledger, 2024).length === 1);
ok("2099 has 0 payments", paymentsInYear(ledger, 2099).length === 0);

// --- sum --------------------------------------------------------------------
ok("2025 total = 660000", sumPaymentsCents(y2025) === 660000);
ok("empty sum = 0", sumPaymentsCents([]) === 0);

// --- available years + default ----------------------------------------------
ok("available years desc", availableReceiptYears(ledger).join(",") === "2026,2025,2024");
ok("default year = most recent with payments", defaultReceiptYear(ledger, 2030) === 2026);
ok("default year = currentYear when no payments", defaultReceiptYear([], 2030) === 2030);

// --- model build ------------------------------------------------------------
const model = buildRentReceiptModel({
  landlordName: "North Star Rentals",
  landlordPhone: "555-1212",
  landlordEmail: "hi@northstar.test",
  tenantNames: ["Liang Wu", "  ", "Sam Park"],
  rentalUnitAddress: "18 Shorncliffe Avenue",
  year: 2025,
  payments: ledger,
  generatedAtIso: "2026-06-29T12:00:00.000Z",
});
ok("model filters to the year", model.count === 3 && model.payments.length === 3);
ok("model total", model.totalCents === 660000);
ok("model first/last paid", model.firstPaidOn === "2025-01-03" && model.lastPaidOn === "2025-12-30");
ok("model drops blank tenant names", model.tenantNames.length === 2);

const empty = buildRentReceiptModel({
  landlordName: "North Star Rentals",
  landlordPhone: null,
  landlordEmail: null,
  tenantNames: [],
  rentalUnitAddress: null,
  year: 2099,
  payments: ledger,
  generatedAtIso: "2026-06-29T12:00:00.000Z",
});
ok("empty year: count 0, total 0, null bounds", empty.count === 0 && empty.totalCents === 0 && empty.firstPaidOn === null);

// --- render -----------------------------------------------------------------
const html = renderRentReceiptHtml(model);
ok("html is a full document", html.startsWith("<!doctype html>") && html.includes("</html>"));
ok("html shows the year", html.includes("Rent Receipt — 2025"));
ok("html shows the total", html.includes("$6,600"));
ok("html lists tenants", html.includes("Liang Wu, Sam Park"));
ok("html shows the address", html.includes("18 Shorncliffe Avenue"));

const emptyHtml = renderRentReceiptHtml(empty);
ok("empty html warns no payments", emptyHtml.includes("No rent payments are recorded for 2099"));

// XSS-escape: a malicious note/reference must not break out into markup.
const xss = buildRentReceiptModel({
  landlordName: "<script>bad</script>",
  landlordPhone: null,
  landlordEmail: null,
  tenantNames: ["A&B <Co>"],
  rentalUnitAddress: null,
  year: 2025,
  payments: [pay("2025-05-01", 100000, { reference: "<img src=x>" })],
  generatedAtIso: "2026-06-29T12:00:00.000Z",
});
const xssHtml = renderRentReceiptHtml(xss);
ok("escapes landlord script", !xssHtml.includes("<script>bad</script>") && xssHtml.includes("&lt;script&gt;bad"));
ok("escapes tenant entities", xssHtml.includes("A&amp;B &lt;Co&gt;"));
ok("escapes reference html", !xssHtml.includes("<img src=x>") && xssHtml.includes("&lt;img src=x&gt;"));

// --- masthead: logo + brand color (S382, official letterhead) ---------------
const branded = buildRentReceiptModel({
  landlordName: "North Star Rentals",
  landlordPhone: "555-1212",
  landlordEmail: "hi@northstar.test",
  landlordLogoUrl: "https://cdn.example.com/logo.png",
  brandColor: "#0a7d3b",
  tenantNames: ["Liang Wu"],
  rentalUnitAddress: "18 Shorncliffe Avenue",
  year: 2025,
  payments: ledger,
  generatedAtIso: "2026-06-29T12:00:00.000Z",
});
const brandedHtml = renderRentReceiptHtml(branded);
ok("renders the logo img", brandedHtml.includes('<img class="logo" src="https://cdn.example.com/logo.png"'));
ok("applies the brand color accent", brandedHtml.includes("#0a7d3b"));
ok("shows org contact in the masthead", brandedHtml.includes("555-1212") && brandedHtml.includes("hi@northstar.test"));
ok("model defaults logo/brand to null when omitted", model.landlordLogoUrl === null && model.brandColor === null);

// A non-http(s) logo URL (javascript:) must be dropped, not rendered.
const evil = buildRentReceiptModel({
  landlordName: "North Star Rentals",
  landlordPhone: null,
  landlordEmail: null,
  landlordLogoUrl: "javascript:alert(1)",
  brandColor: "red; } body { display:none } .x{",
  tenantNames: [],
  rentalUnitAddress: null,
  year: 2025,
  payments: ledger,
  generatedAtIso: "2026-06-29T12:00:00.000Z",
});
const evilHtml = renderRentReceiptHtml(evil);
ok("drops a javascript: logo url", !evilHtml.includes("javascript:alert"));
ok("rejects a non-hex brand color (falls back to ink)", !evilHtml.includes("display:none") && evilHtml.includes("#1a1a1a"));

// --- summary ----------------------------------------------------------------
console.log(`\nrent-receipt: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
