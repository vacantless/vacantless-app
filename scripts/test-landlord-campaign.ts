// Unit tests for the landlord feature-reveal campaign (Tier 1 C).
// Run: npx tsx scripts/test-landlord-campaign.ts
import {
  nextRevealDue,
  revealCopy,
  REVEAL_KEYS,
  STEP_THRESHOLD_DAYS,
  MIN_GAP_HOURS,
  HOUR_MS,
  CAMPAIGN_MAX_AGE_DAYS,
  type LandlordRevealInput,
} from "../lib/landlord-campaign";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

const DAY = 24 * HOUR_MS;
const NOW = 1_800_000_000_000; // fixed clock (no Date.now in the pure fn)

function inp(over: Partial<LandlordRevealInput> = {}): LandlordRevealInput {
  return {
    campaignStartMs: NOW, // age 0 by default
    nowMs: NOW,
    plan: "free",
    hasTenancy: true,
    enabled: true,
    optedOut: false,
    stepSent: 0,
    lastSentAtMs: null,
    hasRentCollection: false,
    hasTaxExport: false,
    hasListingMarketing: false,
    ...over,
  };
}

// --- correct step at each threshold ----------------------------------------
ok("step 0 due at age 0", nextRevealDue(inp())?.key === REVEAL_KEYS[0]);
for (let i = 1; i < REVEAL_KEYS.length; i++) {
  const age = STEP_THRESHOLD_DAYS[i] * DAY;
  const r = nextRevealDue(inp({ stepSent: i, campaignStartMs: NOW - age }));
  ok(`step ${i} (${REVEAL_KEYS[i]}) due at ${STEP_THRESHOLD_DAYS[i]}d`, r?.key === REVEAL_KEYS[i] && r?.index === i);
}

// --- nothing before threshold ----------------------------------------------
ok(
  "step 1 not due before 7d",
  nextRevealDue(inp({ stepSent: 1, campaignStartMs: NOW - 6 * DAY })) === null,
);

// --- min-gap suppression ---------------------------------------------------
ok(
  "suppressed within MIN_GAP after a recent send",
  nextRevealDue(
    inp({ stepSent: 1, campaignStartMs: NOW - 10 * DAY, lastSentAtMs: NOW - (MIN_GAP_HOURS - 1) * HOUR_MS }),
  ) === null,
);
ok(
  "eligible again once MIN_GAP has passed",
  nextRevealDue(
    inp({ stepSent: 1, campaignStartMs: NOW - 10 * DAY, lastSentAtMs: NOW - (MIN_GAP_HOURS + 1) * HOUR_MS }),
  )?.key === REVEAL_KEYS[1],
);

// --- max-age skip ----------------------------------------------------------
ok(
  "skips an org older than the freshness cap",
  nextRevealDue(inp({ campaignStartMs: NOW - (CAMPAIGN_MAX_AGE_DAYS + 1) * DAY })) === null,
);

// --- opted-out skip --------------------------------------------------------
ok("opted-out org gets nothing", nextRevealDue(inp({ optedOut: true })) === null);
ok("disabled campaign gets nothing", nextRevealDue(inp({ enabled: false })) === null);

// --- plan != free stop -----------------------------------------------------
ok("converted (growth) org stops", nextRevealDue(inp({ plan: "growth" })) === null);
ok("no-tenancy org gets nothing", nextRevealDue(inp({ hasTenancy: false })) === null);

// --- skip-owned advances past a held feature -------------------------------
// Org already has rent_collection. From step 1 at day 14, the resolved reveal
// should skip rent_collection (index 1) and land on tax_export (index 2).
const owned = nextRevealDue(
  inp({ stepSent: 1, campaignStartMs: NOW - 14 * DAY, hasRentCollection: true }),
);
ok("skip-owned lands on tax_export (index 2)", owned?.key === "tax_export" && owned?.index === 2);
// If it also owns tax_export, it should skip to listing_marketing (index 3) at 21d.
const owned2 = nextRevealDue(
  inp({ stepSent: 1, campaignStartMs: NOW - 21 * DAY, hasRentCollection: true, hasTaxExport: true }),
);
ok("skip-owned skips two features to listing_marketing (index 3)", owned2?.key === "listing_marketing" && owned2?.index === 3);

// --- idempotent re-run (past the end) --------------------------------------
ok(
  "finished sequence sends nothing",
  nextRevealDue(inp({ stepSent: REVEAL_KEYS.length, campaignStartMs: NOW - 60 * DAY })) === null,
);

// --- copy sanity: real hrefs, no em dashes ---------------------------------
let copyOk = true;
for (const key of REVEAL_KEYS) {
  const c = revealCopy(key, { propertyAddress: "18 Shorncliffe Ave Unit 3" });
  if (!c.subject || !c.body || !c.ctaLabel || !c.ctaPath.startsWith("/")) copyOk = false;
  if (c.body.includes("—") || c.subject.includes("—")) copyOk = false; // no em dash
}
ok("every reveal has complete copy, a relative href, and no em dashes", copyOk);
ok("upgrade reveals point at billing", revealCopy("rent_collection").ctaPath === "/dashboard/billing");
ok("free rent-increase nudge points at the rent surface", revealCopy("rent_increase_confirm").ctaPath === "/dashboard/rent");

console.log(
  `\ntest-landlord-campaign: ${passed} passed, ${failed} failed (${passed + failed} total)`,
);
if (failed > 0) process.exit(1);
