// Unit tests for the pure price-drop logic. Run: npx tsx scripts/test-price-drop.ts
import {
  isPriceDrop,
  pendingDropFrom,
  leadEligibleForPriceDrop,
  countEligible,
  blastOfferable,
  formatMoney,
  formatRentLabel,
  type PriceDropLead,
} from "../lib/price-drop";

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

// --- isPriceDrop -----------------------------------------------------------
ok("drop: 1500 -> 1400 is a drop", isPriceDrop(150000, 140000));
ok("no drop: 1400 -> 1500 is a raise", !isPriceDrop(140000, 150000));
ok("no drop: unchanged is not a drop", !isPriceDrop(140000, 140000));
ok("no drop: old null", !isPriceDrop(null, 140000));
ok("no drop: new null (cleared)", !isPriceDrop(140000, null));
ok("no drop: both null", !isPriceDrop(null, null));

// --- pendingDropFrom -------------------------------------------------------
ok(
  "pending: first drop records the old price",
  pendingDropFrom(150000, 140000, null) === 150000,
);
ok(
  "pending: second drop keeps the HIGHER original from-price",
  pendingDropFrom(140000, 130000, 150000) === 150000,
);
ok(
  "pending: drop with a lower stale pending takes the new higher old",
  pendingDropFrom(160000, 150000, 140000) === 160000,
);
ok(
  "pending: a raise cancels a pending drop",
  pendingDropFrom(140000, 150000, 150000) === null,
);
ok(
  "pending: cleared rent leaves pending untouched (old/new guard)",
  pendingDropFrom(140000, null, 150000) === 150000,
);
ok(
  "pending: unchanged rent does not disturb a pending drop",
  pendingDropFrom(140000, 140000, 150000) === 150000,
);
ok(
  "pending: unchanged with no pending stays null",
  pendingDropFrom(140000, 140000, null) === null,
);

// --- leadEligibleForPriceDrop ----------------------------------------------
const openWithEmail: PriceDropLead = {
  email: "renter@example.com",
  status: "contacted",
  price_drop_notified_cents: null,
};

ok(
  "eligible: open lead with email, never notified",
  leadEligibleForPriceDrop(openWithEmail, 140000),
);
ok(
  "ineligible: no current rent",
  !leadEligibleForPriceDrop(openWithEmail, null),
);
ok(
  "ineligible: no email",
  !leadEligibleForPriceDrop({ ...openWithEmail, email: null }, 140000),
);
ok(
  "ineligible: blank email",
  !leadEligibleForPriceDrop({ ...openWithEmail, email: "   " }, 140000),
);
ok(
  "ineligible: leased lead",
  !leadEligibleForPriceDrop({ ...openWithEmail, status: "leased" }, 140000),
);
ok(
  "ineligible: lost lead",
  !leadEligibleForPriceDrop({ ...openWithEmail, status: "lost" }, 140000),
);
ok(
  "eligible: booked lead still counts (not terminal)",
  leadEligibleForPriceDrop({ ...openWithEmail, status: "booked" }, 140000),
);
ok(
  "ineligible: already notified at the same price (repeat click no-op)",
  !leadEligibleForPriceDrop(
    { ...openWithEmail, price_drop_notified_cents: 140000 },
    140000,
  ),
);
ok(
  "ineligible: already notified at a lower price",
  !leadEligibleForPriceDrop(
    { ...openWithEmail, price_drop_notified_cents: 135000 },
    140000,
  ),
);
ok(
  "eligible: a further drop below the notified price re-notifies",
  leadEligibleForPriceDrop(
    { ...openWithEmail, price_drop_notified_cents: 150000 },
    140000,
  ),
);

// --- countEligible ---------------------------------------------------------
const leads: PriceDropLead[] = [
  { email: "a@x.com", status: "new", price_drop_notified_cents: null }, // ✓
  { email: "b@x.com", status: "leased", price_drop_notified_cents: null }, // ✗ terminal
  { email: null, status: "contacted", price_drop_notified_cents: null }, // ✗ no email
  { email: "d@x.com", status: "booked", price_drop_notified_cents: 150000 }, // ✓ further drop
  { email: "e@x.com", status: "showed", price_drop_notified_cents: 140000 }, // ✗ already told
];
ok("countEligible: 2 of 5 at 140000", countEligible(leads, 140000) === 2);
ok("countEligible: 0 when no rent", countEligible(leads, null) === 0);

// --- blastOfferable --------------------------------------------------------
ok(
  "offerable: pending above rent + eligible leads",
  blastOfferable(150000, 140000, 3),
);
ok(
  "not offerable: no pending drop",
  !blastOfferable(null, 140000, 3),
);
ok(
  "not offerable: pending not above current rent",
  !blastOfferable(140000, 140000, 3),
);
ok(
  "not offerable: no eligible leads",
  !blastOfferable(150000, 140000, 0),
);
ok(
  "not offerable: no current rent",
  !blastOfferable(150000, null, 3),
);

// --- formatting ------------------------------------------------------------
ok("formatMoney: 125000 -> $1,250", formatMoney(125000) === "$1,250");
ok("formatMoney: null -> null", formatMoney(null) === null);
ok(
  "formatRentLabel: 125000 -> $1,250/month",
  formatRentLabel(125000) === "$1,250/month",
);
ok("formatRentLabel: null -> null", formatRentLabel(null) === null);

// ---------------------------------------------------------------------------
console.log(`\nprice-drop: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
