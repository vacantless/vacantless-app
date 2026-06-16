import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { propertyStatusLabel } from "@/lib/pipeline";
import {
  buildFunnel,
  buildChannelReport,
  buildPropertyReport,
  buildShowingReport,
  buildLeaseTiming,
  buildFeedbackReport,
  parseWindow,
  windowStartMs,
  filterByWindow,
  WINDOW_OPTIONS,
  type LeadLite,
  type ShowingLite,
  type PropertyLite,
  type FeedbackLite,
} from "@/lib/reports";

export const dynamic = "force-dynamic";

function rent(cents: number | null): string {
  if (cents == null) return "—";
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: { days?: string };
}) {
  const supabase = createClient();
  const window = parseWindow(searchParams.days);
  const nowMs = Date.now();
  const startMs = windowStartMs(window, nowMs);

  // RLS scopes every query to the caller's org.
  const [
    { data: leadsData },
    { data: showingsData },
    { data: propsData },
    { data: feedbackData },
  ] = await Promise.all([
    supabase
      .from("leads")
      .select("id, source, status, created_at, leased_date, property_id"),
    supabase
      .from("showings")
      .select("id, outcome, scheduled_at, created_at, property_id"),
    supabase
      .from("properties")
      .select("id, address, status, rent_cents, created_at"),
    supabase.from("feedback").select("rating, created_at"),
  ]);

  const allLeads = (leadsData ?? []) as LeadLite[];
  const allShowings = (showingsData ?? []) as ShowingLite[];
  const properties = (propsData ?? []) as PropertyLite[];
  const allFeedback = (feedbackData ?? []) as FeedbackLite[];

  // Window the activity (leads + showings + feedback) by when it happened; the
  // property catalog itself isn't windowed — we report each property's activity
  // within the selected window.
  const leads = filterByWindow(allLeads, startMs);
  const showings = filterByWindow(allShowings, startMs);
  const feedback = filterByWindow(allFeedback, startMs);

  const funnel = buildFunnel(leads);
  const channels = buildChannelReport(leads);
  const propertyRows = buildPropertyReport(properties, leads, showings);
  const showRep = buildShowingReport(showings, nowMs);
  const timing = buildLeaseTiming(leads);
  const feedbackRep = buildFeedbackReport(feedback);

  const leasedStep = funnel[funnel.length - 1];

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-xl font-bold text-gray-900">Reports</h2>
        <div className="flex flex-wrap gap-1.5">
          {WINDOW_OPTIONS.map((opt) => {
            const active = opt.value === window;
            return (
              <Link
                key={String(opt.value)}
                href={`/dashboard/reports?days=${opt.value}`}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
                  active
                    ? "border-transparent bg-brand text-white"
                    : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                }`}
                style={
                  active ? { backgroundColor: "var(--brand-color)" } : undefined
                }
              >
                {opt.label}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Headline KPIs */}
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Inquiries" value={funnel[0].count} />
        <Kpi
          label="Leased"
          value={leasedStep.count}
          sub={`${leasedStep.ofTotal}% of inquiries`}
        />
        <Kpi
          label="Showing attendance"
          value={`${showRep.attendanceRate}%`}
          sub={`${showRep.attended} of ${showRep.attended + showRep.noShow} kept`}
        />
        <Kpi
          label="Avg days to lease"
          value={timing.avgDays == null ? "—" : String(timing.avgDays)}
          sub={
            timing.avgDays == null
              ? "no dated leases yet"
              : `${timing.withDate} lease${timing.withDate === 1 ? "" : "s"}`
          }
        />
      </div>

      {/* Funnel */}
      <Section
        title="Inquiry to lease"
        subtitle="Each inquiry is counted at the furthest stage it reached. Booked means the inquiry got to the Booked stage (whether it self-booked online or you moved it there), not the number of showings on your calendar. For actual showings, see the Showings section below."
      >
        {funnel[0].count === 0 ? (
          <Empty>
            Not enough data yet. This fills in as inquiries come in during this
            window.
          </Empty>
        ) : (
          <div className="space-y-2">
            {funnel.map((step, i) => {
              const widthPct = funnel[0].count
                ? Math.max(4, Math.round((step.count / funnel[0].count) * 100))
                : 0;
              return (
                <div key={step.key} className="flex items-center gap-3">
                  <div className="w-20 shrink-0 text-right text-sm font-medium text-gray-600">
                    {step.label}
                  </div>
                  <div className="relative h-8 flex-1 overflow-hidden rounded-md bg-gray-100">
                    <div
                      className="h-full rounded-md"
                      style={{
                        width: `${widthPct}%`,
                        backgroundColor: "var(--brand-color)",
                        opacity: 1 - i * 0.13,
                      }}
                    />
                    <div className="absolute inset-0 flex items-center px-3 text-sm font-semibold text-gray-800">
                      {step.count}
                      <span className="ml-2 text-xs font-normal text-gray-500">
                        {step.ofTotal}% of inquiries
                        {i > 0 && ` · ${step.ofPrev}% of ${funnel[i - 1].label}`}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* By channel */}
      <Section
        title="Where renters come from"
        subtitle="Booked, Showed and Leased here count inquiries that reached each stage, by advertising source."
      >
        {channels.length === 0 ? (
          <Empty>
            Not enough data yet. This appears once inquiries arrive in this
            window.
          </Empty>
        ) : (
          <Table head={["Source", "Inquiries", "Booked", "Showed", "Leased", "Lease rate"]}>
            {channels.map((c) => (
              <tr key={c.source} className="border-t border-gray-100">
                <Td>{c.source}</Td>
                <Td num>{c.leads}</Td>
                <Td num>{c.booked}</Td>
                <Td num>{c.showed}</Td>
                <Td num>{c.leased}</Td>
                <Td num>{c.leaseRate}%</Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      {/* By rental */}
      <Section
        title="By rental"
        subtitle="Showings counts actual showings on the calendar; Booked and Leased count inquiries that reached that stage."
      >
        {propertyRows.length === 0 ? (
          <Empty>
            No rentals yet. Add a rental to start tracking per-rental
            performance.
          </Empty>
        ) : (
          <Table
            head={["Rental", "Rent", "Status", "Inquiries", "Showings", "Booked", "Leased"]}
          >
            {propertyRows.map((p) => (
              <tr key={p.id} className="border-t border-gray-100">
                <Td>
                  <Link
                    href={`/dashboard/properties/${p.id}`}
                    className="font-medium text-gray-900 hover:underline"
                  >
                    {p.address}
                  </Link>
                </Td>
                <Td>{rent(p.rentCents)}</Td>
                <Td>{propertyStatusLabel(p.status)}</Td>
                <Td num>{p.leads}</Td>
                <Td num>{p.showings}</Td>
                <Td num>{p.booked}</Td>
                <Td num>{p.leased}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      {/* Showings */}
      <Section
        title="Showings"
        subtitle="Actual showings on your calendar (booked online by renters or scheduled by you), and how they turned out."
      >
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <Kpi label="Total" value={showRep.total} />
          <Kpi label="Attended" value={showRep.attended} />
          <Kpi label="No-show" value={showRep.noShow} />
          <Kpi label="Cancelled" value={showRep.cancelled} />
          <Kpi label="Upcoming" value={showRep.upcoming} />
          <Kpi label="Attendance" value={`${showRep.attendanceRate}%`} />
        </div>
      </Section>

      {/* Feedback */}
      <Section title="Renter feedback">
        {feedbackRep.responses === 0 ? (
          <Empty>
            No feedback yet. Requests go out automatically after a showing is
            marked Attended (configurable in Settings).
          </Empty>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Kpi
              label="Avg rating"
              value={feedbackRep.avgRating == null ? "—" : `${feedbackRep.avgRating}★`}
            />
            <Kpi label="Responses" value={feedbackRep.responses} />
            {([5, 4, 3, 2, 1] as const).map((star) => (
              <Kpi
                key={star}
                label={`${star}★`}
                value={feedbackRep.distribution[star - 1]}
              />
            ))}
          </div>
        )}
      </Section>

      <p className="mt-2 text-xs text-gray-400">
        Activity counted by when it happened, within the selected window.
        Inquiry and source counts reflect each inquiry&apos;s furthest stage
        reached; lost inquiries count toward total inquiries only. &ldquo;Booked&rdquo;
        in those counts is a pipeline stage, not a calendar showing. The
        Showings section is the count of actual showings.
      </p>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      <div className="mt-0.5 text-sm text-gray-500">{label}</div>
      {sub && <div className="mt-0.5 text-xs text-gray-400">{sub}</div>}
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <h3 className="mb-1 text-sm font-semibold uppercase tracking-wider text-gray-500">
        {title}
      </h3>
      {subtitle && <p className="mb-3 text-xs text-gray-500">{subtitle}</p>}
      {!subtitle && <div className="mb-3" />}
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-6 text-center text-sm text-gray-500">
      {children}
    </p>
  );
}

function Table({
  head,
  children,
}: {
  head: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-gray-400">
            {head.map((h, i) => (
              <th
                key={h}
                className={`px-4 py-2.5 font-medium ${i === 0 ? "" : "text-right"}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Td({
  children,
  num,
}: {
  children: React.ReactNode;
  num?: boolean;
}) {
  return (
    <td
      className={`px-4 py-2.5 text-gray-700 ${num ? "text-right tabular-nums" : ""}`}
    >
      {children}
    </td>
  );
}
