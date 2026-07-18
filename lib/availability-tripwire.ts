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
