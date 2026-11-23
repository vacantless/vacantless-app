// S831: read one rental's records for the monthly report (lib/rental-report.ts).
// Service-role reads, scoped to the rental and its account.
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildRentalReport, type RentalReport, type ReportCost, type ReportLead, type ReportPost, type ReportShowing } from "@/lib/rental-report";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.vacantless.com";

export type ReportProperty = {
  id: string;
  organization_id: string;
  address: string | null;
  rent_cents: number | null;
  available_since: string | null;
  report_next_steps: string | null;
};

export async function loadRentalReport(
  admin: SupabaseClient,
  p: ReportProperty,
  range: { monthStart: string; monthEnd: string },
  today: string,
  orgName: string | null,
  viewingsByRequest = false,
): Promise<RentalReport> {
  const [postsRes, costsRes, wideRes, leadsRes, showRes] = await Promise.all([
    admin.from("listing_posts").select("portal, status, url, created_at").eq("property_id", p.id),
    admin.from("marketing_costs").select("portal, label, amount_cents, spent_on").eq("property_id", p.id),
    admin
      .from("marketing_costs")
      .select("amount_cents")
      .eq("organization_id", p.organization_id)
      .is("property_id", null)
      .gte("spent_on", range.monthStart)
      .lt("spent_on", range.monthEnd),
    admin.from("leads").select("source, created_at").eq("property_id", p.id),
    admin.from("showings").select("scheduled_at, outcome").eq("property_id", p.id).gte("scheduled_at", range.monthStart).lt("scheduled_at", range.monthEnd),
  ]);
  // Renters "to date" count this vacancy: since it became available, else all.
  const since = p.available_since ? p.available_since.slice(0, 10) : null;
  const leads = ((leadsRes.data ?? []) as { source: string | null; created_at: string }[])
    .filter((l) => !since || l.created_at.slice(0, 10) >= since)
    .map<ReportLead>((l) => ({ source: l.source, createdAt: l.created_at }));
  return buildRentalReport({
    address: p.address,
    rentCents: p.rent_cents,
    monthStart: range.monthStart,
    monthEnd: range.monthEnd,
    today,
    availableSince: p.available_since,
    posts: ((postsRes.data ?? []) as { portal: string | null; status: string | null; url: string | null; created_at: string | null }[]).map<ReportPost>(
      (r) => ({ portal: r.portal, status: r.status, url: r.url, createdAt: r.created_at }),
    ),
    costs: ((costsRes.data ?? []) as { portal: string | null; label: string | null; amount_cents: number; spent_on: string }[]).map<ReportCost>(
      (c) => ({ portal: c.portal, label: c.label, amountCents: c.amount_cents, spentOn: c.spent_on }),
    ),
    accountWideMonthCents: ((wideRes.data ?? []) as { amount_cents: number }[]).reduce((s, c) => s + c.amount_cents, 0),
    leads,
    showings: ((showRes.data ?? []) as { scheduled_at: string; outcome: string | null }[]).map<ReportShowing>(
      (s) => ({ scheduledAt: s.scheduled_at, outcome: s.outcome }),
    ),
    nextSteps: p.report_next_steps,
    rentalUrl: `${APP_URL}/dashboard/properties/${p.id}`,
    pageUrl: `${APP_URL}/r/${p.id}`,
    viewingsByRequest,
    orgName,
  });
}
