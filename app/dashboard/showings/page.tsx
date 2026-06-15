import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { OutcomeSelect } from "./outcome-select";

export const dynamic = "force-dynamic";

type ShowingRow = {
  id: string;
  scheduled_at: string | null;
  outcome: string;
  lead: { id: string; name: string | null; email: string | null } | null;
  property: { id: string; address: string } | null;
};

// Format in the org's booking timezone. Without an explicit timeZone the
// server (UTC on Vercel) renders the wrong wall-clock time.
function fmt(iso: string | null, timeZone: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export default async function ShowingsPage() {
  const supabase = createClient();
  const org = await getCurrentOrg();
  const timeZone = org?.booking_timezone ?? "America/Toronto";
  const { data } = await supabase
    .from("showings")
    .select(
      "id, scheduled_at, outcome, lead:leads(id, name, email), property:properties(id, address)",
    )
    .order("scheduled_at", { ascending: true });

  const all = (data ?? []) as unknown as ShowingRow[];
  const now = Date.now();
  const upcoming = all.filter(
    (s) =>
      s.outcome === "scheduled" &&
      s.scheduled_at != null &&
      new Date(s.scheduled_at).getTime() >= now,
  );
  const past = all
    .filter((s) => !upcoming.includes(s))
    .sort(
      (a, b) =>
        new Date(b.scheduled_at ?? 0).getTime() -
        new Date(a.scheduled_at ?? 0).getTime(),
    );

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900">Showings</h2>
      <p className="mt-1 text-sm text-gray-500">
        Self-booked and scheduled viewings. Mark the outcome after each one to
        keep the pipeline accurate.
      </p>

      <Section title={`Upcoming (${upcoming.length})`} rows={upcoming} empty="No upcoming showings." timeZone={timeZone} />
      <Section title="Past" rows={past} empty="No past showings yet." timeZone={timeZone} />
    </div>
  );
}

function Section({
  title,
  rows,
  empty,
  timeZone,
}: {
  title: string;
  rows: ShowingRow[];
  empty: string;
  timeZone: string;
}) {
  return (
    <>
      <h3 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wider text-gray-500">
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-6 text-center text-sm text-gray-500">
          {empty}
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          {rows.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">
                  {fmt(s.scheduled_at, timeZone)}
                </p>
                <p className="truncate text-xs text-gray-500">
                  {s.lead ? (
                    <Link
                      href={`/dashboard/leads/${s.lead.id}`}
                      className="text-brand hover:underline"
                    >
                      {s.lead.name || s.lead.email || "Lead"}
                    </Link>
                  ) : (
                    "—"
                  )}
                  {s.property ? ` · ${s.property.address}` : ""}
                </p>
              </div>
              <OutcomeSelect showingId={s.id} outcome={s.outcome} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
