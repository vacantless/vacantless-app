import Link from "next/link";
import { BrandBanner, Card, IconTile } from "@/components/ui";
import { Icons } from "@/components/icons";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { isAtRisk } from "@/lib/reminders";
import { formatMoney } from "@/lib/price-drop";
import { vacancyStripModel } from "@/lib/vacancy-cost";

export const dynamic = "force-dynamic";

// ============================================================================
// Leasing hub (IA Step 1, S274; live counts S528) — the cross-unit "front door"
// for everything about converting an interested renter. It routes into the
// existing pages (Inquiries / Viewings / Availability) and does NOT duplicate
// their lists — but it DOES answer "what needs me right now" with live counts,
// so the page the nav calls "Leasing" is a triage surface, not a launcher.
//
// Counts are read-only (RLS-scoped, id-only selects) and mirror the exact
// definitions the child pages use: "new" inquiries = the Inquiries reply queue;
// unconfirmed = the Viewings at-risk board (agent confirm mode only, via the
// same isAtRisk helper). No writes, no messages, nothing automated here.
// ============================================================================

type Section = {
  href: string;
  title: string;
  desc: string;
  icon: keyof typeof Icons;
  /** Live "needs you" badge (amber when > 0) + quiet context line. */
  badge?: { count: number; label: string } | null;
  context?: string | null;
};

type VacancyPropertyRow = {
  id: string;
  status: string | null;
  rent_cents: number | null;
  available_since: string | null;
};

type LeaseOutcomeRow = {
  days_on_market: number | null;
};

export default async function LeasingHubPage() {
  const supabase = createClient();
  const org = await getCurrentOrg();
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();

  // Reply queue: same definition as the Inquiries page's "new" stage.
  const { count: newLeadCount } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("status", "new");

  // Upcoming scheduled viewings; unconfirmed mirrors the Viewings at-risk board.
  const { data: upcomingRows } = await supabase
    .from("showings")
    .select("id, scheduled_at, confirmed_at, outcome")
    .eq("outcome", "scheduled")
    .gte("scheduled_at", nowIso)
    .order("scheduled_at", { ascending: true })
    .limit(200);
  const upcoming = (upcomingRows ?? []) as {
    id: string;
    scheduled_at: string | null;
    confirmed_at: string | null;
    outcome: string | null;
  }[];
  const confirmMode = org?.showing_confirm_mode === "agent" ? "agent" : "auto";
  const unconfirmedCount =
    confirmMode === "agent"
      ? upcoming.filter((s) =>
          isAtRisk({
            scheduledAtMs: new Date(s.scheduled_at ?? "").getTime(),
            nowMs,
            mode: confirmMode,
            confirmed: s.confirmed_at != null,
            outcome: s.outcome,
          }),
        ).length
      : 0;

  const { data: propertyRows } = await supabase
    .from("properties")
    .select("id, status, rent_cents, available_since")
    .limit(500);
  const vacancyProperties = (propertyRows ?? []) as VacancyPropertyRow[];

  const { data: leaseOutcomeRows } = await supabase
    .from("leased_outcomes")
    .select("days_on_market")
    .order("leased_at", { ascending: false })
    .limit(500);
  const leaseOutcomes = (leaseOutcomeRows ?? []) as LeaseOutcomeRow[];

  const vacancyModel = vacancyStripModel(
    [
      ...vacancyProperties.map((p) => ({
        id: p.id,
        status: p.status,
        rentCents: p.rent_cents,
        availableSince: p.available_since,
      })),
      ...leaseOutcomes.map((o) => ({ daysOnMarket: o.days_on_market })),
    ],
    nowMs,
  );
  const vacancyPortfolio = vacancyModel.portfolio;
  const totalLostLabel = formatMoney(vacancyPortfolio.totalLostCents);

  const newCount = newLeadCount ?? 0;
  const sections: Section[] = [
    {
      href: "/dashboard/leads",
      title: "Inquiries",
      desc: "Every renter inquiry across all your rentals — reply, qualify, and move them through your follow-up list.",
      icon: "chat",
      badge: newCount > 0 ? { count: newCount, label: "to reply to" } : null,
      context: newCount === 0 ? "Nothing waiting for a reply" : null,
    },
    {
      href: "/dashboard/showings",
      title: "Viewings",
      desc: "Booked viewings and their outcomes, across all units.",
      icon: "calendar",
      badge:
        unconfirmedCount > 0
          ? { count: unconfirmedCount, label: "unconfirmed in the next 48h" }
          : null,
      context:
        upcoming.length > 0
          ? `${upcoming.length} upcoming${
              unconfirmedCount === 0 && confirmMode === "agent"
                ? " · all confirmed"
                : ""
            }`
          : "No upcoming viewings",
    },
    {
      href: "/dashboard/availability",
      title: "Viewing Times",
      desc: "Set the viewing times renters can book — this is the setup behind Viewings.",
      icon: "clock",
    },
    {
      // S275 IA Step 3: pre-screening relocated here from Settings — it's a
      // pipeline rule, so it lives where you work inquiries.
      href: "/dashboard/leasing/screening",
      title: "Pre-screening",
      desc: "Add qualifying questions to your inquiry form and auto-flag renters who likely don't fit. You always decide.",
      icon: "users",
    },
    {
      // The leasing FUNNEL report (inquiries -> viewings -> leases, by channel).
      // Money reports (owner statement / rent roll) live under the Money hub.
      href: "/dashboard/reports",
      title: "Reports",
      desc: "Your leasing funnel across all rentals - inquiries, viewings, channels, and how long units take to lease.",
      icon: "chart",
    },
  ];

  const needsYou = newCount + unconfirmedCount;

  // Day-one Leasing hub: the amber Vacancy-ROI panel is the loudest element on
  // the page, but with no available unit and no leased outcome it's a wall of
  // zeros ("0 / Unknown / Not enough history yet"). Show the full panel only
  // once there's real signal; otherwise a slim, quiet hint that keeps it
  // discoverable (fresh-org audit P3).
  const hasVacancyData =
    vacancyPortfolio.vacantUnits > 0 ||
    vacancyPortfolio.timeToLease.sampleSize > 0;

  return (
    <div>
      <BrandBanner
        eyebrow="Leasing"
        title="Convert your inquiries"
        subtitle={
          needsYou > 0
            ? `${needsYou} item${needsYou === 1 ? "" : "s"} need${
                needsYou === 1 ? "s" : ""
              } you right now — new inquiries to answer and viewings to confirm are counted below.`
            : "Nothing needs you right now. Inquiries, viewings, and the times renters can book all live here — open any rental to work a single unit end-to-end."
        }
        icon={<Icons.key className="h-6 w-6" />}
      />

      {!hasVacancyData && (
        <div className="mt-6 flex items-center gap-2.5 rounded-2xl border border-gray-200 bg-white px-5 py-3.5 shadow-sm">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-50 text-gray-400 ring-1 ring-inset ring-gray-100">
            <Icons.chart className="h-4 w-4" />
          </span>
          <p className="text-sm text-gray-600">
            <span className="font-medium text-gray-900">Vacancy ROI</span> tracks
            the rent lost while a unit sits empty. It fills in once you mark a
            rental available.
          </p>
        </div>
      )}

      {hasVacancyData && (
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5">
        <div className="mb-3 flex items-center gap-2.5">
          <IconTile>
            <Icons.chart className="h-5 w-5" />
          </IconTile>
          <div>
            <h2 className="text-sm font-semibold text-gray-900">
              Vacancy ROI
            </h2>
            <p className="text-xs text-amber-800">
              Asking-rent cost is tracked from the day a rental is marked
              available.
            </p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-amber-700">
              Currently vacant
            </p>
            <p className="mt-1 text-2xl font-semibold text-amber-950">
              {vacancyPortfolio.vacantUnits}
            </p>
            {vacancyPortfolio.unknownVacantUnits > 0 && (
              <p className="mt-1 text-xs text-amber-800">
                {vacancyPortfolio.unknownVacantUnits} with unknown start
              </p>
            )}
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-amber-700">
              Lost at asking so far
            </p>
            <p className="mt-1 text-2xl font-semibold text-amber-950">
              {totalLostLabel ?? "Unknown"}
            </p>
            <p className="mt-1 text-xs text-amber-800">
              {totalLostLabel
                ? "Known vacancy days only"
                : "Needs a known vacancy start and rent"}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-amber-700">
              Avg time to lease
            </p>
            <p className="mt-1 text-2xl font-semibold text-amber-950">
              {vacancyPortfolio.timeToLease.averageDays == null
                ? "Not enough history yet"
                : `${vacancyPortfolio.timeToLease.averageDays} days`}
            </p>
            <p className="mt-1 text-xs text-amber-800">
              {vacancyPortfolio.timeToLease.sampleSize === 0
                ? "No known leased outcomes"
                : `${vacancyPortfolio.timeToLease.sampleSize} known leased ${
                    vacancyPortfolio.timeToLease.sampleSize === 1
                      ? "outcome"
                      : "outcomes"
                  }`}
            </p>
          </div>
        </div>
      </div>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {sections.map((s) => {
          const Icon = Icons[s.icon];
          return (
            <Link key={s.href} href={s.href} className="block">
              <Card hover className="h-full">
                <div className="flex items-start gap-3.5">
                  <IconTile>
                    <Icon className="h-5 w-5" />
                  </IconTile>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold text-gray-900">{s.title}</h2>
                      {s.badge && (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">
                          {s.badge.count} {s.badge.label}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-gray-600">
                      {s.desc}
                    </p>
                    {s.context && (
                      <p className="mt-1 text-xs text-gray-400">{s.context}</p>
                    )}
                  </div>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
