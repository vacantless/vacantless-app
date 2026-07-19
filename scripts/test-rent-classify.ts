// Unit tests for the pure rent-credit classifier. Run:
// npx tsx scripts/test-rent-classify.ts
import {
  addBusinessDaysIso,
  classifyCredit,
  isInRentWindow,
  railPaymentLinkCandidatesForTransaction,
} from "../lib/rent-classify";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  x ${name}`);
  }
}

function tenancy(amountCents: number, id = "ten-1") {
  return [{ tenancyId: id, rentCents: amountCents, label: `Unit ${id}` }];
}

function classified(
  description: string,
  amountCents: number,
  postedOn = "2026-07-06",
  source = "RBC Chequing",
) {
  return classifyCredit(
    { amountCents, postedOn, description, source },
    tenancy(amountCents),
  );
}

// --- rail -------------------------------------------------------------------
{
  const c = classified("Stripe rent payout", 250000, "2026-07-06", "Stripe");
  ok("rail-hit classifies as rail", c.classification === "rail" && c.railHit);
  ok("rail-hit does not pre-suggest rent", c.suggestRent === false);
}

// --- amount + rent window + clean description ------------------------------
{
  const c = classified("Interac e-transfer from Jane Tenant", 250000, "2026-07-08");
  ok("clean amount match inside rent window is likely rent", c.classification === "likely_rent");
  ok("likely rent pre-suggests", c.suggestRent === true && c.amountCandidates.length === 1);
}
{
  const c = classified("Interac e-transfer from Jane Tenant", 250000, "2026-07-15");
  ok("amount match outside window is possible off-cycle", c.classification === "possible_offcycle");
  ok("possible off-cycle does not pre-suggest", c.suggestRent === false);
}

// --- obvious non-rent credits from dogfood ---------------------------------
const nonRentExamples = [
  ["Canada Essentials Benefit", 53300],
  ["Fed-Prov/Terr CANADA", 136930],
  ["Misc Payment PAYPAL", 13401],
  ["Insurance / Entente Plus", 40630],
  ["Online Banking transfer to Interactive Brokers", 1500000],
] as const;
for (const [description, amount] of nonRentExamples) {
  const c = classified(description, amount, "2026-07-03");
  ok(`${description} classifies not rent`, c.classification === "not_rent" && !c.cleanDescription);
  ok(`${description} does not pre-suggest`, c.suggestRent === false);
}

// --- business-day math ------------------------------------------------------
ok("five business days from Wednesday July 1 lands on July 8", addBusinessDaysIso("2026-07-01", 5) === "2026-07-08");
ok("rent window includes the fifth business day", isInRentWindow("2026-07-08"));
ok("rent window excludes the next day", !isInRentWindow("2026-07-09"));
ok("weekend due date skips to the following Friday after five business days", addBusinessDaysIso("2026-08-01", 5) === "2026-08-07");

// --- rail dedupe candidacy --------------------------------------------------
{
  const credit = {
    amountCents: 250000,
    postedOn: "2026-07-06",
    description: "Rotessa settlement",
    source: "rotessa",
  };
  const candidates = railPaymentLinkCandidatesForTransaction(
    credit,
    tenancy(250000),
    [
      {
        id: "pay-1",
        tenancyId: "ten-1",
        amountCents: 250000,
        periodMonth: "2026-07-01",
        source: "rotessa",
        bankTransactionId: null,
      },
      {
        id: "pay-2",
        tenancyId: "ten-1",
        amountCents: 250000,
        periodMonth: "2026-07-01",
        source: "rotessa",
        bankTransactionId: "bank-1",
      },
      {
        id: "pay-3",
        tenancyId: "ten-1",
        amountCents: 250000,
        periodMonth: "2026-06-01",
        source: "stripe",
        bankTransactionId: null,
      },
      {
        id: "pay-4",
        tenancyId: "ten-1",
        amountCents: 250000,
        periodMonth: "2026-07-01",
        source: "bank",
        bankTransactionId: null,
      },
    ],
  );
  ok("rail dedupe finds the one unlinked matching rail payment", candidates.length === 1 && candidates[0].paymentId === "pay-1");
}

console.log(`\nrent-classify: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
