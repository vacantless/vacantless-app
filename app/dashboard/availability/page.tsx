import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { WEEKDAY_LABELS, minutesToLabel } from "@/lib/booking";
import {
  updateBookingSettings,
  addAvailabilityWindow,
  deleteAvailabilityWindow,
} from "./actions";

export const dynamic = "force-dynamic";

type Rule = {
  id: string;
  weekday: number;
  start_minute: number;
  end_minute: number;
};

type OrgBooking = {
  booking_timezone: string;
  booking_slot_minutes: number;
  booking_lead_hours: number;
  booking_horizon_days: number;
};

const TIMEZONES = [
  "America/Toronto",
  "America/Vancouver",
  "America/Edmonton",
  "America/Winnipeg",
  "America/Halifax",
  "America/St_Johns",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
];

export default async function AvailabilityPage() {
  const org = await getCurrentOrg();
  const supabase = createClient();

  const [{ data: orgRow }, { data: rulesData }] = await Promise.all([
    supabase
      .from("organizations")
      .select(
        "booking_timezone, booking_slot_minutes, booking_lead_hours, booking_horizon_days",
      )
      .eq("id", org?.id ?? "")
      .maybeSingle(),
    supabase
      .from("availability_rules")
      .select("id, weekday, start_minute, end_minute")
      .order("weekday")
      .order("start_minute"),
  ]);

  const cfg = (orgRow as OrgBooking) ?? {
    booking_timezone: "America/Toronto",
    booking_slot_minutes: 30,
    booking_lead_hours: 12,
    booking_horizon_days: 14,
  };
  const rules = (rulesData ?? []) as Rule[];

  const byDay = new Map<number, Rule[]>();
  for (const r of rules) {
    const list = byDay.get(r.weekday) ?? [];
    list.push(r);
    byDay.set(r.weekday, list);
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900">Showing times</h2>
      <p className="mt-1 text-sm text-gray-500">
        Set the weekly windows when renters can self-book showings. Open slots
        are generated from these times minus anything already booked.
      </p>

      {/* Booking settings */}
      <form
        action={updateBookingSettings}
        className="mt-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
      >
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">
          Booking settings
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">
              Timezone
            </span>
            <select
              name="timezone"
              defaultValue={cfg.booking_timezone}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">
              Slot length
            </span>
            <select
              name="slot_minutes"
              defaultValue={String(cfg.booking_slot_minutes)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              {[15, 20, 30, 45, 60].map((m) => (
                <option key={m} value={m}>
                  {m} minutes
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">
              Minimum notice (hours)
            </span>
            <input
              name="lead_hours"
              type="number"
              min={0}
              max={168}
              defaultValue={cfg.booking_lead_hours}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">
              How far ahead to book (days)
            </span>
            <input
              name="horizon_days"
              type="number"
              min={1}
              max={60}
              defaultValue={cfg.booking_horizon_days}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
        </div>
        <div className="mt-4 text-right">
          <button className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white">
            Save settings
          </button>
        </div>
      </form>

      {/* Weekly windows */}
      <div className="mt-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
          Weekly windows
        </h3>
        <p className="mb-3 mt-1 text-sm text-gray-500">
          These are the windows renters can choose from. Times that are already
          booked are removed automatically.
        </p>

        {rules.length === 0 && (
          <div className="mb-4 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-600">
            No windows yet — add your first below so renters can self-book a
            showing.
          </div>
        )}

        <div className="space-y-2">
          {WEEKDAY_LABELS.map((label, wd) => {
            const dayRules = byDay.get(wd) ?? [];
            return (
              <div
                key={wd}
                className="flex flex-wrap items-center gap-2 border-b border-gray-100 py-2 last:border-0"
              >
                <span className="w-24 text-sm font-medium text-gray-700">
                  {label}
                </span>
                {dayRules.length === 0 ? (
                  <span className="text-sm text-gray-400">Unavailable</span>
                ) : (
                  dayRules.map((r) => (
                    <form
                      key={r.id}
                      action={deleteAvailabilityWindow}
                      className="inline-flex"
                    >
                      <input type="hidden" name="id" value={r.id} />
                      <button
                        title="Remove this window"
                        className="group inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-sm text-gray-700 hover:border-red-300 hover:bg-red-50"
                      >
                        {minutesToLabel(r.start_minute)} –{" "}
                        {minutesToLabel(r.end_minute)}
                        <span className="text-gray-400 group-hover:text-red-500">
                          ✕
                        </span>
                      </button>
                    </form>
                  ))
                )}
              </div>
            );
          })}
        </div>

        {/* Add window */}
        <form
          action={addAvailabilityWindow}
          className="mt-4 flex flex-wrap items-end gap-3 border-t border-gray-100 pt-4"
        >
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">
              Day
            </span>
            <select
              name="weekday"
              defaultValue="1"
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              {WEEKDAY_LABELS.map((label, wd) => (
                <option key={wd} value={wd}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">
              From
            </span>
            <input
              name="start"
              type="time"
              required
              defaultValue="10:00"
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">
              To
            </span>
            <input
              name="end"
              type="time"
              required
              defaultValue="17:00"
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          <button className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white">
            Add window
          </button>
        </form>
      </div>
    </div>
  );
}
