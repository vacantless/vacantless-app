import assert from "node:assert/strict";
import { fixedTermEndISO } from "@/lib/tenancy";

assert.equal(fixedTermEndISO({ start_date: "2026-11-01", term_months: 12 }), "2027-10-31");
assert.equal(fixedTermEndISO({ start_date: "2026-11-15", term_months: 12 }), "2027-11-14");
assert.equal(fixedTermEndISO({ start_date: "2026-01-31", term_months: 1 }), "2026-02-28");
assert.equal(fixedTermEndISO({ start_date: "2027-12-01", term_months: 6 }), "2028-05-31");
assert.equal(fixedTermEndISO({ start_date: "2026-11-01", end_date: "2027-06-30", term_months: 12 }), "2027-06-30");
assert.equal(fixedTermEndISO({ start_date: "2026-11-01", term_months: null }), null);
assert.equal(fixedTermEndISO({ start_date: null, term_months: 12 }), null);
assert.equal(fixedTermEndISO({}), null);
console.log("fixed-term-end: 8 passed");
