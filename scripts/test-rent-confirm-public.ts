// Unit tests for the public rent-confirm token helpers.
// Run: npx tsx scripts/test-rent-confirm-public.ts
import {
  isIsoDate,
  isUuidLike,
  parseRentConfirmSubmission,
  parseRentDollarsToCents,
  rentConfirmUrl,
} from "../lib/rent-confirm-public";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

const TOKEN = "123e4567-e89b-42d3-a456-426614174000";

ok(
  "rentConfirmUrl builds the public token URL",
  rentConfirmUrl(TOKEN) ===
    "https://app.vacantless.com/confirm-rent/123e4567-e89b-42d3-a456-426614174000",
);
ok("uuid accepts valid v4 token shape", isUuidLike(TOKEN));
ok("uuid rejects arbitrary text", !isUuidLike("not-a-token"));

ok("money parser handles dollars", parseRentDollarsToCents("2500") === 250000);
ok("money parser handles commas and cents", parseRentDollarsToCents("$2,500.50") === 250050);
ok("money parser rejects zero", parseRentDollarsToCents("0") === null);
ok("money parser rejects junk", parseRentDollarsToCents("rent") === null);

ok("ISO date accepts yyyy-mm-dd", isIsoDate("2026-08-01"));
ok("ISO date rejects display dates", !isIsoDate("08/01/2026"));

const unchanged = parseRentConfirmSubmission({
  status: "unchanged",
  currentRent: "",
  effectiveDate: "",
});
ok("unchanged parse succeeds", unchanged.ok && unchanged.status === "unchanged");
ok("unchanged does not require rent amount", unchanged.ok && unchanged.currentRentCents === null);

const changed = parseRentConfirmSubmission({
  status: "changed",
  currentRent: "2750",
  effectiveDate: "2026-08-01",
});
ok("changed parse succeeds", changed.ok && changed.status === "changed");
ok("changed parses cents", changed.ok && changed.currentRentCents === 275000);
ok("changed keeps effective date", changed.ok && changed.effectiveDate === "2026-08-01");

const setBaseline = parseRentConfirmSubmission({
  status: "set",
  currentRent: "2400",
  effectiveDate: "2026-07-01",
});
ok("set parse succeeds", setBaseline.ok && setBaseline.status === "set");
ok("set parses cents", setBaseline.ok && setBaseline.currentRentCents === 240000);
ok("set keeps effective date", setBaseline.ok && setBaseline.effectiveDate === "2026-07-01");

const badStatus = parseRentConfirmSubmission({
  status: "confirm",
  currentRent: "2750",
  effectiveDate: "2026-08-01",
});
ok("invalid status rejected", !badStatus.ok && badStatus.reason === "bad_status");

const badRent = parseRentConfirmSubmission({
  status: "changed",
  currentRent: "",
  effectiveDate: "2026-08-01",
});
ok("changed requires rent", !badRent.ok && badRent.reason === "bad_rent");

const setBadRent = parseRentConfirmSubmission({
  status: "set",
  currentRent: "",
  effectiveDate: "2026-08-01",
});
ok("set requires rent", !setBadRent.ok && setBadRent.reason === "bad_rent");

const badDate = parseRentConfirmSubmission({
  status: "changed",
  currentRent: "2750",
  effectiveDate: "",
});
ok("changed requires ISO date", !badDate.ok && badDate.reason === "bad_date");

const setBadDate = parseRentConfirmSubmission({
  status: "set",
  currentRent: "2750",
  effectiveDate: "08/01/2026",
});
ok("set requires ISO date", !setBadDate.ok && setBadDate.reason === "bad_date");

console.log(
  `\ntest-rent-confirm-public: ${passed} passed, ${failed} failed (${passed + failed} total)`,
);
if (failed > 0) process.exit(1);
