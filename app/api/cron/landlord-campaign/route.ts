import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { envFlagEnabled } from "@/lib/auto-listing-copy";
import {
  sendLandlordRentConfirmEmail,
  sendNotificationEmail,
} from "@/lib/email";
import { hasEntitlement } from "@/lib/billing";
import {
  isFeatureEnabledForOrg,
  loadOrganizationFeatureFlagsByOrg,
} from "@/lib/feature-entitlements";
import { localDateString } from "@/lib/leasing-snapshot";
import { deriveRentIncrease } from "@/lib/rent-increase";
import { loadGuidelineLookup } from "@/lib/guideline-server";
import { leaseTermShiftEnabled } from "@/lib/rent-adjustments-server";
import { rentConfirmUrl } from "@/lib/rent-confirm-public";
import {
  buildAnniversaryRentConfirmPlan,
  buildRentConfirmUnits,
  campaignCadenceAnchorMs,
  isWithinFirstYear,
  nextRevealDue,
  revealCopy,
  resolveLandlordCampaignRecipient,
  CAMPAIGN_STEPS,
  CAMPAIGN_MAX_AGE_DAYS,
  HOUR_MS,
  LANDLORD_CAMPAIGN_START_MS,
  MIN_GAP_HOURS,
  STEP_THRESHOLD_DAYS,
} from "@/lib/landlord-campaign";

// Landlord feature-reveal sweep (Tier 1 C). Finds FREE-plan orgs with a tenancy
// whose next reveal is due, sends the one branded reveal, and bumps
// organizations.landlord_campaign_step_sent + landlord_campaign_last_sent_at.
// Idempotent + catch-up safe: only ever sends the next reveal, one per org per
// run. Ships DARK behind LANDLORD_CAMPAIGN_ENABLED.
//
// Auth + transport mirror app/api/cron/nurture: CRON_SECRET-gated; reads/writes
// across all orgs via the service-role client (RLS hides them from anon/user
// sessions). Schedule daily.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_APP_URL = "https://vacantless-app.vercel.app";
const DAY_MS = 24 * 3_600_000;

type Summary = {
  ok: boolean;
  reason?: string;
  scanned: number;
  sent: number;
  wouldSend: number;
  skipped: number;
  errors: number;
  details: Array<Record<string, unknown>>;
};

type CampaignEnv = Record<string, string | undefined>;

type CampaignDeps = {
  env: CampaignEnv;
  nowMs: () => number;
  createAdminClient: typeof createAdminClient;
  loadGuidelineLookup: typeof loadGuidelineLookup;
  leaseTermShiftEnabled: typeof leaseTermShiftEnabled;
  sendLandlordRentConfirmEmail: typeof sendLandlordRentConfirmEmail;
  sendNotificationEmail: typeof sendNotificationEmail;
  rentConfirmUrl: typeof rentConfirmUrl;
};

type CampaignOrg = {
  id: string;
  name: string | null;
  brand_color: string | null;
  logo_url: string | null;
  reply_to_email: string | null;
  public_contact_email: string | null;
  booking_timezone: string | null;
  plan: string | null;
  created_at: string | null;
  landlord_campaign_step_sent: number | null;
  landlord_campaign_last_sent_at: string | null;
  landlord_campaign_email?: string | null;
};

type RentConfirmPlan = {
  units: ReturnType<typeof buildRentConfirmUnits>;
  firstYearSkippedUnits: ReturnType<typeof buildRentConfirmUnits>;
  anniversaryPlan: ReturnType<typeof buildAnniversaryRentConfirmPlan>;
};

type RentConfirmPlanResult =
  | { ok: true; plan: RentConfirmPlan }
  | { ok: false; error: string };

type DryJourneyResult =
  | { kind: "would_send"; detail: Record<string, unknown> }
  | { kind: "skipped"; detail: Record<string, unknown> }
  | { kind: "error"; detail: Record<string, unknown> };

const defaultDeps: CampaignDeps = {
  env: process.env,
  nowMs: () => Date.now(),
  createAdminClient,
  loadGuidelineLookup,
  leaseTermShiftEnabled,
  sendLandlordRentConfirmEmail,
  sendNotificationEmail,
  rentConfirmUrl,
};

function authorized(req: NextRequest, env: CampaignEnv): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  return req.nextUrl.searchParams.get("secret") === secret;
}

function landlordCampaignActivatedAtMs(env: CampaignEnv): number {
  const raw = env.LANDLORD_CAMPAIGN_START ?? env.CAMPAIGN_START;
  if (!raw?.trim()) return LANDLORD_CAMPAIGN_START_MS;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? LANDLORD_CAMPAIGN_START_MS : parsed;
}

function isCampaignDeps(value: unknown): value is CampaignDeps {
  return (
    value != null &&
    typeof value === "object" &&
    "env" in value &&
    "createAdminClient" in value &&
    "sendLandlordRentConfirmEmail" in value
  );
}

function normalizeSingleTestEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (!email) return null;
  if (/[\s,;]/.test(email)) return null;
  if ((email.match(/@/g) ?? []).length !== 1) return null;
  if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) return null;
  return email;
}

async function loadRentConfirmPlanForOrg(args: {
  admin: NonNullable<ReturnType<typeof createAdminClient>>;
  org: Pick<CampaignOrg, "id" | "booking_timezone">;
  nowMs: number;
  guideline: Awaited<ReturnType<typeof loadGuidelineLookup>>;
  leaseTermShiftOn: boolean;
  rentConfirmUrl: typeof rentConfirmUrl;
}): Promise<RentConfirmPlanResult> {
  const { admin, org, nowMs, guideline, leaseTermShiftOn } = args;
  const { data: rentConfirmRows, error: rentConfirmErr } = await admin
    .from("tenancies")
    .select("id, property_id, rent_cents, confirm_token, start_date, last_rent_increase_date")
    .eq("organization_id", org.id)
    .eq("status", "active");

  if (rentConfirmErr) {
    return { ok: false, error: `rent_confirm_tenancies_failed:${rentConfirmErr.message}` };
  }

  const rawTenancies = (rentConfirmRows ?? []) as Array<{
    id: string | null;
    property_id: string | null;
    rent_cents: number | null;
    confirm_token: string | null;
    start_date: string | null;
    last_rent_increase_date: string | null;
  }>;
  const tenancyIds = rawTenancies.flatMap((row) => (row.id ? [row.id] : []));
  const propertyIds = Array.from(
    new Set(rawTenancies.flatMap((row) => (row.property_id ? [row.property_id] : []))),
  );
  const addressByPropertyId = new Map<string, string | null>();
  const rentControlExemptByPropertyId = new Map<string, boolean>();
  if (propertyIds.length > 0) {
    const { data: addressRows, error: addressErr } = await admin
      .from("properties")
      .select("id, address, rent_control_exempt")
      .eq("organization_id", org.id)
      .in("id", propertyIds);
    if (addressErr) {
      return { ok: false, error: `rent_confirm_properties_failed:${addressErr.message}` };
    }
    for (const row of (addressRows ?? []) as Array<{
      id: string | null;
      address: string | null;
      rent_control_exempt: boolean | null;
    }>) {
      if (row.id) {
        addressByPropertyId.set(row.id, row.address);
        rentControlExemptByPropertyId.set(
          row.id,
          row.rent_control_exempt === true,
        );
      }
    }
  }

  const confirmedTenancyIds = new Set<string>();
  const baselineConfirmedTenancyIds = new Set<string>();
  if (tenancyIds.length > 0) {
    const [confirmedResult, baselineResult] = await Promise.all([
      admin
        .from("tenancy_rent_adjustments")
        .select("tenancy_id")
        .eq("organization_id", org.id)
        .eq("source", "landlord_confirm")
        .in("tenancy_id", tenancyIds),
      leaseTermShiftOn
        ? admin
            .from("tenancy_rent_adjustments")
            .select("tenancy_id")
            .eq("organization_id", org.id)
            .in("tenancy_id", tenancyIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const { data: confirmedRows, error: confirmedErr } = confirmedResult;
    const { data: baselineRows, error: baselineErr } = baselineResult;
    if (confirmedErr) {
      return { ok: false, error: `rent_confirm_ledger_failed:${confirmedErr.message}` };
    }
    if (baselineErr) {
      return { ok: false, error: `rent_confirm_baseline_failed:${baselineErr.message}` };
    }
    for (const row of (confirmedRows ?? []) as { tenancy_id: string | null }[]) {
      if (row.tenancy_id) confirmedTenancyIds.add(row.tenancy_id);
    }
    for (const row of (baselineRows ?? []) as { tenancy_id: string | null }[]) {
      if (row.tenancy_id) baselineConfirmedTenancyIds.add(row.tenancy_id);
    }
  }

  const today = localDateString(nowMs, org.booking_timezone || "America/Toronto");
  const campaignTenancies = rawTenancies.flatMap((row) =>
    row.id && row.confirm_token
      ? [
          {
            id: row.id,
            address: row.property_id
              ? addressByPropertyId.get(row.property_id) ?? null
              : null,
            rentCents: row.rent_cents,
            confirmToken: row.confirm_token,
            startDate: row.start_date,
          },
        ]
      : [],
  );
  const firstYearTenancies = campaignTenancies.filter((tenancy) =>
    isWithinFirstYear(tenancy.startDate, today),
  );
  const eligibleTenancies = campaignTenancies.filter(
    (tenancy) => !isWithinFirstYear(tenancy.startDate, today),
  );
  const firstYearSkippedUnits = buildRentConfirmUnits({
    tenancies: firstYearTenancies,
    confirmedTenancyIds,
    urlFor: args.rentConfirmUrl,
  });
  const units = buildRentConfirmUnits({
    tenancies: eligibleTenancies,
    confirmedTenancyIds,
    urlFor: args.rentConfirmUrl,
  });

  const unitByTenancyId = new Map(units.map((unit) => [unit.tenancyId, unit]));
  const anniversaryPlan = buildAnniversaryRentConfirmPlan(
    rawTenancies.flatMap((row) => {
      if (!row.id) return [];
      const unit = unitByTenancyId.get(row.id);
      if (!unit) return [];
      if (
        row.rent_cents == null ||
        row.rent_cents <= 0 ||
        !row.start_date ||
        (leaseTermShiftOn && !baselineConfirmedTenancyIds.has(row.id))
      ) {
        return [{ ...unit, rentIncrease: null }];
      }
      const result = deriveRentIncrease(
        {
          startDate: row.start_date,
          currentRentCents: row.rent_cents,
          lastIncreaseDate: row.last_rent_increase_date ?? null,
          exempt: row.property_id
            ? rentControlExemptByPropertyId.get(row.property_id) === true
            : false,
          guideline,
        },
        today,
      );
      return [{ ...unit, rentIncrease: result }];
    }),
  );

  return {
    ok: true,
    plan: {
      units,
      firstYearSkippedUnits,
      anniversaryPlan,
    },
  };
}

function dryPreviewDue(args: {
  base: Omit<Parameters<typeof nextRevealDue>[0], "nowMs" | "stepSent" | "lastSentAtMs">;
  nowMs: number;
  stepSent: number;
  lastSentAtMs: number | null;
}): { due: NonNullable<ReturnType<typeof nextRevealDue>>; dueAtMs: number } | null {
  const immediate = nextRevealDue({
    ...args.base,
    nowMs: args.nowMs,
    stepSent: args.stepSent,
    lastSentAtMs: args.lastSentAtMs,
  });
  if (immediate) return { due: immediate, dueAtMs: args.nowMs };
  const cadenceAnchorMs = campaignCadenceAnchorMs(
    args.base.campaignStartMs,
    args.base.campaignActivatedAtMs,
  );
  if (cadenceAnchorMs == null) return null;

  const minGapMs =
    args.lastSentAtMs == null
      ? 0
      : args.lastSentAtMs + MIN_GAP_HOURS * HOUR_MS;
  const startIndex = Number.isInteger(args.stepSent) && args.stepSent > 0
    ? args.stepSent
    : 0;

  for (let idx = startIndex; idx < CAMPAIGN_STEPS; idx++) {
    const thresholdMs =
      cadenceAnchorMs + (STEP_THRESHOLD_DAYS[idx] ?? 0) * DAY_MS;
    const dueAtMs = Math.max(args.nowMs, thresholdMs, minGapMs);
    const due = nextRevealDue({
      ...args.base,
      nowMs: dueAtMs,
      stepSent: args.stepSent,
      lastSentAtMs: args.lastSentAtMs,
    });
    if (due) return { due, dueAtMs };
  }

  return null;
}

async function previewDryCampaignJourney(args: {
  admin: NonNullable<ReturnType<typeof createAdminClient>>;
  org: CampaignOrg;
  nowMs: number;
  guideline: Awaited<ReturnType<typeof loadGuidelineLookup>>;
  leaseTermShiftOn: boolean;
  rentConfirmUrl: typeof rentConfirmUrl;
  to: string;
  hasTenancy: boolean;
  hasRentCollection: boolean;
  hasTaxExport: boolean;
  hasListingMarketing: boolean;
  campaignActivatedAtMs: number;
}): Promise<DryJourneyResult> {
  const campaignStartMs = args.org.created_at
    ? new Date(args.org.created_at).getTime()
    : null;
  const base = {
    campaignStartMs,
    campaignActivatedAtMs: args.campaignActivatedAtMs,
    plan: args.org.plan,
    hasTenancy: args.hasTenancy,
    enabled: true,
    optedOut: false,
    hasRentCollection: args.hasRentCollection,
    hasTaxExport: args.hasTaxExport,
    hasListingMarketing: args.hasListingMarketing,
  };
  let stepSent = args.org.landlord_campaign_step_sent ?? 0;
  let lastSentAtMs = args.org.landlord_campaign_last_sent_at
    ? new Date(args.org.landlord_campaign_last_sent_at).getTime()
    : null;
  let previewNowMs = args.nowMs;
  const journey: Array<Record<string, unknown>> = [];

  for (let guard = 0; guard <= CAMPAIGN_STEPS; guard++) {
    const resolved = dryPreviewDue({
      base,
      nowMs: previewNowMs,
      stepSent,
      lastSentAtMs,
    });

    if (!resolved) {
      return {
        kind: "skipped",
        detail: {
          org: args.org.id,
          dry: true,
          skipped: journey.length > 0 ? "no_terminal_action" : "not_due",
          journey,
        },
      };
    }

    const { due, dueAtMs } = resolved;
    previewNowMs = dueAtMs;

    if (due.key === "rent_increase_confirm") {
      const plan = await loadRentConfirmPlanForOrg({
        admin: args.admin,
        org: args.org,
        nowMs: dueAtMs,
        guideline: args.guideline,
        leaseTermShiftOn: args.leaseTermShiftOn,
        rentConfirmUrl: args.rentConfirmUrl,
      });

      if (!plan.ok) {
        return {
          kind: "error",
          detail: {
            org: args.org.id,
            reveal: due.key,
            step: due.index + 1,
            error: plan.error,
            journey,
          },
        };
      }

      const { units, firstYearSkippedUnits, anniversaryPlan } = plan.plan;
      if (units.length === 0) {
        journey.push({
          reveal: due.key,
          step: due.index + 1,
          skipped: "no_unconfirmed_rent_units",
          eligible_units: [],
          first_year_skipped: firstYearSkippedUnits.map((unit) => unit.address),
          preview_at: new Date(dueAtMs).toISOString(),
        });
        stepSent = due.index + 1;
        // Match live skip-advance behavior: no last_sent_at stamp is written.
        lastSentAtMs = lastSentAtMs ?? null;
        continue;
      }

      return {
        kind: "would_send",
        detail: {
          org: args.org.id,
          reveal: due.key,
          dry: true,
          step: due.index + 1,
          would_send_to: args.to,
          eligible_units: units.map((unit) => unit.address),
          first_year_skipped: firstYearSkippedUnits.map((unit) => unit.address),
          hero: anniversaryPlan.hero?.tenancyId ?? null,
          preview_at: new Date(dueAtMs).toISOString(),
          journey,
        },
      };
    }

    return {
      kind: "would_send",
      detail: {
        org: args.org.id,
        reveal: due.key,
        dry: true,
        step: due.index + 1,
        would_send_to: args.to,
        preview_at: new Date(dueAtMs).toISOString(),
        journey,
      },
    };
  }

  return {
    kind: "skipped",
    detail: {
      org: args.org.id,
      dry: true,
      skipped: "preview_guard_exhausted",
      journey,
    },
  };
}

async function runLandlordCampaign(
  req: NextRequest,
  deps: CampaignDeps = defaultDeps,
) {
  if (!authorized(req, deps.env)) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  const dry = req.nextUrl.searchParams.get("dry") === "1";
  const rawTestTo = req.nextUrl.searchParams.get("test_to");
  const rawTestOrg = req.nextUrl.searchParams.get("test_org");
  const hasTestParam = rawTestTo !== null || rawTestOrg !== null;
  const testTo = rawTestTo?.trim() ?? "";
  const testOrg = rawTestOrg?.trim() ?? "";
  const testMode = hasTestParam && testTo.length > 0 && testOrg.length > 0;

  if (hasTestParam && !testMode) {
    return NextResponse.json(
      { ok: false, test: true, reason: "missing_test_params", sent: 0 },
      { status: 400 },
    );
  }

  const normalizedTestTo = testMode ? normalizeSingleTestEmail(testTo) : null;
  if (testMode && !normalizedTestTo) {
    return NextResponse.json(
      { ok: false, test: true, reason: "invalid_test_to", sent: 0 },
      { status: 400 },
    );
  }

  // Dark switch: the whole campaign is off until the flag is set.
  if (!dry && !testMode && !envFlagEnabled(deps.env.LANDLORD_CAMPAIGN_ENABLED)) {
    return NextResponse.json(
      { ok: true, reason: "disabled", scanned: 0, sent: 0, wouldSend: 0, skipped: 0, errors: 0, details: [] } satisfies Summary,
      { status: 200 },
    );
  }

  const admin = deps.createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { ok: false, reason: "service_role_not_configured", scanned: 0, sent: 0, wouldSend: 0, skipped: 0, errors: 0, details: [] } satisfies Summary,
      { status: 200 },
    );
  }

  const nowMs = deps.nowMs();
  const campaignActivatedAtMs = landlordCampaignActivatedAtMs(deps.env);
  const guideline = await deps.loadGuidelineLookup(admin);
  const leaseTermShiftOn = deps.leaseTermShiftEnabled();
  const oldestIso = new Date(nowMs - CAMPAIGN_MAX_AGE_DAYS * DAY_MS).toISOString();

  if (testMode) {
    const { data: testOrgData, error: testOrgErr } = await admin
      .from("organizations")
      .select("id, name, brand_color, logo_url, reply_to_email, public_contact_email, booking_timezone, plan")
      .eq("id", testOrg);

    if (testOrgErr) {
      return NextResponse.json(
        { ok: false, test: true, reason: `query_error:${testOrgErr.message}`, sent: 0 },
        { status: 400 },
      );
    }

    const testOrgs = (testOrgData ?? []) as CampaignOrg[];
    if (testOrgs.length !== 1) {
      return NextResponse.json(
        { ok: false, test: true, reason: "invalid_test_org", sent: 0 },
        { status: 400 },
      );
    }

    const org = testOrgs[0]!;
    const featureFlagsByOrg = await loadOrganizationFeatureFlagsByOrg(
      admin,
      [org.id],
      ["landlord_campaign"],
    );
    const enabled = isFeatureEnabledForOrg(
      "landlord_campaign",
      { ...org, featureFlags: featureFlagsByOrg.get(org.id) ?? [] },
      { env: { ...deps.env, LANDLORD_CAMPAIGN_ENABLED: "1" } },
    );

    if (!enabled) {
      return NextResponse.json(
        { ok: true, test: true, sent: 0, reason: "feature_disabled", org: testOrg },
        { status: 200 },
      );
    }

    const plan = await loadRentConfirmPlanForOrg({
      admin,
      org,
      nowMs,
      guideline,
      leaseTermShiftOn,
      rentConfirmUrl: deps.rentConfirmUrl,
    });

    if (!plan.ok) {
      return NextResponse.json(
        { ok: false, test: true, reason: plan.error, sent: 0, org: testOrg },
        { status: 200 },
      );
    }

    const { units, anniversaryPlan } = plan.plan;
    if (units.length === 0) {
      return NextResponse.json(
        {
          ok: true,
          test: true,
          sent: 0,
          reason: "no_eligible_units",
          org: testOrg,
          units: 0,
          hero: null,
        },
        { status: 200 },
      );
    }

    const result = await deps.sendLandlordRentConfirmEmail({
      to_email: normalizedTestTo!,
      org_name: org.name,
      brand_color: org.brand_color,
      logo_url: org.logo_url,
      reply_to_email: org.reply_to_email,
      units: anniversaryPlan.hero ? anniversaryPlan.others : units,
      hero: anniversaryPlan.hero,
    });

    if (!result.sent) {
      return NextResponse.json(
        {
          ok: false,
          test: true,
          sent: 0,
          reason: result.reason,
          org: testOrg,
          to: normalizedTestTo,
          units: units.length,
          hero: anniversaryPlan.hero?.tenancyId ?? null,
        },
        { status: 200 },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        test: true,
        sent: 1,
        to: normalizedTestTo,
        org: testOrg,
        units: units.length,
        hero: anniversaryPlan.hero?.tenancyId ?? null,
      },
      { status: 200 },
    );
  }

  // Candidate orgs: free plan, not opted out, not finished, still fresh.
  const { data: orgData, error: orgErr } = await admin
    .from("organizations")
    .select(
      "id, name, brand_color, logo_url, reply_to_email, public_contact_email, booking_timezone, plan, created_at, landlord_campaign_step_sent, landlord_campaign_last_sent_at, landlord_campaign_opted_out, landlord_campaign_email",
    )
    .eq("plan", "free")
    .eq("landlord_campaign_opted_out", false)
    .lt("landlord_campaign_step_sent", CAMPAIGN_STEPS)
    .gt("created_at", oldestIso);

  if (orgErr) {
    return NextResponse.json(
      { ok: false, reason: `query_error:${orgErr.message}`, scanned: 0, sent: 0, wouldSend: 0, skipped: 0, errors: 1, details: [] } satisfies Summary,
      { status: 200 },
    );
  }

  const orgs = (orgData ?? []) as Array<{
    id: string;
    name: string | null;
    brand_color: string | null;
    logo_url: string | null;
    reply_to_email: string | null;
    public_contact_email: string | null;
    booking_timezone: string | null;
    plan: string | null;
    created_at: string | null;
    landlord_campaign_step_sent: number | null;
    landlord_campaign_last_sent_at: string | null;
    landlord_campaign_email: string | null;
  }>;
  const summary: Summary = { ok: true, scanned: orgs.length, sent: 0, wouldSend: 0, skipped: 0, errors: 0, details: [] };

  if (orgs.length === 0) return NextResponse.json(summary, { status: 200 });

  const orgIds = orgs.map((o) => o.id);
  const featureFlagsByOrg = await loadOrganizationFeatureFlagsByOrg(
    admin,
    orgIds,
    ["landlord_campaign"],
  );

  // Which candidate orgs have a tenancy (a real landlord), and one property
  // address each (for reveal copy). Both RLS-bypassing service-role reads,
  // scoped to the candidate set.
  const [
    { data: tenancyRows },
    { data: propRows },
    { data: stripeRentRows, error: stripeRentErr },
    { data: rotessaRentRows, error: rotessaRentErr },
  ] = await Promise.all([
    admin.from("tenancies").select("organization_id").in("organization_id", orgIds),
    admin.from("properties").select("organization_id, address").in("organization_id", orgIds),
    admin
      .from("stripe_connect_accounts")
      .select("organization_id, charges_enabled")
      .in("organization_id", orgIds)
      .eq("charges_enabled", true),
    admin
      .from("rotessa_accounts")
      .select("organization_id, connection_status")
      .in("organization_id", orgIds)
      .eq("connection_status", "connected"),
  ]);
  if (stripeRentErr || rotessaRentErr) {
    const message = stripeRentErr?.message ?? rotessaRentErr?.message ?? "unknown";
    return NextResponse.json(
      { ok: false, reason: `query_error:${message}`, scanned: orgs.length, sent: 0, wouldSend: 0, skipped: 0, errors: 1, details: [] } satisfies Summary,
      { status: 200 },
    );
  }
  const orgsWithTenancy = new Set<string>();
  for (const r of (tenancyRows ?? []) as { organization_id: string | null }[]) {
    if (r.organization_id) orgsWithTenancy.add(r.organization_id);
  }
  const activeRentRailOrgIds = new Set<string>();
  for (const r of (stripeRentRows ?? []) as Array<{
    organization_id: string | null;
    charges_enabled: boolean | null;
  }>) {
    if (r.organization_id && r.charges_enabled === true) {
      activeRentRailOrgIds.add(r.organization_id);
    }
  }
  for (const r of (rotessaRentRows ?? []) as Array<{
    organization_id: string | null;
    connection_status: string | null;
  }>) {
    if (r.organization_id && r.connection_status === "connected") {
      activeRentRailOrgIds.add(r.organization_id);
    }
  }
  const orgHasActiveRentRail = (orgId: string): boolean =>
    activeRentRailOrgIds.has(orgId);
  const firstAddress = new Map<string, string>();
  for (const r of (propRows ?? []) as { organization_id: string | null; address: string | null }[]) {
    if (r.organization_id && r.address && !firstAddress.has(r.organization_id)) {
      firstAddress.set(r.organization_id, r.address);
    }
  }

  for (const org of orgs) {
    try {
      if (
        !isFeatureEnabledForOrg(
          "landlord_campaign",
          { ...org, featureFlags: featureFlagsByOrg.get(org.id) ?? [] },
          {
            env: dry
              ? { ...deps.env, LANDLORD_CAMPAIGN_ENABLED: "1" }
              : deps.env,
          },
        )
      ) {
        summary.skipped++;
        summary.details.push({ org: org.id, skipped: "feature_disabled" });
        continue;
      }

      const due = nextRevealDue({
        campaignStartMs: org.created_at ? new Date(org.created_at).getTime() : null,
        campaignActivatedAtMs,
        nowMs,
        plan: org.plan,
        hasTenancy: orgsWithTenancy.has(org.id),
        enabled: true,
        optedOut: false, // already filtered out in the query
        stepSent: org.landlord_campaign_step_sent ?? 0,
        lastSentAtMs: org.landlord_campaign_last_sent_at
          ? new Date(org.landlord_campaign_last_sent_at).getTime()
          : null,
        hasRentCollection: orgHasActiveRentRail(org.id),
        hasTaxExport: hasEntitlement(org.plan, "tax_export"),
        hasListingMarketing: hasEntitlement(org.plan, "listing_marketing"),
      });

      if (!due && !dry) {
        summary.skipped++;
        continue;
      }

      // Route to the LANDLORD, never the org member. A proxy-onboarded org's
      // sole member is the AGENT (e.g. Noam), so the old member-first fallback
      // emailed the wrong person. Require an explicit landlord email; if it is
      // not set, skip the org this run WITHOUT stamping, so the sequence
      // resumes once the landlord email is filled in. This is the gate that
      // makes a LANDLORD_CAMPAIGN_ENABLED flip safe.
      const to = resolveLandlordCampaignRecipient(org.landlord_campaign_email);
      if (!to) {
        summary.skipped++;
        summary.details.push({ org: org.id, skipped: "no_landlord_email", reveal: due?.key ?? null });
        continue;
      }

      if (dry) {
        const preview = await previewDryCampaignJourney({
          admin,
          org,
          nowMs,
          guideline,
          leaseTermShiftOn,
          rentConfirmUrl: deps.rentConfirmUrl,
          to,
          hasTenancy: orgsWithTenancy.has(org.id),
          hasRentCollection: orgHasActiveRentRail(org.id),
          hasTaxExport: hasEntitlement(org.plan, "tax_export"),
          hasListingMarketing: hasEntitlement(org.plan, "listing_marketing"),
          campaignActivatedAtMs,
        });

        if (preview.kind === "would_send") {
          summary.wouldSend++;
        } else if (preview.kind === "error") {
          summary.errors++;
        } else {
          summary.skipped++;
        }
        summary.details.push(preview.detail);
        continue;
      }

      if (!due) {
        summary.skipped++;
        continue;
      }

      if (due.key === "rent_increase_confirm") {
        const plan = await loadRentConfirmPlanForOrg({
          admin,
          org,
          nowMs,
          guideline,
          leaseTermShiftOn,
          rentConfirmUrl: deps.rentConfirmUrl,
        });

        if (!plan.ok) {
          summary.errors++;
          summary.details.push({
            org: org.id,
            reveal: due.key,
            error: plan.error,
          });
          continue;
        }

        const { units, anniversaryPlan } = plan.plan;

        if (units.length === 0) {
          const { error: stampErr } = await admin
            .from("organizations")
            .update({ landlord_campaign_step_sent: due.index + 1 })
            .eq("id", org.id);

          if (stampErr) {
            summary.errors++;
            summary.details.push({
              org: org.id,
              reveal: due.key,
              error: `stamp_failed:${stampErr.message}`,
            });
            continue;
          }

          summary.skipped++;
          summary.details.push({
            org: org.id,
            skipped: "no_unconfirmed_rent_units",
            reveal: due.key,
            step: due.index + 1,
          });
          continue;
        }

        const result = await deps.sendLandlordRentConfirmEmail({
          to_email: to,
          org_name: org.name,
          brand_color: org.brand_color,
          logo_url: org.logo_url,
          reply_to_email: org.reply_to_email,
          units: anniversaryPlan.hero ? anniversaryPlan.others : units,
          hero: anniversaryPlan.hero,
        });

        if (!result.sent) {
          summary.errors++;
          summary.details.push({ org: org.id, reveal: due.key, error: result.reason });
          continue;
        }

        const { error: stampErr } = await admin
          .from("organizations")
          .update({
            landlord_campaign_step_sent: due.index + 1,
            landlord_campaign_last_sent_at: new Date(nowMs).toISOString(),
          })
          .eq("id", org.id);

        if (stampErr) {
          summary.errors++;
          summary.details.push({ org: org.id, reveal: due.key, error: `stamp_failed:${stampErr.message}` });
          continue;
        }

        summary.sent++;
        summary.details.push({
          org: org.id,
          reveal: due.key,
          step: due.index + 1,
          to,
          units: units.length,
          hero: anniversaryPlan.hero?.tenancyId ?? null,
        });
        continue;
      }

      const copy = revealCopy(due.key, {
        orgName: org.name,
        propertyAddress: firstAddress.get(org.id) ?? null,
      });

      const result = await deps.sendNotificationEmail({
        to_email: to,
        subject: copy.subject,
        body: copy.body,
        action_label: copy.ctaLabel,
        action_url: `${deps.env.NEXT_PUBLIC_APP_URL || DEFAULT_APP_URL}${copy.ctaPath}`,
        org_name: org.name,
        brand_color: org.brand_color,
        logo_url: org.logo_url,
        reply_to_email: org.reply_to_email,
      });

      if (!result.sent) {
        summary.errors++;
        summary.details.push({ org: org.id, reveal: due.key, error: result.reason });
        continue;
      }

      // Advance the watermark to the resolved index (skip-owned aware) + stamp.
      const { error: stampErr } = await admin
        .from("organizations")
        .update({
          landlord_campaign_step_sent: due.index + 1,
          landlord_campaign_last_sent_at: new Date(nowMs).toISOString(),
        })
        .eq("id", org.id);

      if (stampErr) {
        summary.errors++;
        summary.details.push({ org: org.id, reveal: due.key, error: `stamp_failed:${stampErr.message}` });
        continue;
      }

      summary.sent++;
      summary.details.push({ org: org.id, reveal: due.key, step: due.index + 1, to });
    } catch (err) {
      summary.errors++;
      summary.details.push({
        org: org.id,
        error: `row_threw:${err instanceof Error ? err.message : "unknown"}`,
      });
    }
  }

  return NextResponse.json(summary, { status: 200 });
}

export async function GET(req: NextRequest, maybeDeps?: unknown) {
  return runLandlordCampaign(
    req,
    isCampaignDeps(maybeDeps) ? maybeDeps : defaultDeps,
  );
}
