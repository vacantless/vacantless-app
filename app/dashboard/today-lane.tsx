import Link from "next/link";
import { Icons } from "@/components/icons";
import type { TodayItem } from "@/lib/dashboard-today";

// TodayLane — the action-first lane at the top of the Overview (Codex design
// audit #3, S377). Presentational only; the ordered items come from the pure
// buildTodayLane(). Sits above the stat cards so the operator sees what to DO
// before the vanity numbers. When nothing is actionable it shows a calm
// "all caught up" state instead of disappearing, so the lane is a stable focal
// point at the top of the page.

const ICON: Record<string, React.ReactNode> = {
  inquiries: <Icons.chat className="h-5 w-5" />,
  viewings: <Icons.calendar className="h-5 w-5" />,
  messages: <Icons.mail className="h-5 w-5" />,
  "rent-increases": <Icons.card className="h-5 w-5" />,
  "work-orders": <Icons.bolt className="h-5 w-5" />,
};

export function TodayLane({ items }: { items: TodayItem[] }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">
        Today
      </h2>

      {items.length === 0 ? (
        <div className="flex items-center gap-3.5 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-green-50 text-green-600 ring-1 ring-inset ring-green-100">
            <Icons.check className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="font-semibold text-gray-900">You&apos;re all caught up</p>
            <p className="mt-0.5 text-sm text-gray-500">
              Nothing needs you right now. New inquiries and today&apos;s viewings
              will show up here.
            </p>
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          {items.map((item) => {
            const urgent = item.tone === "urgent";
            return (
              <li key={item.key}>
                <Link
                  href={item.href}
                  className="group flex items-center gap-3.5 px-5 py-4 transition hover:bg-gray-50"
                >
                  <span
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${
                      urgent
                        ? "bg-amber-50 text-amber-700 ring-amber-100"
                        : "bg-brand/[0.06] text-brand ring-brand/10"
                    }`}
                  >
                    {ICON[item.key] ?? <Icons.bolt className="h-5 w-5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-gray-900">{item.label}</p>
                    <p className="mt-0.5 text-sm text-gray-500">{item.detail}</p>
                  </div>
                  <span
                    aria-hidden
                    className="shrink-0 text-gray-300 transition group-hover:text-gray-400"
                  >
                    →
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
