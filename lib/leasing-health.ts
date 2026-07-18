import { generateSlots, type Availability } from "./booking";

const DAY_MS = 24 * 3_600_000;

export type LeasingHealthStatus = "green" | "yellow" | "red" | "black";

export type LeasingHealthAlert = {
  code: string;
  severity: 1 | 2 | 3 | 4;
  scope: "org" | "listing";
  message: string;
  recommendation: string;
  propertyId?: string;
};

export type LeasingHealthConfig = {
  greenMinDays: number;
  yellowMinDays: number;
  redMaxDays: number;
  thinSlots: number;
  eveningStartHour: number;
  staleDays: number;
};

export type LeasingHealthInput = {
  now: Date;
  windowDays: number;
  availability: Availability;
  lastWindowChangeMs: number | null;
  listings: Array<{
    propertyId: string;
    address: string;
    status: string;
    createdAtMs: number | null;
    openInquiries: number;
    bookedInstants: string[];
  }>;
  cfg?: Partial<LeasingHealthConfig>;
};

export type LeasingHealth = {
  status: LeasingHealthStatus;
  futureOpenDays: number;
  openDays: string[];
  nextOpenDay: string | null;
  lastOpenDay: string | null;
  hasToday: boolean;
  hasTomorrow: boolean;
  eveningAvailable: boolean;
  weekendAvailable: boolean;
  daysSinceLastWindowChange: number | null;
  alerts: LeasingHealthAlert[];
};

export const defaultLeasingHealthConfig: LeasingHealthConfig = {
  greenMinDays: 7,
  yellowMinDays: 2,
  redMaxDays: 1,
  thinSlots: 3,
  eveningStartHour: 17,
  staleDays: 12,
};

type TzParts = {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
};

function clampWindowDays(days: number): number {
  if (!Number.isFinite(days) || days <= 0) return 0;
  return Math.floor(days);
}

function boundedAvailability(av: Availability, days: number): Availability | null {
  const windowDays = clampWindowDays(days);
  if (windowDays <= 0) return null;
  const configuredHorizon =
    Number.isFinite(av.horizon_days) && av.horizon_days > 0
      ? av.horizon_days
      : windowDays;
  return {
    ...av,
    horizon_days: Math.min(configuredHorizon, windowDays),
  };
}

function slotsWithinWindow(av: Availability, now: Date, days: number) {
  const bounded = boundedAvailability(av, days);
  if (!bounded) return [];
  const endMs = now.getTime() + clampWindowDays(days) * DAY_MS;
  return generateSlots(bounded, now).map((day) => ({
    ...day,
    slots: day.slots.filter((slot) => {
      const slotMs = Date.parse(slot.iso);
      return !Number.isNaN(slotMs) && slotMs < endMs;
    }),
  })).filter((day) => day.slots.length > 0);
}

export function openBookableDays(
  av: Availability,
  now: Date,
  days: number,
): string[] {
  const dayKeys = new Set<string>();
  for (const day of slotsWithinWindow(av, now, days)) {
    dayKeys.add(day.dayKey);
  }
  return [...dayKeys].sort();
}

export function countOpenBookableSlots(
  av: Availability,
  now: Date,
  days: number,
): number {
  let count = 0;
  for (const day of slotsWithinWindow(av, now, days)) {
    count += day.slots.length;
  }
  return count;
}

function tzParts(ms: number, tz: string): TzParts {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const map: Record<string, number> = {};
    for (const p of fmt.formatToParts(new Date(ms))) {
      if (p.type !== "literal") map[p.type] = Number(p.value);
    }
    return {
      y: map.year,
      mo: map.month,
      d: map.day,
      h: map.hour === 24 ? 0 : map.hour,
      mi: map.minute,
      s: map.second,
    };
  } catch {
    const dt = new Date(ms);
    return {
      y: dt.getUTCFullYear(),
      mo: dt.getUTCMonth() + 1,
      d: dt.getUTCDate(),
      h: dt.getUTCHours(),
      mi: dt.getUTCMinutes(),
      s: dt.getUTCSeconds(),
    };
  }
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function localDateString(ms: number, tz: string): string {
  const p = tzParts(ms, tz);
  return `${p.y}-${pad2(p.mo)}-${pad2(p.d)}`;
}

function localHour(ms: number, tz: string): number {
  return tzParts(ms, tz).h;
}

function weekdayForDateKey(dayKey: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!m) return null;
  return new Date(
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])),
  ).getUTCDay();
}

function plusDays(dayKey: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!m) return dayKey;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + days * DAY_MS;
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function hasEveningSlot(
  av: Availability,
  now: Date,
  days: number,
  eveningStartHour = defaultLeasingHealthConfig.eveningStartHour,
): boolean {
  const tz = av.timezone || "America/Toronto";
  for (const day of slotsWithinWindow(av, now, days)) {
    for (const slot of day.slots) {
      const slotMs = Date.parse(slot.iso);
      if (!Number.isNaN(slotMs) && localHour(slotMs, tz) >= eveningStartHour) {
        return true;
      }
    }
  }
  return false;
}

export function hasWeekendSlot(
  av: Availability,
  now: Date,
  days: number,
): boolean {
  for (const day of slotsWithinWindow(av, now, days)) {
    const dow = weekdayForDateKey(day.dayKey);
    if (dow === 0 || dow === 6) return true;
  }
  return false;
}

function isAvailableStatus(status: string): boolean {
  return status.trim().toLowerCase() === "available";
}

function daysSince(nowMs: number, earlierMs: number | null): number | null {
  if (earlierMs == null || !Number.isFinite(earlierMs)) return null;
  return Math.max(0, Math.floor((nowMs - earlierMs) / DAY_MS));
}

function addAlert(
  alerts: LeasingHealthAlert[],
  alert: LeasingHealthAlert,
): void {
  alerts.push(alert);
}

export function assessLeasingHealth(input: LeasingHealthInput): LeasingHealth {
  const cfg: LeasingHealthConfig = {
    ...defaultLeasingHealthConfig,
    ...(input.cfg ?? {}),
  };
  const now = input.now;
  const nowMs = now.getTime();
  const windowDays = clampWindowDays(input.windowDays || 7) || 7;
  const openDays = openBookableDays(input.availability, now, windowDays);
  const futureOpenDays = openDays.length;
  const nextOpenDay = openDays[0] ?? null;
  const lastOpenDay = openDays[openDays.length - 1] ?? null;
  const tz = input.availability.timezone || "America/Toronto";
  const today = localDateString(nowMs, tz);
  const tomorrow = plusDays(today, 1);
  const eveningAvailable = hasEveningSlot(
    input.availability,
    now,
    windowDays,
    cfg.eveningStartHour,
  );
  const weekendAvailable = hasWeekendSlot(input.availability, now, windowDays);
  const daysSinceLastWindowChange = daysSince(
    nowMs,
    input.lastWindowChangeMs,
  );
  const availableListings = input.listings.filter((l) =>
    isAvailableStatus(l.status),
  );

  // No live inventory = nothing a renter could book, so there is no leasing
  // health to alert on. Report quiet (green, no alerts) so a dormant org never
  // force-sends a "red / action needed" digest about a calendar it has no
  // reason to fill. Black/red are reserved for orgs with at least one available
  // listing (see the status ladder below).
  if (availableListings.length === 0) {
    return {
      status: "green",
      futureOpenDays,
      openDays,
      nextOpenDay,
      lastOpenDay,
      hasToday: openDays.includes(today),
      hasTomorrow: openDays.includes(tomorrow),
      eveningAvailable,
      weekendAvailable,
      daysSinceLastWindowChange,
      alerts: [],
    };
  }

  let status: LeasingHealthStatus;
  if (availableListings.length > 0 && futureOpenDays === 0) {
    status = "black";
  } else if (futureOpenDays <= cfg.redMaxDays) {
    status = "red";
  } else if (
    futureOpenDays < cfg.greenMinDays ||
    !eveningAvailable ||
    !weekendAvailable
  ) {
    status = "yellow";
  } else {
    status = "green";
  }

  const alerts: LeasingHealthAlert[] = [];

  if (availableListings.length > 0 && futureOpenDays === 0) {
    for (const listing of availableListings) {
      addAlert(alerts, {
        code: "offline",
        severity: 4,
        scope: "listing",
        propertyId: listing.propertyId,
        message: "Live and un-bookable.",
        recommendation: "Add viewing windows now.",
      });
    }
  }

  if (futureOpenDays === 1) {
    addAlert(alerts, {
      code: "ends_tomorrow",
      severity: 3,
      scope: "org",
      message: `Last viewing is ${lastOpenDay}.`,
      recommendation: `Add windows past ${lastOpenDay}.`,
    });
  }

  if (futureOpenDays > 1 && futureOpenDays < cfg.greenMinDays) {
    addAlert(alerts, {
      code: "ends_soon",
      severity: 2,
      scope: "org",
      message: `Only ${futureOpenDays} days of availability (${openDays.join(", ")}).`,
      recommendation: "Open more times.",
    });
  }

  if (!weekendAvailable) {
    addAlert(alerts, {
      code: "no_weekend",
      severity: 2,
      scope: "org",
      message: "No weekend viewing times.",
      recommendation: "Add a Sat/Sun window.",
    });
  }

  if (!eveningAvailable) {
    addAlert(alerts, {
      code: "no_evening",
      severity: 2,
      scope: "org",
      message: "All viewings are business hours.",
      recommendation: "Add an evening window (after 5pm).",
    });
  }

  if (
    daysSinceLastWindowChange != null &&
    daysSinceLastWindowChange >= cfg.staleDays
  ) {
    addAlert(alerts, {
      code: "stale_calendar",
      severity: 1,
      scope: "org",
      message: `No new windows in ${daysSinceLastWindowChange} days.`,
      recommendation: "Refresh your calendar.",
    });
  }

  // Weekend availability is ORG-level (one shared calendar), so a per-listing
  // "no weekend slot" line would repeat the same fact once per listing. Count
  // the affected listings and emit a SINGLE org-scoped line instead.
  let staleNoWeekendCount = 0;
  for (const listing of input.listings) {
    if (listing.openInquiries >= 5 && futureOpenDays <= 2) {
      addAlert(alerts, {
        code: "demand_pressure",
        severity: 3,
        scope: "listing",
        propertyId: listing.propertyId,
        message: `${listing.openInquiries} inquiries but ${futureOpenDays} viewing day(s) left.`,
        recommendation: "Open more times.",
      });
    }

    const liveDays = daysSince(nowMs, listing.createdAtMs);
    if (liveDays != null && liveDays >= 7 && !weekendAvailable) {
      staleNoWeekendCount++;
    }
  }

  if (staleNoWeekendCount > 0) {
    addAlert(alerts, {
      code: "listing_stale_no_weekend",
      severity: 1,
      scope: "org",
      message: `${staleNoWeekendCount} listing${staleNoWeekendCount === 1 ? "" : "s"} live 7+ days with no weekend viewing time.`,
      recommendation: "Add a Sat/Sun window.",
    });
  }

  alerts.sort((a, b) => b.severity - a.severity);

  return {
    status,
    futureOpenDays,
    openDays,
    nextOpenDay,
    lastOpenDay,
    hasToday: openDays.includes(today),
    hasTomorrow: openDays.includes(tomorrow),
    eveningAvailable,
    weekendAvailable,
    daysSinceLastWindowChange,
    alerts,
  };
}
