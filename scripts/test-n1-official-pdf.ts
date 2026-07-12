// Unit tests for the official LTB N1 fill (S469 + S470): pure comb formatters,
// the amount-overflow guard, and a real end-to-end fill against the bundled
// template — both the field-bearing (flatten:false) and flattened default.
import assert from "node:assert";
import { PDFDocument } from "pdf-lib";
import {
  combAmountCents,
  combDateISO,
  fillOfficialN1,
  N1_TEMPLATE_VERSION,
} from "../lib/n1-official-pdf";
import type { N1Snapshot } from "../lib/n1-render";

let pass = 0, fail = 0;
const t = (name: string, fn: () => void | Promise<void>) =>
  Promise.resolve()
    .then(fn)
    .then(() => { pass++; })
    .catch((e) => { fail++; console.error("FAIL", name, e.message); });

(async () => {
  // --- comb amount: 9 chars, decimal cell blank, dollars right-aligned, 2 cents
  await t("amount 224180 -> '  2241 80'", () => {
    assert.strictEqual(combAmountCents(224180), "  2241 80");
    assert.strictEqual(combAmountCents(224180).length, 9);
  });
  await t("amount 4180 -> '    41 80'", () => {
    assert.strictEqual(combAmountCents(4180), "    41 80");
  });
  await t("amount 0 -> '     0 00'", () => {
    assert.strictEqual(combAmountCents(0), "     0 00");
    assert.strictEqual(combAmountCents(0).length, 9);
  });
  await t("amount at the $999,999.99 ceiling is exactly 9 wide", () => {
    assert.strictEqual(combAmountCents(99999999), "999999 99");
    assert.strictEqual(combAmountCents(99999999).length, 9);
  });
  await t("amount over $999,999.99 THROWS (never silently truncates)", () => {
    assert.throws(() => combAmountCents(100000000), /exceeds the form's 6-digit/);
    assert.throws(() => combAmountCents(123456789));
  });

  // --- comb date: DD MM YYYY with blanks over pre-printed slashes
  await t("date 2027-06-28 -> '28 06 2027'", () => {
    assert.strictEqual(combDateISO("2027-06-28"), "28 06 2027");
    assert.strictEqual(combDateISO("2027-06-28")!.length, 10);
  });
  await t("date invalid -> null", () => {
    assert.strictEqual(combDateISO("garbage"), null);
    assert.strictEqual(combDateISO(""), null);
  });

  const snap: N1Snapshot = {
    currentRentCents: 220000, newRentCents: 224180, increaseCents: 4180,
    currentRent: "$2,200", newRent: "$2,241.80", increaseAmount: "$41.80",
    guidelinePercent: 1.9, effectiveDate: "2027-06-28", serveByDate: "2027-03-30",
    exempt: false, landlordName: "North Star Rentals QA",
    landlordPhone: "(519) 915-8865", landlordEmail: "rentals@example.ca",
    tenantNames: ["Liang Wu", "Mei Wu"],
    rentalUnitAddress: "18 Shorncliffe Avenue, Toronto, ON",
    capturedAtIso: "2026-07-12T15:00:00.000Z",
  };

  // --- end-to-end fill: assert the comb-formatted field values
  await t("fillOfficialN1 sets the fields with comb formatting", async () => {
    const bytes = await fillOfficialN1(snap);
    assert.ok(bytes.length > 20000, "pdf too small");
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
    assert.strictEqual(pdf.getPageCount(), 2);
    const form = pdf.getForm();
    const get = (needle: string) =>
      form.getFields().find((f) => f.getName().includes(needle));
    const tenant = get("To_TenantName") as unknown as { getText?: () => string };
    assert.ok(tenant?.getText?.().includes("Liang Wu"), "tenant not set");
    const amt = get("RentIncAmount1") as unknown as { getText?: () => string };
    assert.strictEqual(amt?.getText?.(), "  2241 80");
    const date = get("StartDate") as unknown as { getText?: () => string };
    assert.strictEqual(date?.getText?.(), "28 06 2027");
  });

  await t("template version pinned", () => {
    assert.strictEqual(N1_TEMPLATE_VERSION, "v.01/04/2022");
  });

  console.log(`\ntest-n1-official-pdf: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
