// Unit tests for validateStripeRentUpdate (autopilot Slice C, S460 / spec S420).
// The impure Stripe schedule orchestration lives in stripe-rent-actions.ts and
// is covered by the live sandbox flow. Run: npx tsx scripts/test-stripe-rent-update.ts
import { validateStripeRentUpdate } from "../lib/stripe-connect";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

const base = {
  subscriptionId: "sub_123",
  subscriptionStatus: "active",
  newAmountCents: 210000,
  syncedAmountCents: null as number | null,
  effectiveIso: "2027-03-01",
  recordedEffectiveIso: "2027-03-01",
  todayIso: "2026-12-01",
};

// --- happy path -------------------------------------------------------------
{
  const r = validateStripeRentUpdate(base);
  ok("valid update -> ok", r.ok === true);
  if (r.ok) {
    ok("carries rounded amount", r.newAmountCents === 210000);
    ok("carries effective unix", r.effectiveUnix === Math.floor(Date.UTC(2027, 2, 1, 12) / 1000));
  }
}

// --- no subscription --------------------------------------------------------
ok("no sub -> nosub", validateStripeRentUpdate({ ...base, subscriptionId: null }).ok === false);
{
  const r = validateStripeRentUpdate({ ...base, subscriptionId: null });
  ok("no sub code", !r.ok && r.code === "nosub");
}

// --- inactive subscription --------------------------------------------------
{
  const r = validateStripeRentUpdate({ ...base, subscriptionStatus: "canceled" });
  ok("canceled -> subinactive", !r.ok && r.code === "subinactive");
  ok("trialing is allowed", validateStripeRentUpdate({ ...base, subscriptionStatus: "trialing" }).ok === true);
  const past = validateStripeRentUpdate({ ...base, subscriptionStatus: "past_due" });
  ok("past_due -> subinactive", !past.ok && past.code === "subinactive");
}

// --- amount guards ----------------------------------------------------------
{
  ok("null amount -> noamount", (() => { const r = validateStripeRentUpdate({ ...base, newAmountCents: null }); return !r.ok && r.code === "noamount"; })());
  ok("zero amount -> noamount", (() => { const r = validateStripeRentUpdate({ ...base, newAmountCents: 0 }); return !r.ok && r.code === "noamount"; })());
  ok("negative -> noamount", (() => { const r = validateStripeRentUpdate({ ...base, newAmountCents: -5 }); return !r.ok && r.code === "noamount"; })());
}

// --- no-op: same amount already synced --------------------------------------
{
  const r = validateStripeRentUpdate({ ...base, syncedAmountCents: 210000 });
  ok("same synced amount -> noop", !r.ok && r.code === "noop");
  ok("different synced amount -> ok", validateStripeRentUpdate({ ...base, syncedAmountCents: 200000 }).ok === true);
}

// --- date floor: never bill early ------------------------------------------
{
  const pastEff = validateStripeRentUpdate({ ...base, effectiveIso: "2026-11-30" });
  ok("effective before today -> baddate", !pastEff.ok && pastEff.code === "baddate");
  const beforeFloor = validateStripeRentUpdate({ ...base, effectiveIso: "2027-02-01", recordedEffectiveIso: "2027-03-01" });
  ok("effective before recorded floor -> baddate", !beforeFloor.ok && beforeFloor.code === "baddate");
  const badIso = validateStripeRentUpdate({ ...base, effectiveIso: "nope" });
  ok("unparseable effective -> baddate", !badIso.ok && badIso.code === "baddate");
  const noFloor = validateStripeRentUpdate({ ...base, recordedEffectiveIso: null });
  ok("null floor still ok when >= today", noFloor.ok === true);
}

console.log(`\nstripe-rent-update: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
