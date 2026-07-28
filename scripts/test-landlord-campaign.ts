// Unit tests for the landlord feature-reveal campaign (Tier 1 C).
// Run: npx tsx scripts/test-landlord-campaign.ts
import {
  buildRentConfirmUnits,
  nextRevealDue,
  revealCopy,
  REVEAL_KEYS,
  STEP_THRESHOLD_DAYS,
  MIN_GAP_HOURS,
  HOUR_MS,
  CAMPAIGN_MAX_AGE_DAYS,
  type LandlordRevealInput,
} from "../lib/landlord-campaign";
import { renderLandlordRentConfirmEmail } from "../lib/email";

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

// --- rent-confirm per-unit helper ------------------------------------------
const rentConfirmUnits = buildRentConfirmUnits({
  tenancies: [
    {
      id: "tenancy-1",
      address: "18 Shorncliffe Ave Unit 3",
      rentCents: 199500,
      confirmToken: "token-1",
    },
    {
      id: "tenancy-2",
      address: "22 Main St",
      rentCents: 240000,
      confirmToken: "token-2",
    },
    {
      id: "tenancy-3",
      address: null,
      rentCents: null,
      confirmToken: "token-3",
    },
  ],
  confirmedTenancyIds: new Set(["tenancy-2"]),
  urlFor: (token) => `https://app.vacantless.com/confirm-rent/${token}`,
});
ok("rent-confirm helper filters confirmed tenancies", rentConfirmUnits.length === 2);
ok(
  "rent-confirm helper keeps stable input order",
  rentConfirmUnits[0]?.confirmUrl.endsWith("/token-1") === true &&
    rentConfirmUnits[1]?.confirmUrl.endsWith("/token-3") === true,
);
ok(
  "rent-confirm helper preserves rent cents and builds URLs",
  rentConfirmUnits[0]?.rentCents === 199500 &&
    rentConfirmUnits[0]?.confirmUrl ===
      "https://app.vacantless.com/confirm-rent/token-1",
);
ok(
  "rent-confirm helper handles null address/rent",
  rentConfirmUnits[1]?.address === "your unit" &&
    rentConfirmUnits[1]?.rentCents === null,
);
ok(
  "rent-confirm helper returns no units when every tenancy is confirmed",
  buildRentConfirmUnits({
    tenancies: [
      {
        id: "tenancy-1",
        address: "18 Shorncliffe Ave Unit 3",
        rentCents: 199500,
        confirmToken: "token-1",
      },
    ],
    confirmedTenancyIds: new Set(["tenancy-1"]),
    urlFor: (token) => `https://app.vacantless.com/confirm-rent/${token}`,
  }).length === 0,
);

// --- branded rent-confirm email renderer -----------------------------------
const brandedRentConfirm = renderLandlordRentConfirmEmail({
  org_name: "Agile Rentals",
  brand_color: "#17362f",
  logo_url: "https://cdn.example.com/logo.png?name=<agile>",
  units: [
    {
      address: "18 <Shorncliffe> Ave",
      rentCents: 199500,
      confirmUrl: "https://app.vacantless.com/confirm-rent/token-1?x=<bad>",
    },
    {
      address: "your unit",
      rentCents: null,
      confirmUrl: "https://app.vacantless.com/confirm-rent/token-3",
    },
  ],
});
ok("rent-confirm email has a subject", brandedRentConfirm.subject.length > 0);
ok(
  "rent-confirm email renders one pill per unit",
  (brandedRentConfirm.html.match(/Confirm your rent/g) ?? []).length === 2,
);
ok(
  "rent-confirm email escapes interpolated HTML",
  brandedRentConfirm.html.includes("18 &lt;Shorncliffe&gt; Ave") &&
    !brandedRentConfirm.html.includes("18 <Shorncliffe> Ave") &&
    brandedRentConfirm.html.includes("name=&lt;agile&gt;") &&
    brandedRentConfirm.html.includes("x=&lt;bad&gt;"),
);
ok(
  "rent-confirm email includes rent chip and null-rent fallback",
  brandedRentConfirm.html.includes("$1,995/month") &&
    brandedRentConfirm.html.includes("Rent not set"),
);
ok(
  "rent-confirm email has a plain-text fallback with the public links",
  brandedRentConfirm.text.includes("token-1") &&
    brandedRentConfirm.text.includes("token-3"),
);

console.log(
  `\ntest-landlord-campaign: ${passed} passed, ${failed} failed (${passed + failed} total)`,
);
if (failed > 0) process.exit(1);
