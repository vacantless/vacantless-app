// Unit tests for the pure rent-from-bank seam. Run: npx tsx scripts/test-rent-from-bank.ts
import {
  isRentFromBankEnabled,
  prefillRentSplit,
  validateRentSplit,
  rentFromBankErrorMessage,
} from "../lib/rent-from-bank";

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

// --- flag ---------------------------------------------------------------------
const prev = process.env.RENT_FROM_BANK;
delete process.env.RENT_FROM_BANK;
ok("flag off by default (dark)", isRentFromBankEnabled() === false);
process.env.RENT_FROM_BANK = "1";
ok("flag on when set to 1", isRentFromBankEnabled() === true);
process.env.RENT_FROM_BANK = "true";
ok("flag only honors exactly '1'", isRentFromBankEnabled() === false);
if (prev === undefined) delete process.env.RENT_FROM_BANK;
else process.env.RENT_FROM_BANK = prev;

// --- prefillRentSplit ---------------------------------------------------------
const three = [
  { tenancyId: "a", rentCents: 262000 },
  { tenancyId: "b", rentCents: 335200 },
  { tenancyId: "c", rentCents: 142400 },
];
{
  // Exact Manning case: $7,396 credit == sum of the three rents.
  const s = prefillRentSplit(739600, three);
  ok("prefill: one allocation per tenancy", s.length === 3);
  ok("prefill: tenancy a gets its rent", s[0].amountCents === 262000);
  ok("prefill: tenancy b gets its rent", s[1].amountCents === 335200);
  ok("prefill: tenancy c gets its rent", s[2].amountCents === 142400);
  ok("prefill: total equals the credit", s.reduce((t, a) => t + a.amountCents, 0) === 739600);
}
{
  // Credit smaller than total rent: later tenancies capped by what's left.
  const s = prefillRentSplit(400000, three);
  ok("prefill(short): a full", s[0].amountCents === 262000);
  ok("prefill(short): b capped to remainder", s[1].amountCents === 138000);
  ok("prefill(short): c gets zero", s[2].amountCents === 0);
  ok("prefill(short): never exceeds credit", s.reduce((t, a) => t + a.amountCents, 0) === 400000);
}
{
  // Credit larger than total rent: each gets its rent, no over-allocation.
  const s = prefillRentSplit(1000000, three);
  ok("prefill(surplus): total is the rent sum, not the credit", s.reduce((t, a) => t + a.amountCents, 0) === 739600);
}
{
  const s = prefillRentSplit(500000, [{ tenancyId: "x", rentCents: null }]);
  ok("prefill: unknown rent pre-fills zero", s[0].amountCents === 0);
}

// --- validateRentSplit --------------------------------------------------------
{
  const v = validateRentSplit(739600, [
    { tenancyId: "a", amountCents: 262000 },
    { tenancyId: "b", amountCents: 335200 },
    { tenancyId: "c", amountCents: 142400 },
  ]);
  ok("validate: exact split ok", v.ok === true && v.value.length === 3);
}
{
  const v = validateRentSplit(739600, [
    { tenancyId: "a", amountCents: 262000 },
    { tenancyId: "b", amountCents: 0 },
  ]);
  ok("validate: drops zero allocations", v.ok === true && v.value.length === 1);
}
{
  const v = validateRentSplit(739600, [{ tenancyId: "a", amountCents: 0 }]);
  ok("validate: all-zero -> empty", v.ok === false && v.code === "empty");
}
{
  const v = validateRentSplit(500000, [
    { tenancyId: "a", amountCents: 300000 },
    { tenancyId: "b", amountCents: 300000 },
  ]);
  ok("validate: over the credit rejected", v.ok === false && v.code === "over");
}
{
  const v = validateRentSplit(739600, [{ tenancyId: "a", amountCents: 200000 }]);
  ok("validate: partial (< credit) allowed", v.ok === true);
}

// --- error messages -----------------------------------------------------------
ok("error msg: known code", rentFromBankErrorMessage("over")!.includes("more than the deposit"));
ok("error msg: undefined -> null", rentFromBankErrorMessage(undefined) === null);
ok("error msg: unknown -> fallback", rentFromBankErrorMessage("zzz") !== null);

console.log(`\nrent-from-bank: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
