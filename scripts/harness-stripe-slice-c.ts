// ===========================================================================
// Slice C live sandbox harness (S467) — exercises the IMPURE Stripe schedule
// orchestration in updateStripeRentAmount against a REAL Stripe TEST account,
// which the unit tests (test-stripe-rent-update.ts) cannot cover.
//
// It imports the REAL pure helpers (selectActiveSchedulePhase,
// validateStripeRentUpdate, isoToUnixSeconds) and reconstructs the exact
// subscriptionSchedules.create -> selectActiveSchedulePhase -> update sequence
// from stripe-rent-actions.ts (minus Supabase/org/redirect), then uses a Stripe
// Test Clock to force an annual phase transition so the S462 fix (pick
// current_phase, never phases[0]) is actually verified end to end.
//
// SAFETY: refuses to run unless STRIPE_SECRET_KEY starts with "sk_test_".
// All objects are created under a Test Clock and torn down in `finally`.
// PM = card/usd for a lean test; the schedule/phase logic is PM- and
// currency-agnostic (the acss/us_bank create path is separate, already live).
//
// Run (from vacantless-app/, key stays in YOUR shell, never in the repo):
//   STRIPE_SECRET_KEY=sk_test_xxx npx tsx scripts/harness-stripe-slice-c.ts
// ===========================================================================
import Stripe from "stripe";
import {
  selectActiveSchedulePhase,
  validateStripeRentUpdate,
  isoToUnixSeconds,
} from "../lib/stripe-connect";

const key = process.env.STRIPE_SECRET_KEY ?? "";
if (!key.startsWith("sk_test_")) {
  console.error(
    "REFUSING TO RUN: STRIPE_SECRET_KEY must be a TEST key (sk_test_...). " +
      "Never run this against a live key.",
  );
  process.exit(2);
}
const stripe = new Stripe(key);

const OLD = 220000; // $2,200.00
const NEW1 = 224180; // $2,241.80  (1.9% guideline)
const NEW2 = 228440; // next-year increase
const DAY = 86400;

type InvoiceWithParentSubscription = Stripe.Invoice & {
  parent?: {
    subscription_details?: {
      subscription?: string | { id?: string | null } | null;
    } | null;
  } | null;
};
type InvoiceLineWithModernFields = Stripe.InvoiceLineItem & {
  parent?: {
    subscription_item_details?: {
      subscription?: string | null;
    } | null;
  } | null;
  pricing?: {
    price_details?: {
      price?: string | null;
    } | null;
  } | null;
};

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}
function isoDate(unix: number): string {
  return new Date(unix * 1000).toISOString().slice(0, 10);
}
function money(cents: number, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}
function linePriceId(line: Stripe.InvoiceLineItem): string | null {
  const modernLine = line as InvoiceLineWithModernFields;
  const price = modernLine.pricing?.price_details?.price;
  if (typeof price === "string" && price.trim()) return price;
  const legacyPrice = line.price;
  return typeof legacyPrice?.id === "string" ? legacyPrice.id : null;
}
function subscriptionIdOfInvoice(invoice: Stripe.Invoice): string | null {
  const modernInvoice = invoice as InvoiceWithParentSubscription;
  const parentSubscription = modernInvoice.parent?.subscription_details?.subscription;
  if (typeof parentSubscription === "string") return parentSubscription;
  if (parentSubscription && typeof parentSubscription === "object") return parentSubscription.id ?? null;
  const legacySubscription = invoice.subscription;
  if (typeof legacySubscription === "string") return legacySubscription;
  if (legacySubscription && typeof legacySubscription === "object") return legacySubscription.id ?? null;
  return null;
}
function invoiceRentLineAmount(invoice: Stripe.Invoice, subId: string): number | null {
  const lines = invoice.lines?.data ?? [];
  const subscriptionLines = lines.filter((line) => {
    const modernLine = line as InvoiceLineWithModernFields;
    return modernLine.parent?.subscription_item_details?.subscription === subId;
  });
  const candidates = subscriptionLines.length > 0 ? subscriptionLines : lines;
  const recurring = candidates.find((line) => linePriceId(line) != null);
  return recurring?.amount ?? candidates[0]?.amount ?? null;
}
async function latestInvoiceForSubscription(subId: string, customerId: string): Promise<{
  id: string;
  created: number;
  amount: number;
  currency: string;
}> {
  const invoices = await stripe.invoices.list({
    customer: customerId,
    limit: 10,
    expand: ["data.lines"],
  });
  for (const invoice of invoices.data) {
    if (subscriptionIdOfInvoice(invoice) !== subId) continue;
    const amount = invoiceRentLineAmount(invoice, subId);
    if (amount == null) continue;
    return { id: invoice.id, created: invoice.created, amount, currency: invoice.currency };
  }
  throw new Error(`no invoice with a rent line found for ${subId}`);
}
async function waitClockReady(clockId: string) {
  for (let i = 0; i < 60; i++) {
    const c = await stripe.testHelpers.testClocks.retrieve(clockId);
    if (c.status === "ready") return;
    if (c.status === "internal_failure") throw new Error("test clock internal_failure");
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("test clock did not become ready");
}

async function main() {
  const now = Math.floor(Date.now() / 1000);
  const clock = await stripe.testHelpers.testClocks.create({ frozen_time: now });
  console.log(`Test clock ${clock.id} @ ${isoDate(now)}`);

  try {
    // --- fixture: customer(+clock) + card PM + monthly rent sub at OLD --------
    const customer = await stripe.customers.create({
      test_clock: clock.id,
      name: "Slice C Harness Tenant",
      email: "harness+slicec@example.com",
    });
    const pm = await stripe.paymentMethods.create({ type: "card", card: { token: "tok_visa" } });
    await stripe.paymentMethods.attach(pm.id, { customer: customer.id });
    await stripe.customers.update(customer.id, {
      invoice_settings: { default_payment_method: pm.id },
    });
    const product = await stripe.products.create({ name: "Harness Monthly rent" });
    const price = await stripe.prices.create({
      product: product.id,
      currency: "usd",
      unit_amount: OLD,
      recurring: { interval: "month" },
    });
    const sub = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: price.id }],
      default_payment_method: pm.id,
    });
    ok("fixture: subscription active", sub.status === "active" || sub.status === "trialing");

    // =====================================================================
    // INCREASE #1 — mirror updateStripeRentAmount's schedule orchestration
    // =====================================================================
    const sub2 = await stripe.subscriptions.retrieve(sub.id, { expand: ["items.data.price"] });
    const item = sub2.items.data[0];
    const pObj = item.price as Stripe.Price;
    const productId = typeof pObj.product === "string" ? pObj.product : (pObj.product as Stripe.Product).id;
    const currency = pObj.currency;

    let sched = await stripe.subscriptionSchedules.create({ from_subscription: sub.id });
    let sel = selectActiveSchedulePhase(sched as unknown as Parameters<typeof selectActiveSchedulePhase>[0]);
    ok("#1 selectActiveSchedulePhase ok on fresh schedule", sel.ok === true);

    const eff1Iso = isoDate(now + 35 * DAY);
    const check1 = validateStripeRentUpdate({
      subscriptionId: sub.id,
      subscriptionStatus: sub2.status,
      newAmountCents: NEW1,
      syncedAmountCents: null,
      effectiveIso: eff1Iso,
      recordedEffectiveIso: eff1Iso,
      todayIso: isoDate(now),
    });
    ok("#1 validateStripeRentUpdate ok", check1.ok === true);
    if (!check1.ok || !sel.ok) throw new Error("precondition failed at #1");

    await stripe.subscriptionSchedules.update(sched.id, {
      end_behavior: "release",
      proration_behavior: "none",
      phases: [
        { items: [{ price: sel.priceId ?? price.id, quantity: 1 }], start_date: sel.startDate, end_date: check1.effectiveUnix },
        {
          items: [
            {
              price_data: { product: productId, currency, recurring: { interval: "month" }, unit_amount: check1.newAmountCents },
              quantity: 1,
            },
          ],
          proration_behavior: "none",
        },
      ],
    } as unknown as Stripe.SubscriptionScheduleUpdateParams);

    sched = await stripe.subscriptionSchedules.retrieve(sched.id);
    ok("#1 schedule has exactly 2 phases (no stacking)", (sched.phases?.length ?? 0) === 2);
    ok("#1 phase 2 starts exactly on the effective date", sched.phases[1].start_date === check1.effectiveUnix);

    // No early bill: advance to the last OLD-rent billing boundary before the
    // legal effective date, then read the actual invoice line amount.
    await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: check1.effectiveUnix - 3 * DAY });
    await waitClockReady(clock.id);

    const subBefore = await stripe.subscriptions.retrieve(sub.id, { expand: ["items.data.price"] });
    ok(
      "#1 no early bill: current price is still OLD before effective date",
      (subBefore.items.data[0].price as Stripe.Price).unit_amount === OLD,
    );
    const invoiceBefore = await latestInvoiceForSubscription(sub.id, customer.id);
    ok("#1 invoice before effective date bills OLD rent", invoiceBefore.amount === OLD);

    // =====================================================================
    // ANNUAL TRANSITION — advance the clock PAST the effective date so
    // phase 1 elapses and phase 2 becomes current_phase (the S462 case).
    // =====================================================================
    await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: check1.effectiveUnix + 3 * DAY });
    await waitClockReady(clock.id);

    const subAfter = await stripe.subscriptions.retrieve(sub.id, { expand: ["items.data.price"] });
    ok(
      "transition: live price is NEW1 after the effective date",
      (subAfter.items.data[0].price as Stripe.Price).unit_amount === NEW1,
    );
    sched = await stripe.subscriptionSchedules.retrieve(sched.id);
    sel = selectActiveSchedulePhase(sched as unknown as Parameters<typeof selectActiveSchedulePhase>[0]);
    ok("transition: selectActiveSchedulePhase picks the now-current phase 2", sel.ok && sel.startDate === check1.effectiveUnix);
    ok(
      "transition: phases[0] is now the ELAPSED phase (the S462 trap)",
      (sched.phases?.[0].start_date ?? -1) !== check1.effectiveUnix,
    );

    // Adversarial control: the OLD buggy approach (start from phases[0]) must be
    // REJECTED by Stripe ("can only update current and future phases").
    let buggyRejected = false;
    try {
      await stripe.subscriptionSchedules.update(sched.id, {
        end_behavior: "release",
        proration_behavior: "none",
        phases: [
          { items: [{ price: (sched.phases[0].items[0].price as string) ?? price.id, quantity: 1 }], start_date: sched.phases[0].start_date, end_date: check1.effectiveUnix + 35 * DAY },
          { items: [{ price_data: { product: productId, currency, recurring: { interval: "month" }, unit_amount: NEW2 }, quantity: 1 }], proration_behavior: "none" },
        ],
      } as unknown as Stripe.SubscriptionScheduleUpdateParams);
    } catch {
      buggyRejected = true;
    }
    ok("control: the pre-S462 phases[0] approach IS rejected by Stripe", buggyRejected);

    // =====================================================================
    // INCREASE #2 — the S462 fix: update from the ACTIVE phase. Must SUCCEED.
    // =====================================================================
    if (!sel.ok) throw new Error("no active phase at #2");
    const clockNow = check1.effectiveUnix + 3 * DAY;
    const eff2Iso = isoDate(clockNow + 35 * DAY);
    const check2 = validateStripeRentUpdate({
      subscriptionId: sub.id,
      subscriptionStatus: subAfter.status,
      newAmountCents: NEW2,
      syncedAmountCents: check1.newAmountCents,
      effectiveIso: eff2Iso,
      recordedEffectiveIso: eff2Iso,
      todayIso: isoDate(clockNow),
    });
    ok("#2 validateStripeRentUpdate ok", check2.ok === true);
    if (!check2.ok) throw new Error("precondition failed at #2");

    let secondSucceeded = true;
    try {
      await stripe.subscriptionSchedules.update(sched.id, {
        end_behavior: "release",
        proration_behavior: "none",
        phases: [
          { items: [{ price: sel.priceId ?? price.id, quantity: 1 }], start_date: sel.startDate, end_date: check2.effectiveUnix },
          { items: [{ price_data: { product: productId, currency, recurring: { interval: "month" }, unit_amount: check2.newAmountCents }, quantity: 1 }], proration_behavior: "none" },
        ],
      } as unknown as Stripe.SubscriptionScheduleUpdateParams);
    } catch (e) {
      secondSucceeded = false;
      console.error("  (#2 update threw:", (e as Error).message, ")");
    }
    ok("#2 the S462 fix (active-phase) update SUCCEEDS across the annual boundary", secondSucceeded);

    sched = await stripe.subscriptionSchedules.retrieve(sched.id);
    ok("#2 schedule still has 2 phases (replaced, not stacked)", (sched.phases?.length ?? 0) === 2);

    // Capture the NEW-rent invoice at the first monthly boundary after the
    // effective date. Done LAST so advancing the clock can't disturb the #2
    // schedule update; Sept 30 bills NEW1 (before the #2 NEW2 date). (S607)
    await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: check1.effectiveUnix + 30 * DAY });
    await waitClockReady(clock.id);
    const invoiceAfter = await latestInvoiceForSubscription(sub.id, customer.id);
    ok("transition: invoice after effective date bills NEW1 rent", invoiceAfter.amount === NEW1);
    console.log("\nInvoice boundary proof:");
    console.log(`  INVOICE @ ${isoDate(invoiceBefore.created)} (${invoiceBefore.id}): ${money(invoiceBefore.amount, invoiceBefore.currency)}`);
    console.log(`  INVOICE @ ${isoDate(invoiceAfter.created)} (${invoiceAfter.id}): ${money(invoiceAfter.amount, invoiceAfter.currency)}`);
    console.log(`  Effective date: ${eff1Iso}`);
  } finally {
    try {
      await stripe.testHelpers.testClocks.del(clock.id);
      console.log(`Cleaned up test clock ${clock.id} (removes all clock-bound objects).`);
    } catch (e) {
      console.error("cleanup warning:", (e as Error).message);
    }
  }

  console.log(`\nharness-stripe-slice-c: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
