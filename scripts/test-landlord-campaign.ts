// Unit tests for the landlord feature-reveal campaign (Tier 1 C).
// Run: npx tsx scripts/test-landlord-campaign.ts
import {
  buildAnniversaryRentConfirmPlan,
  buildRentConfirmUnits,
  isWithinFirstYear,
  nextRevealDue,
  revealCopy,
  resolveLandlordCampaignRecipient,
  normalizeCampaignEmail,
  REVEAL_KEYS,
  STEP_THRESHOLD_DAYS,
  MIN_GAP_HOURS,
  HOUR_MS,
  CAMPAIGN_MAX_AGE_DAYS,
  type LandlordRevealInput,
} from "../lib/landlord-campaign";
import {
  renderLandlordAnniversaryRentConfirmEmail,
  renderLandlordRentConfirmEmail,
} from "../lib/email";
import { NextRequest } from "next/server";
import { GET as runLandlordCampaign } from "../app/api/cron/landlord-campaign/route";

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

// --- active rent rail advances past the free activation reveal --------------
const rentCollectionActivation = nextRevealDue(
  inp({ stepSent: 1, campaignStartMs: NOW - 7 * DAY, hasRentCollection: false }),
);
ok(
  "free org without active rent rail gets rent_collection activation reveal",
  rentCollectionActivation?.key === "rent_collection" && rentCollectionActivation?.index === 1,
);
// Org already has active rent_collection. From step 1 at day 14, the resolved
// reveal should skip rent_collection (index 1) and land on tax_export (index 2).
const owned = nextRevealDue(
  inp({ stepSent: 1, campaignStartMs: NOW - 14 * DAY, hasRentCollection: true }),
);
ok("active rent rail skips to tax_export (index 2)", owned?.key === "tax_export" && owned?.index === 2);
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
ok("rent collection activation points at Money", revealCopy("rent_collection").ctaPath === "/dashboard/money");
ok(
  "rent collection copy says included free",
  revealCopy("rent_collection").body.includes("included free on your plan"),
);
ok(
  "upgrade ask does not sell rent collection",
  !revealCopy("upgrade_ask").body.includes("Growth adds automatic rent collection"),
);
ok("tax export reveal still points at billing", revealCopy("tax_export").ctaPath === "/dashboard/billing");
ok("free rent-increase nudge points at the rent surface", revealCopy("rent_increase_confirm").ctaPath === "/dashboard/rent");

// --- first-year rent-confirm gate ------------------------------------------
ok("first-year helper treats 11 months as first-year", isWithinFirstYear("2025-08-31", "2026-07-31"));
ok("first-year helper treats 12 months as mature", !isWithinFirstYear("2025-07-31", "2026-07-31"));
ok("first-year helper treats 13 months as mature", !isWithinFirstYear("2025-06-30", "2026-07-31"));
ok("first-year helper treats future starts as first-year", isWithinFirstYear("2026-08-01", "2026-07-31"));
ok("first-year helper treats null start as mature/legacy", !isWithinFirstYear(null, "2026-07-31"));
ok("first-year helper treats blank start as mature/legacy", !isWithinFirstYear("   ", "2026-07-31"));
ok("first-year helper treats garbage start as mature/legacy", !isWithinFirstYear("not-a-date", "2026-07-31"));

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
    rentConfirmUnits[0]?.tenancyId === "tenancy-1" &&
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
{
  const today = "2026-07-31";
  const rows = [
    {
      id: "first-year",
      address: "First Year Unit",
      rentCents: 250000,
      confirmToken: "first",
      startDate: "2026-02-01",
    },
    {
      id: "mature",
      address: "Mature Unit",
      rentCents: 210000,
      confirmToken: "mature",
      startDate: "2025-07-31",
    },
  ];
  const eligible = rows.filter((row) => !isWithinFirstYear(row.startDate, today));
  const firstYear = rows.filter((row) => isWithinFirstYear(row.startDate, today));
  const eligibleUnits = buildRentConfirmUnits({
    tenancies: eligible,
    confirmedTenancyIds: new Set(),
    urlFor: (token) => `https://app.vacantless.com/confirm-rent/${token}`,
  });
  const firstYearUnits = buildRentConfirmUnits({
    tenancies: firstYear,
    confirmedTenancyIds: new Set(),
    urlFor: (token) => `https://app.vacantless.com/confirm-rent/${token}`,
  });
  ok(
    "mixed org confirms only 12-month-plus units",
    eligibleUnits.length === 1 &&
      eligibleUnits[0]?.tenancyId === "mature" &&
      firstYearUnits[0]?.tenancyId === "first-year",
  );
}
{
  const firstYearOnly = buildRentConfirmUnits({
    tenancies: [
      {
        id: "future",
        address: "Future Start Unit",
        rentCents: 300000,
        confirmToken: "future",
        startDate: "2026-08-01",
      },
    ].filter((row) => !isWithinFirstYear(row.startDate, "2026-07-31")),
    confirmedTenancyIds: new Set(),
    urlFor: (token) => `https://app.vacantless.com/confirm-rent/${token}`,
  });
  ok("first-year-only org yields zero units for stamp-and-skip", firstYearOnly.length === 0);
}
{
  const matureRows = [
    {
      id: "mature-a",
      address: "Mature A",
      rentCents: 200000,
      confirmToken: "a",
      startDate: "2025-07-31",
    },
    {
      id: "mature-b",
      address: "Mature B",
      rentCents: 210000,
      confirmToken: "b",
      startDate: "2025-06-30",
    },
  ];
  const before = buildRentConfirmUnits({
    tenancies: matureRows.map(({ startDate: _startDate, ...row }) => row),
    confirmedTenancyIds: new Set(),
    urlFor: (token) => `https://app.vacantless.com/confirm-rent/${token}`,
  });
  const after = buildRentConfirmUnits({
    tenancies: matureRows
      .filter((row) => !isWithinFirstYear(row.startDate, "2026-07-31"))
      .map(({ startDate: _startDate, ...row }) => row),
    confirmedTenancyIds: new Set(),
    urlFor: (token) => `https://app.vacantless.com/confirm-rent/${token}`,
  });
  ok("all-mature org is unchanged by the first-year gate", JSON.stringify(after) === JSON.stringify(before));
}

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

// --- anniversary hero selection + renderer ---------------------------------
function increase(over: Partial<NonNullable<ReturnType<typeof buildAnniversaryRentConfirmPlan>["hero"]>["rentIncrease"]> = {}) {
  return {
    status: "serve_window",
    earliestEffectiveDate: "2026-10-01",
    effectiveDate: "2026-10-01",
    serveByDate: "2026-07-03",
    guidelinePercent: 2.1,
    currentRentCents: 200000,
    newRentCents: 204200,
    increaseCents: 4200,
    note: "Serve the N1 now for a 2026-10-01 increase at the 2.1% guideline.",
    ...over,
  };
}

const anniversaryPlan = buildAnniversaryRentConfirmPlan([
  {
    tenancyId: "tenancy-window",
    address: "Window Unit",
    rentCents: 200000,
    confirmUrl: "https://app.vacantless.com/confirm-rent/window",
    rentIncrease: increase({ status: "serve_window", earliestEffectiveDate: "2026-10-01" }),
  },
  {
    tenancyId: "tenancy-overdue",
    address: "Overdue Unit",
    rentCents: 210000,
    confirmUrl: "https://app.vacantless.com/confirm-rent/overdue",
    rentIncrease: increase({
      status: "overdue",
      earliestEffectiveDate: "2026-09-01",
      effectiveDate: "2026-11-01",
      serveByDate: "2026-08-03",
    }),
  },
  {
    tenancyId: "tenancy-scheduled",
    address: "Scheduled Unit",
    rentCents: 220000,
    confirmUrl: "https://app.vacantless.com/confirm-rent/scheduled",
    rentIncrease: increase({ status: "scheduled", earliestEffectiveDate: "2027-04-01" }),
  },
]);
ok("anniversary plan picks the most urgent actionable hero", anniversaryPlan.hero?.tenancyId === "tenancy-overdue");
ok(
  "anniversary plan excludes the hero from secondary units",
  anniversaryPlan.others.length === 2 &&
    anniversaryPlan.others.every((unit) => unit.tenancyId !== "tenancy-overdue"),
);

const anniversaryTie = buildAnniversaryRentConfirmPlan([
  {
    tenancyId: "late-second",
    address: "Late Second",
    rentCents: 200000,
    confirmUrl: "https://app.vacantless.com/confirm-rent/late-second",
    rentIncrease: increase({ status: "serve_late", earliestEffectiveDate: "2026-12-01" }),
  },
  {
    tenancyId: "late-first",
    address: "Late First",
    rentCents: 200000,
    confirmUrl: "https://app.vacantless.com/confirm-rent/late-first",
    rentIncrease: increase({ status: "serve_late", earliestEffectiveDate: "2026-11-01" }),
  },
]);
ok("anniversary tie-break uses earliest effective date", anniversaryTie.hero?.tenancyId === "late-first");

const noAnniversaryHero = buildAnniversaryRentConfirmPlan([
  {
    tenancyId: "missing-guideline",
    address: "Missing Guideline",
    rentCents: 200000,
    confirmUrl: "https://app.vacantless.com/confirm-rent/missing",
    rentIncrease: increase({ status: "overdue", newRentCents: null, increaseCents: null }),
  },
]);
ok("anniversary plan falls back when math is incomplete", noAnniversaryHero.hero === null);

const anniversaryEmail = renderLandlordAnniversaryRentConfirmEmail({
  org_name: "Agile Rentals",
  brand_color: "#17362f",
  logo_url: null,
  hero: anniversaryPlan.hero!,
  units: anniversaryPlan.others,
});
ok("anniversary email subject names the hero", anniversaryEmail.subject.includes("Overdue Unit"));
ok(
  "anniversary email renders hero CTA and secondary confirm pills",
  anniversaryEmail.html.includes("Confirm &amp; prepare the increase") &&
    (anniversaryEmail.html.match(/>Confirm</g) ?? []).length === 2,
);
ok(
  "anniversary email includes rent math and dates",
  anniversaryEmail.html.includes("$2,000/month") &&
    anniversaryEmail.html.includes("$2,042/month") &&
    anniversaryEmail.html.includes("2026-11-01") &&
    anniversaryEmail.html.includes("2026-08-03"),
);
ok(
  "anniversary email text includes all public links",
  anniversaryEmail.text.includes("/confirm-rent/overdue") &&
    anniversaryEmail.text.includes("/confirm-rent/window") &&
    anniversaryEmail.text.includes("/confirm-rent/scheduled"),
);
ok("anniversary customer copy has no em dash", !anniversaryEmail.subject.includes("—") && !anniversaryEmail.html.includes("—") && !anniversaryEmail.text.includes("—"));

// --- recipient routing: landlord email only, never the org member ----------
ok("recipient resolves a valid landlord email (lowercased)", resolveLandlordCampaignRecipient("David@Example.com ") === "david@example.com");
ok("recipient null when landlord email missing", resolveLandlordCampaignRecipient(null) === null);
ok("recipient null when landlord email blank", resolveLandlordCampaignRecipient("   ") === null);
ok("recipient null when landlord email lacks @", resolveLandlordCampaignRecipient("not-an-email") === null);
ok("normalizeCampaignEmail trims + lowercases", normalizeCampaignEmail("  A@B.CA ") === "a@b.ca");

// --- cron dry-run preview: no sends, no writes -----------------------------
type FakeFilter = {
  op: "eq" | "in" | "lt" | "gt";
  column: string;
  value: unknown;
};

class FakeQuery {
  public selectColumns = "";
  public operation: "select" | "update" = "select";
  public updatePayload: Record<string, unknown> | null = null;
  public filters: FakeFilter[] = [];

  constructor(
    public readonly db: FakeCampaignDb,
    public readonly table: string,
  ) {}

  select(columns: string): this {
    this.selectColumns = columns;
    return this;
  }

  update(payload: Record<string, unknown>): this {
    this.operation = "update";
    this.updatePayload = payload;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ op: "eq", column, value });
    return this;
  }

  in(column: string, value: unknown): this {
    this.filters.push({ op: "in", column, value });
    return this;
  }

  lt(column: string, value: unknown): this {
    this.filters.push({ op: "lt", column, value });
    return this;
  }

  gt(column: string, value: unknown): this {
    this.filters.push({ op: "gt", column, value });
    return this;
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.db.resolve(this)).then(onfulfilled, onrejected);
  }
}

type FakeOrg = {
  id: string;
  name: string;
  brand_color: string | null;
  logo_url: string | null;
  reply_to_email: string | null;
  public_contact_email: string | null;
  booking_timezone: string | null;
  plan: string;
  created_at: string;
  landlord_campaign_step_sent: number;
  landlord_campaign_last_sent_at: string | null;
  landlord_campaign_email: string;
};

type FakeTenancy = {
  id: string;
  organization_id: string;
  property_id: string;
  rent_cents: number;
  confirm_token: string;
  start_date: string;
  last_rent_increase_date: string | null;
};

type FakeProperty = {
  id: string;
  organization_id: string;
  address: string;
  rent_control_exempt: boolean;
};

class FakeCampaignDb {
  public updates: Array<{ table: string; payload: Record<string, unknown> | null }> = [];

  public orgs: FakeOrg[] = [
    org("david", "David Harel", "david@example.com"),
    org("fiona", "Fiona & Jeff", "fiona@example.com"),
    org("mahmood", "Mahmood", "mahmood@example.com"),
    org("paul", "Paul Peretz", "paul@example.com"),
  ];

  public tenancies: FakeTenancy[] = [
    tenancy("david-a", "david", "david-p1", "8 Sultan 402", "2020-10-01"),
    tenancy("david-b", "david", "david-p2", "8 Sultan 403", "2023-04-01"),
    tenancy("fiona-a", "fiona", "fiona-p1", "354 Merton Lower", "2025-06-01"),
    tenancy("mahmood-a", "mahmood", "mahmood-p1", "1 Bloor 3701", "2026-08-01"),
    tenancy("paul-a", "paul", "paul-p1", "10 Bellair 1604", "2026-02-01"),
  ];

  public properties: FakeProperty[] = this.tenancies.map((row) => ({
    id: row.property_id,
    organization_id: row.organization_id,
    address: propertyAddress(row.organization_id, row.property_id),
    rent_control_exempt: false,
  }));

  from(table: string): FakeQuery {
    return new FakeQuery(this, table);
  }

  resolve(query: FakeQuery): { data: unknown; error: null } {
    if (query.operation === "update") {
      this.updates.push({ table: query.table, payload: query.updatePayload });
      return { data: null, error: null };
    }
    if (query.table === "organizations") {
      return { data: this.orgs, error: null };
    }
    if (query.table === "organization_feature_flags") {
      return { data: [], error: null };
    }
    if (query.table === "tenancies") {
      if (query.selectColumns === "organization_id") {
        return {
          data: this.tenancies.map((row) => ({ organization_id: row.organization_id })),
          error: null,
        };
      }
      const orgId = eqFilter(query, "organization_id");
      return {
        data: this.tenancies.filter((row) => row.organization_id === orgId),
        error: null,
      };
    }
    if (query.table === "properties") {
      if (query.selectColumns === "organization_id, address") {
        return {
          data: this.properties.map((row) => ({
            organization_id: row.organization_id,
            address: row.address,
          })),
          error: null,
        };
      }
      const orgId = eqFilter(query, "organization_id");
      return {
        data: this.properties.filter((row) => row.organization_id === orgId),
        error: null,
      };
    }
    if (
      query.table === "stripe_connect_accounts" ||
      query.table === "rotessa_accounts" ||
      query.table === "tenancy_rent_adjustments"
    ) {
      return { data: [], error: null };
    }
    return { data: [], error: null };
  }
}

function org(id: string, name: string, email: string): FakeOrg {
  return {
    id,
    name,
    brand_color: null,
    logo_url: null,
    reply_to_email: null,
    public_contact_email: null,
    booking_timezone: "America/Toronto",
    plan: "free",
    created_at: "2026-07-15T12:00:00.000Z",
    landlord_campaign_step_sent: 0,
    landlord_campaign_last_sent_at: null,
    landlord_campaign_email: email,
  };
}

function tenancy(
  id: string,
  organizationId: string,
  propertyId: string,
  address: string,
  startDate: string,
): FakeTenancy {
  return {
    id,
    organization_id: organizationId,
    property_id: propertyId,
    rent_cents: 250000,
    confirm_token: `token-${id}`,
    start_date: startDate,
    last_rent_increase_date: null,
  };
}

function propertyAddress(orgId: string, propertyId: string): string {
  const addresses: Record<string, string> = {
    "david-p1": "8 Sultan 402",
    "david-p2": "8 Sultan 403",
    "fiona-p1": "354 Merton Lower",
    "mahmood-p1": "1 Bloor 3701",
    "paul-p1": "10 Bellair 1604",
  };
  return addresses[propertyId] ?? `${orgId} unit`;
}

function eqFilter(query: FakeQuery, column: string): unknown {
  return query.filters.find((filter) => filter.op === "eq" && filter.column === column)?.value;
}

async function runDryPreviewTest() {
  const fakeDb = new FakeCampaignDb();
  let rentConfirmSends = 0;
  let notificationSends = 0;
  const response = await runLandlordCampaign(
    new NextRequest("https://app.vacantless.com/api/cron/landlord-campaign?secret=test&dry=1"),
    {
      env: {
        CRON_SECRET: "test",
        NEXT_PUBLIC_APP_URL: "https://app.vacantless.com",
      },
      nowMs: () => Date.parse("2026-07-31T16:00:00.000Z"),
      createAdminClient: () => fakeDb as never,
      loadGuidelineLookup: async () => () => 2.1,
      leaseTermShiftEnabled: () => false,
      sendLandlordRentConfirmEmail: async () => {
        rentConfirmSends++;
        return { sent: true };
      },
      sendNotificationEmail: async () => {
        notificationSends++;
        return { sent: true };
      },
      rentConfirmUrl: (token: string) =>
        `https://app.vacantless.com/confirm-rent/${token}`,
    },
  );
  const body = (await response.json()) as {
    scanned: number;
    sent: number;
    wouldSend: number;
    skipped: number;
    details: Array<Record<string, unknown>>;
  };
  const detail = (orgId: string) =>
    body.details.find((row) => row.org === orgId) ?? {};

  ok("dry preview scans while campaign env master is dark", body.scanned === 4);
  ok("dry preview records would-send count only", body.sent === 0 && body.wouldSend === 2);
  ok("dry preview does not call send seams", rentConfirmSends === 0 && notificationSends === 0);
  ok("dry preview does not update organizations", fakeDb.updates.length === 0);
  ok(
    "dry preview would send mature David/Fiona orgs",
    detail("david").would_send_to === "david@example.com" &&
      detail("fiona").would_send_to === "fiona@example.com",
  );
  ok(
    "dry preview first-year-only Mahmood/Paul drop out of step 1",
    detail("mahmood").would_send_to === null &&
      Array.isArray(detail("mahmood").first_year_skipped) &&
      (detail("mahmood").first_year_skipped as string[]).includes("1 Bloor 3701") &&
      detail("paul").would_send_to === null &&
      Array.isArray(detail("paul").first_year_skipped) &&
      (detail("paul").first_year_skipped as string[]).includes("10 Bellair 1604"),
  );
}

runDryPreviewTest()
  .catch((err) => {
    failed++;
    console.error(err instanceof Error ? err.message : err);
  })
  .finally(() => {
    console.log(
      `\ntest-landlord-campaign: ${passed} passed, ${failed} failed (${passed + failed} total)`,
    );
    if (failed > 0) process.exit(1);
  });
