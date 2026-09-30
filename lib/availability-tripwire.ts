import {
  countOpenBookableSlots,
  openBookableDays,
} from "./leasing-health";

export {
  countOpenBookableSlots,
  openBookableDays,
};

export type TripwireSeverity = "ok" | "thin" | "zero";

function isTripwireSeverity(value: string | null): value is TripwireSeverity {
  return value === "ok" || value === "thin" || value === "zero";
}

export function classifyTripwire(args: {
  open: number;
  openDays: number;
  thinSlots: number;
}): TripwireSeverity {
  if (args.open < 1) return "zero";
  if (args.open < args.thinSlots || args.openDays <= 1) return "thin";
  return "ok";
}

export function shouldAlertTripwire(args: {
  severity: TripwireSeverity;
  lastState: string | null;
  lastAlertOn: string | null;
  todayLocal: string;
}): {
  alert: boolean;
  nextLastState: TripwireSeverity;
  nextLastAlertOn: string | null;
} {
  const lastState = isTripwireSeverity(args.lastState) ? args.lastState : null;
  let alert = false;

  if (args.severity === "thin" || args.severity === "zero") {
    alert =
      lastState === null ||
      lastState === "ok" ||
      (lastState === "thin" && args.severity === "zero") ||
      (lastState === args.severity &&
        args.lastAlertOn !== null &&
        args.lastAlertOn < args.todayLocal);
  }

  return {
    alert,
    nextLastState: args.severity,
    nextLastAlertOn: alert
      ? args.todayLocal
      : args.severity === "ok"
        ? null
        : args.lastAlertOn,
  };
}

/**
 * Format the org-local open day keys ("YYYY-MM-DD") for the alert email, e.g.
 * "Fri, Oct 2" or "Fri, Oct 2 and Sat, Oct 3". Returns "none" when empty so
 * the zero case still reads as a sentence. Pure: the keys are already local
 * calendar dates, so they are formatted at noon UTC with timeZone UTC and can
 * never slip a day.
 */
export function formatOpenDayList(dayKeys: string[]): string {
  const labels = dayKeys
    .filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k))
    .map((k) =>
      new Date(`${k}T12:00:00Z`).toLocaleDateString("en-US", {
        timeZone: "UTC",
        weekday: "short",
        month: "short",
        day: "numeric",
      }),
    );
  if (labels.length === 0) return "none";
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join("; ")} and ${labels[labels.length - 1]}`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The subject headline and the one-sentence summary for the tripwire email
 * (S699). The alert fires for three different shapes (no times at all, times
 * on only one day, or very few times across several days) and one fixed
 * template could not say all three honestly, so the sentence is built here.
 */
export function describeTripwire(args: {
  open: number;
  dayKeys: string[];
  windowDays: number;
}): { headline: string; summary: string } {
  const window = `the next ${plural(args.windowDays, "day", "days")}`;
  const days = args.dayKeys.length;
  const list = formatOpenDayList(args.dayKeys);
  const times = plural(args.open, "open viewing time", "open viewing times");
  if (args.open < 1 || days === 0) {
    return {
      headline: `no viewing times renters can book in ${window}`,
      summary: `Renters cannot book a viewing on any day in ${window}. The booking page shows no times.`,
    };
  }
  if (days === 1) {
    return {
      headline: `viewings can be booked on only 1 day in ${window}`,
      summary: `Renters can book a viewing on only 1 day in ${window}: ${list} (${times}). On every other day the booking page shows no times, so a renter who needs a different day cannot book.`,
    };
  }
  return {
    headline: `only ${times} left in ${window}`,
    summary: `Renters can book only ${times} in ${window}, on ${list}.`,
  };
}
