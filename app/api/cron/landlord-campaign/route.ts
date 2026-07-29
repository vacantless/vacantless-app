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
  nextRevealDue,
  revealCopy,
  resolveLandlordCampaignRecipient,
  CAMPAIGN_STEPS,
  CAMPAIGN_MAX_AGE_DAYS,
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

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://vacantless-app.vercel.app";
const DAY_MS = 24 * 3_600_000;

type Summary = {
  ok: boolean;
  reason?: string;
  scanned: number;
  sent: number;
  skipped: number;
  errors: number;
  details: Array<Record<string, unknown>>;
};

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  return req.nextUrl.searchParams.get("secret") === secret;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  // Dark switch: the whole campaign is off until the flag is set.
  if (!envFlagEnabled(process.env.LANDLORD_CAMPAIGN_ENABLED)) {
    return NextResponse.json(
      { ok: true, reason: "disabled", scanned: 0, sent: 0, skipped: 0, errors: 0, details: [] } satisfies Summary,
      { status: 200 },
    );
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { ok: false, reason: "service_role_not_configured", scanned: 0, sent: 0, skipped: 0, errors: 0, details: [] } satisfies Summary,
      { status: 200 },
    );
  }

  const nowMs = Date.now();
  const guideline = await loadGuidelineLookup(admin);
  const leaseTermShiftOn = leaseTermShiftEnabled();
  const oldestIso = new Date(nowMs - CAMPAIGN_MAX_AGE_DAYS * DAY_MS).toISOString();

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
      { ok: false, reason: `query_error:${orgErr.message}`, scanned: 0, sent: 0, skipped: 0, errors: 1, details: [] } satisfies Summary,
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
  const summary: Summary = { ok: true, scanned: orgs.length, sent: 0, skipped: 0, errors: 0, details: [] };

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
      { ok: false, reason: `query_error:${message}`, scanned: orgs.length, sent: 0, skipped: 0, errors: 1, details: [] } satisfies Summary,
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
          { env: process.env },
        )
      ) {
        summary.skipped++;
        summary.details.push({ org: org.id, skipped: "feature_disabled" });
        continue;
      }

      const due = nextRevealDue({
        campaignStartMs: org.created_at ? new Date(org.created_at).getTime() : null,
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

      if (!due) {
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
        summary.details.push({ org: org.id, skipped: "no_landlord_email", reveal: due.key });
        continue;
      }

      if (due.key === "rent_increase_confirm") {
        const { data: rentConfirmRows, error: rentConfirmErr } = await admin
          .from("tenancies")
          .select("id, property_id, rent_cents, confirm_token, start_date, last_rent_increase_date")
          .eq("organization_id", org.id)
          .eq("status", "active");

        if (rentConfirmErr) {
          summary.errors++;
          summary.details.push({
            org: org.id,
            reveal: due.key,
            error: `rent_confirm_tenancies_failed:${rentConfirmErr.message}`,
          });
          continue;
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
            summary.errors++;
            summary.details.push({
              org: org.id,
              reveal: due.key,
              error: `rent_confirm_properties_failed:${addressErr.message}`,
            });
            continue;
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
            summary.errors++;
            summary.details.push({
              org: org.id,
              reveal: due.key,
              error: `rent_confirm_ledger_failed:${confirmedErr.message}`,
            });
            continue;
          }
          if (baselineErr) {
            summary.errors++;
            summary.details.push({
              org: org.id,
              reveal: due.key,
              error: `rent_confirm_baseline_failed:${baselineErr.message}`,
            });
            continue;
          }
          for (const row of (confirmedRows ?? []) as { tenancy_id: string | null }[]) {
            if (row.tenancy_id) confirmedTenancyIds.add(row.tenancy_id);
          }
          for (const row of (baselineRows ?? []) as { tenancy_id: string | null }[]) {
            if (row.tenancy_id) baselineConfirmedTenancyIds.add(row.tenancy_id);
          }
        }

        const units = buildRentConfirmUnits({
          tenancies: rawTenancies.flatMap((row) =>
            row.id && row.confirm_token
              ? [
                  {
                    id: row.id,
                    address: row.property_id
                      ? addressByPropertyId.get(row.property_id) ?? null
                      : null,
                    rentCents: row.rent_cents,
                    confirmToken: row.confirm_token,
                  },
                ]
              : [],
          ),
          confirmedTenancyIds,
          urlFor: rentConfirmUrl,
        });

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

        const unitByTenancyId = new Map(units.map((unit) => [unit.tenancyId, unit]));
        const today = localDateString(nowMs, org.booking_timezone || "America/Toronto");
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

        const result = await sendLandlordRentConfirmEmail({
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
            landlord_campaign_last_sent_at: new Date().toISOString(),
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

      const result = await sendNotificationEmail({
        to_email: to,
        subject: copy.subject,
        body: copy.body,
        action_label: copy.ctaLabel,
        action_url: `${APP_URL}${copy.ctaPath}`,
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
          landlord_campaign_last_sent_at: new Date().toISOString(),
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
