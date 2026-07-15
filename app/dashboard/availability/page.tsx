import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { WEEKDAY_LABELS, minutesToLabel, previewSlotStarts } from "@/lib/booking";
import {
  updateBookingSettings,
  updateClusteringSettings,
  addAvailabilityWindow,
  deleteAvailabilityWindow,
  addDayOff,
  removeDayOff,
  addAvailabilityOverride,
  removeAvailabilityOverride,
} from "./actions";
import { BrandBanner } from "@/components/ui";
import { Icons } from "@/components/icons";

export const dynamic = "force-dynamic";

type Rule = {
  id: string;
  weekday: number;
  start_minute: number;
  end_minute: number;
};

type Override = {
  id: string;
  day: string;
  start_minute: number;
  end_minute: number;
};

type OrgBooking = {
  booking_timezone: string;
  booking_slot_minutes: number;
  booking_lead_hours: number;
  booking_horizon_days: number;
  booking_requires_confirmation: boolean;
  clustering_enabled: boolean;
  clustering_buffer_minutes: number;
  showing_block_capacity: number;
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

const SAVED_MESSAGES: Record<string, string> = {
  settings: "Booking settings saved.",
  cluster: "Grouping settings saved.",
  window: "Viewing window added.",
  dayoff: "Day off added.",
  override: "Specific-date hours added.",
};

const ERROR_MESSAGES: Record<string, string> = {
  window_invalid: "The end time has to be after the start time.",
  dayoff_invalid: "Pick a valid date, today or later.",
  override_invalid: "Pick a valid date and custom hours where the end is after the start.",
};

export default async function AvailabilityPage({
  searchParams,
}: {
  searchParams: { saved?: string; error?: string; forbidden?: string };
}) {
  const org = await getCurrentOrg();
  const supabase = createClient();

  const savedMessage = searchParams.saved
    ? SAVED_MESSAGES[searchParams.saved]
    : null;
  const errorMessage = searchParams.error
    ? ERROR_MESSAGES[searchParams.error]
    : null;

  const [
    { data: orgRow },
    { data: rulesData },
    { data: daysOffData },
    { data: overridesData },
  ] =
    await Promise.all([
      supabase
        .from("organizations")
        .select(
          "booking_timezone, booking_slot_minutes, booking_lead_hours, booking_horizon_days, booking_requires_confirmation, clustering_enabled, clustering_buffer_minutes, showing_block_capacity",
        )
        .eq("id", org?.id ?? "")
        .maybeSingle(),
      supabase
        .from("availability_rules")
        .select("id, weekday, start_minute, end_minute")
        .order("weekday")
        .order("start_minute"),
      supabase
        .from("availability_days_off")
        .select("id, day")
        .order("day"),
      supabase
        .from("availability_overrides")
        .select("id, day, start_minute, end_minute")
        .order("day")
        .order("start_minute"),
    ]);

  const cfg = (orgRow as OrgBooking) ?? {
    booking_timezone: "America/Toronto",
    booking_slot_minutes: 30,
    booking_lead_hours: 12,
    booking_horizon_days: 14,
    booking_requires_confirmation: false,
    clustering_enabled: false,
    clustering_buffer_minutes: 60,
    showing_block_capacity: 6,
  };
  const rules = (rulesData ?? []) as Rule[];

  // Days off (date-specific blackouts). Only show today-or-later dates in the
  // org timezone; a passed blackout is history and can't affect a bookable day.
  const todayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: cfg.booking_timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const daysOff = ((daysOffData ?? []) as { id: string; day: string }[]).filter(
    (d) => d.day >= todayKey,
  );
  const overrides = ((overridesData ?? []) as Override[]).filter(
    (d) => d.day >= todayKey,
  );
  const fmtSpecificDate = (day: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(`${day}T00:00:00Z`));
  const specificDates = [
    ...daysOff.map((d) => ({
      id: d.id,
      day: d.day,
      kind: "day_off" as const,
      sort: `${d.day}|0|${d.id}`,
    })),
    ...overrides.map((o) => ({
      ...o,
      kind: "override" as const,
      sort: `${o.day}|1|${String(o.start_minute).padStart(4, "0")}|${o.id}`,
    })),
  ].sort((a, b) => a.sort.localeCompare(b.sort));

  const byDay = new Map<number, Rule[]>();
  for (const r of rules) {
    const list = byDay.get(r.weekday) ?? [];
    list.push(r);
    byDay.set(r.weekday, list);
  }

  // Renter preview: take the earliest window of the first day that has one and
  // show the bookable start times it generates at the current slot length, so
  // the operator sees exactly what a renter chooses from. Already-booked times
  // are hidden live; this static preview shows the full set from the window.
  const previewRule = rules.length > 0 ? rules[0] : null;
  const previewStarts = previewRule
    ? previewSlotStarts(
        previewRule.start_minute,
        previewRule.end_minute,
        cfg.booking_slot_minutes,
      )
    : [];
  const PREVIEW_MAX = 10;

  // Short labels for the at-a-glance grid headers (Sun..Sat).
  const shortDays = WEEKDAY_LABELS.map((l) => l.slice(0, 3));

  return (
    <div>
      <BrandBanner
        icon={<Icons.clock />}
        eyebrow="Scheduling"
        title="Viewing Times"
        subtitle="Set the weekly windows when renters can book their own viewings. Open slots are generated from these times minus anything already booked."
      />

      {savedMessage && (
        <p className="mb-6 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
          {savedMessage}
        </p>
      )}
      {errorMessage && (
        <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          {errorMessage}
        </p>
      )}
      {searchParams.forbidden && (
        <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          You don&rsquo;t have permission to change viewing times. Ask an account
          admin to update these.
        </p>
      )}

      <p className="mb-6 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
        These windows apply to <strong>all of your rentals</strong>, so you keep
        one viewing schedule instead of setting times per unit. To keep visits to
        the same building together on a given day, turn on &ldquo;Group viewings
        by building&rdquo; below.
      </p>

      {/* Booking settings */}
      <form
        action={updateBookingSettings}
        className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
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
        <label className="mt-4 flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-3">
          <input
            type="checkbox"
            name="booking_requires_confirmation"
            defaultChecked={cfg.booking_requires_confirmation}
            className="mt-0.5 h-4 w-4 rounded border-gray-300"
          />
          <span>
            <span className="block text-sm font-medium text-gray-700">
              Agent confirms viewings before they happen
            </span>
            <span className="mt-1 block text-sm text-gray-500">
              Renters are told someone will reach out to confirm before the
              viewing.
            </span>
          </span>
        </label>
        <div className="mt-4 text-right">
          <button className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white">
            Save settings
          </button>
        </div>
      </form>

      {/* Group showings by building (Hero blocks) */}
      <form
        action={updateClusteringSettings}
        className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
      >
        <h3 className="mb-1 text-sm font-semibold uppercase tracking-wider text-gray-500">
          Group viewings by building
        </h3>
        <p className="mb-4 text-sm text-gray-500">
          When on, the booking page steers new renters toward times near the
          viewings already booked at the same building, so visits stay grouped
          per building per day and you spend less time travelling between them.
          Buildings are matched by street address. Days with no viewing yet stay
          fully open.
        </p>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            name="clustering_enabled"
            defaultChecked={cfg.clustering_enabled}
            className="mt-0.5 h-4 w-4 rounded border-gray-300"
          />
          <span className="text-sm font-medium text-gray-700">
            Group new viewings around existing ones at the same building
          </span>
        </label>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">
              How far around a booked viewing to offer times (minutes)
            </span>
            <input
              name="clustering_buffer_minutes"
              type="number"
              min={0}
              max={480}
              defaultValue={cfg.clustering_buffer_minutes}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">
              Max viewings per building per day
            </span>
            <input
              name="showing_block_capacity"
              type="number"
              min={1}
              max={50}
              defaultValue={cfg.showing_block_capacity}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
        </div>
        <div className="mt-4 text-right">
          <button className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white">
            Save
          </button>
        </div>
      </form>

      {/* Week at a glance + renter preview */}
      <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
          Your week at a glance
        </h3>
        <p className="mb-4 mt-1 text-sm text-gray-500">
          A quick visual of when renters can book across the week. Edit the
          windows below.
        </p>

        <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
          {WEEKDAY_LABELS.map((label, wd) => {
            const dayRules = byDay.get(wd) ?? [];
            const open = dayRules.length > 0;
            return (
              <div key={wd} className="flex flex-col">
                <div className="mb-1 text-center text-xs font-semibold text-gray-500">
                  <span className="sm:hidden">{shortDays[wd][0]}</span>
                  <span className="hidden sm:inline">{shortDays[wd]}</span>
                </div>
                <div
                  className={`flex min-h-[4.5rem] flex-col gap-1 rounded-lg border p-1.5 ${
                    open
                      ? "border-gray-200 bg-gray-50"
                      : "border-dashed border-gray-200 bg-white"
                  }`}
                >
                  {open ? (
                    dayRules.map((r) => (
                      <span
                        key={r.id}
                        className="rounded-md border border-gray-200 bg-white px-1 py-1 text-center text-[10px] font-medium leading-tight text-gray-700 sm:text-xs"
                        title={`${minutesToLabel(r.start_minute)} – ${minutesToLabel(r.end_minute)}`}
                      >
                        {minutesToLabel(r.start_minute)}
                        <span className="hidden sm:inline">
                          {" – "}
                          {minutesToLabel(r.end_minute)}
                        </span>
                      </span>
                    ))
                  ) : (
                    <span className="my-auto text-center text-[10px] text-gray-300">
                      —
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* What renters will see */}
        <div className="mt-5 rounded-lg border border-gray-100 bg-gray-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            What renters will see
          </p>
          {previewRule ? (
            <>
              <p className="mt-1 text-sm text-gray-600">
                Booking the {WEEKDAY_LABELS[previewRule.weekday]}{" "}
                {minutesToLabel(previewRule.start_minute)}–
                {minutesToLabel(previewRule.end_minute)} window at your{" "}
                {cfg.booking_slot_minutes}-minute slot length, renters pick from
                times like these:
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {previewStarts.slice(0, PREVIEW_MAX).map((m) => (
                  <span
                    key={m}
                    className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700"
                  >
                    {minutesToLabel(m)}
                  </span>
                ))}
                {previewStarts.length > PREVIEW_MAX && (
                  <span className="px-1 py-1 text-xs text-gray-400">
                    +{previewStarts.length - PREVIEW_MAX} more
                  </span>
                )}
                {previewStarts.length === 0 && (
                  <span className="text-xs text-gray-400">
                    This window is shorter than one slot, so it produces no
                    bookable times. Widen it or shorten the slot length.
                  </span>
                )}
              </div>
              <p className="mt-3 text-xs text-gray-400">
                Times already booked are hidden automatically, and your minimum
                notice ({cfg.booking_lead_hours}h) applies.
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm text-gray-500">
              Add a window below to preview the times renters will be able to
              book.
            </p>
          )}
        </div>
      </div>

      {/* Weekly windows */}
      <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
          Weekly windows
        </h3>
        <p className="mb-3 mt-1 text-sm text-gray-500">
          These are the windows renters can choose from. Times that are already
          booked are removed automatically.
        </p>

        {rules.length === 0 && (
          <div className="mb-4 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-600">
            No times yet. Add your first below so renters can book a viewing
            online.
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

      {/* Specific dates: day-off blackouts + custom hours */}
      <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
          Specific dates
        </h3>
        <p className="mb-4 mt-1 text-sm text-gray-500">
          Close one date entirely or set custom hours for a date that should be
          different from the weekly schedule. A day off wins over custom hours.
        </p>

        {specificDates.length === 0 ? (
          <div className="mb-4 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-600">
            No specific dates scheduled. Add one below when a day needs custom
            viewing hours or should be closed.
          </div>
        ) : (
          <div className="mb-4 divide-y divide-gray-100 rounded-lg border border-gray-200">
            {specificDates.map((d) => (
              <div
                key={`${d.kind}-${d.id}`}
                className="flex flex-wrap items-center justify-between gap-3 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800">
                    {fmtSpecificDate(d.day)}
                  </p>
                  {d.kind === "day_off" ? (
                    <p className="text-xs text-gray-500">Day off</p>
                  ) : (
                    <p className="text-xs text-gray-500">
                      Custom hours: {minutesToLabel(d.start_minute)} –{" "}
                      {minutesToLabel(d.end_minute)}
                    </p>
                  )}
                </div>
                <form
                  action={
                    d.kind === "day_off"
                      ? removeDayOff
                      : removeAvailabilityOverride
                  }
                >
                  <input type="hidden" name="id" value={d.id} />
                  <button
                    title="Remove this specific date"
                    className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-sm text-gray-700 hover:border-red-300 hover:bg-red-50 hover:text-red-600"
                  >
                    Remove
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}

        <form
          action={addDayOff}
          className="flex flex-wrap items-end gap-3 border-t border-gray-100 pt-4"
        >
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">
              Date off
            </span>
            <input
              name="day"
              type="date"
              required
              min={todayKey}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          <button className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white">
            Add day off
          </button>
        </form>
        <form
          action={addAvailabilityOverride}
          className="mt-3 flex flex-wrap items-end gap-3"
        >
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">
              Custom date
            </span>
            <input
              name="day"
              type="date"
              required
              min={todayKey}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
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
            Add custom hours
          </button>
        </form>
      </div>
    </div>
  );
}
