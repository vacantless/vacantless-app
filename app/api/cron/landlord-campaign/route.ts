import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  sendLandlordRentConfirmEmail,
  sendNotificationEmail,
} from "@/lib/email";
import { hasEntitlement } from "@/lib/billing";
import { rentConfirmUrl } from "@/lib/rent-confirm-public";
import {
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
  if (!process.env.LANDLORD_CAMPAIGN_ENABLED) {
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
  const oldestIso = new Date(nowMs - CAMPAIGN_MAX_AGE_DAYS * DAY_MS).toISOString();

  // Candidate orgs: free plan, not opted out, not finished, still fresh.
  const { data: orgData, error: orgErr } = await admin
    .from("organizations")
    .select(
      "id, name, brand_color, logo_url, reply_to_email, public_contact_email, plan, created_at, landlord_campaign_step_sent, landlord_campaign_last_sent_at, landlord_campaign_opted_out, landlord_campaign_email",
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
    plan: string | null;
    created_at: string | null;
    landlord_campaign_step_sent: number | null;
    landlord_campaign_last_sent_at: string | null;
    landlord_campaign_email: string | null;
  }>;
  const summary: Summary = { ok: true, scanned: orgs.length, sent: 0, skipped: 0, errors: 0, details: [] };

  if (orgs.length === 0) return NextResponse.json(summary, { status: 200 });

  const orgIds = orgs.map((o) => o.id);

  // Which candidate orgs have a tenancy (a real landlord), and one property
  // address each (for reveal copy). Both RLS-bypassing service-role reads,
  // scoped to the candidate set.
  const [{ data: tenancyRows }, { data: propRows }] = await Promise.all([
    admin.from("tenancies").select("organization_id").in("organization_id", orgIds),
    admin.from("properties").select("organization_id, address").in("organization_id", orgIds),
  ]);
  const orgsWithTenancy = new Set<string>();
  for (const r of (tenancyRows ?? []) as { organization_id: string | null }[]) {
    if (r.organization_id) orgsWithTenancy.add(r.organization_id);
  }
  const firstAddress = new Map<string, string>();
  for (const r of (propRows ?? []) as { organization_id: string | null; address: string | null }[]) {
    if (r.organization_id && r.address && !firstAddress.has(r.organization_id)) {
      firstAddress.set(r.organization_id, r.address);
    }
  }

  for (const org of orgs) {
    try {
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
        hasRentCollection: hasEntitlement(org.plan, "rent_collection"),
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
          .select("id, property_id, rent_cents, confirm_token")
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
        }>;
        const tenancyIds = rawTenancies.flatMap((row) => (row.id ? [row.id] : []));
        const propertyIds = Array.from(
          new Set(rawTenancies.flatMap((row) => (row.property_id ? [row.property_id] : []))),
        );
        const addressByPropertyId = new Map<string, string | null>();
        if (propertyIds.length > 0) {
          const { data: addressRows, error: addressErr } = await admin
            .from("properties")
            .select("id, address")
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
          }>) {
            if (row.id) addressByPropertyId.set(row.id, row.address);
          }
        }

        const confirmedTenancyIds = new Set<string>();
        if (tenancyIds.length > 0) {
          const { data: confirmedRows, error: confirmedErr } = await admin
            .from("tenancy_rent_adjustments")
            .select("tenancy_id")
            .eq("organization_id", org.id)
            .eq("source", "landlord_confirm")
            .in("tenancy_id", tenancyIds);
          if (confirmedErr) {
            summary.errors++;
            summary.details.push({
              org: org.id,
              reveal: due.key,
              error: `rent_confirm_ledger_failed:${confirmedErr.message}`,
            });
            continue;
          }
          for (const row of (confirmedRows ?? []) as { tenancy_id: string | null }[]) {
            if (row.tenancy_id) confirmedTenancyIds.add(row.tenancy_id);
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

        const result = await sendLandlordRentConfirmEmail({
          to_email: to,
          org_name: org.name,
          brand_color: org.brand_color,
          logo_url: org.logo_url,
          reply_to_email: org.reply_to_email,
          units,
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
