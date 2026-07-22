# CODEX BUILD — Leasing Health engine + morning briefing (S513-H1)

**Scope: H1 only** — the pure leasing-health engine + a health section on the daily
snapshot. **No migration** (reads existing data). The same-day tripwire push (S513a), the
"couldn't-find-a-time" lead flag (S513b), and reopen-notify (S513c) are **separate follow-on
tickets** — do not build them here. Full design: `claude/DESIGN-LEASING-HEALTH-BRIEFING-S513.md`
(spine) + `claude/DESIGN-AVAILABILITY-TRIPWIRE-AND-WAITLIST-S513.md` (companion).

App HEAD at spec time: `e429050`. No migration. Model the data reads on the existing
`app/api/cron/leasing-snapshot/route.ts` (it already loads showings + leads + org per day).

**Locked defaults (Noam, 2026-07-18):** green ≥ 7 open days · yellow 2–6 · red ≤ 1 · black 0 ·
evening = slot start ≥ 17:00 · weekend = Sat/Sun · stale calendar = 12 days since last window
change · **black OR red forces the daily briefing to send even on an otherwise-quiet day** ·
org-level availability (one status per org).

---

## Part 1 — `lib/leasing-health.ts` (new, PURE, no I/O)

The engine. Given the org's shared calendar + per-listing data (fetched by the caller and
passed in), return a `LeasingHealth` with a status color and a ranked list of alerts.

### Slot counting (booked-aware — the shared primitive)

Reuse `generateSlots` from `lib/booking.ts` (it already excludes `av.booked` + lead-time).
Add here (S513a's tripwire will import these rather than duplicate):

```ts
// availability.booked MUST be the real taken instants (NOT []).
openBookableDays(av: Availability, now: Date, days: number): string[]   // distinct YYYY-MM-DD, sorted
countOpenBookableSlots(av: Availability, now: Date, days: number): number
```
Clamp the horizon to `days` the way `reminderAvailability()` does in `lib/viewing-reminder.ts`.
Also expose slot-shape helpers over the same generated slots:
```ts
hasEveningSlot(av, now, days, eveningStartHour=17): boolean   // any slot local-hour >= 17
hasWeekendSlot(av, now, days): boolean                        // any slot on Sat(6)/Sun(0) org-local
```

### Types

```ts
export type LeasingHealthStatus = "green" | "yellow" | "red" | "black";

export type LeasingHealthAlert = {
  code: string;                 // e.g. "offline", "ends_soon", "no_weekend", "demand_pressure"
  severity: 1 | 2 | 3 | 4;      // 4=black,3=red,2=yellow,1=info; used for ranking
  scope: "org" | "listing";
  message: string;              // human line for the briefing
  recommendation: string;       // the "what to do"
  propertyId?: string;          // set for listing-scoped alerts
};

export type LeasingHealthInput = {
  now: Date;
  windowDays: number;                 // default 7
  availability: Availability;         // booked = real taken instants across the org
  lastWindowChangeMs: number | null;  // max(created_at) of rules/overrides/days_off
  listings: Array<{
    propertyId: string;
    address: string;
    status: string;                   // 'available' | 'leased' | 'off_market'
    createdAtMs: number | null;
    openInquiries: number;            // leads in new/replied/contacted for this property
    bookedInstants: string[];         // this listing's future scheduled showing ISO times
  }>;
  cfg?: Partial<LeasingHealthConfig>; // thresholds; defaults below
};

export type LeasingHealthConfig = {
  greenMinDays: number;   // 7
  yellowMinDays: number;  // 2  (below this and >0 => red band starts at <=1)
  redMaxDays: number;     // 1
  thinSlots: number;      // 3
  eveningStartHour: number; // 17
  staleDays: number;      // 12
};

export type LeasingHealth = {
  status: LeasingHealthStatus;
  futureOpenDays: number;
  openDays: string[];         // the actual dates
  nextOpenDay: string | null;
  lastOpenDay: string | null;
  hasToday: boolean;
  hasTomorrow: boolean;
  eveningAvailable: boolean;
  weekendAvailable: boolean;
  daysSinceLastWindowChange: number | null;
  alerts: LeasingHealthAlert[]; // ranked severity desc
};
```

### Status rule (org-level, availability supply)

```
open = countOpenBookableSlots(av, now, windowDays); openDays = openBookableDays(...).length
black : any listing is status 'available' AND openDays == 0
red   : openDays <= redMaxDays (1)          // last viewing today/tomorrow
yellow: openDays < greenMinDays (7)  OR (green-by-count but a shape gap: !eveningAvailable || !weekendAvailable)
green : otherwise
```
(Black outranks red outranks yellow. Black requires ≥1 *available* listing — an org with only
leased/off_market units and an empty calendar is not "offline", it's just idle.)

### Alert rules (fire only when true; rank by severity)

| code | condition | sev | scope | message / recommendation |
|---|---|---|---|---|
| `offline` | ≥1 available listing AND openDays==0 | 4 | listing (each available one) | "Live and un-bookable." / "Add viewing windows now." |
| `ends_tomorrow` | openDays in {1} | 3 | org | "Last viewing is {{lastOpenDay}}." / "Add windows past {{lastOpenDay}}." |
| `ends_soon` | 1 < openDays < greenMinDays | 2 | org | "Only {{openDays}} days of availability ({{list}})." / "Open more times." |
| `no_after_date` | lastOpenDay set AND openDays≥1 | 1 | org | "No availability after {{lastOpenDay}}." (fold into ends_* copy; don't double-fire) |
| `no_weekend` | !weekendAvailable | 2 | org | "No weekend viewing times." / "Add a Sat/Sun window." |
| `no_evening` | !eveningAvailable | 2 | org | "All viewings are business hours." / "Add an evening window (after 5pm)." |
| `stale_calendar` | daysSinceLastWindowChange ≥ staleDays | 1 | org | "No new windows in {{n}} days." / "Refresh your calendar." |
| `demand_pressure` | listing.openInquiries ≥ 5 AND openDays ≤ 2 | 3 | listing | "{{n}} inquiries but {{openDays}} viewing day(s) left." / "Open more times." |
| `listing_stale_no_weekend` | listing live ≥ 7 days AND !weekendAvailable | 1 | listing | "Live {{n}} days, no weekend slot." |

Keep copy short; the briefing renderer (Part 2) assembles them. Do NOT double-count
`no_after_date` when `ends_*` already names `lastOpenDay`.

### Pure decision helper

Export `assessLeasingHealth(input: LeasingHealthInput): LeasingHealth` doing all of the above
with no I/O, plus `defaultLeasingHealthConfig`.

## Part 2 — Wire into the daily snapshot

**`app/api/cron/leasing-snapshot/route.ts`:** after the existing bucket loads, additionally
load (per org, admin client): `availability_rules`, `availability_days_off`,
`availability_overrides` (same selects as the S500 cron), the org booking settings
(`booking_timezone/slot_minutes/lead_hours/horizon_days`), the org's `available` properties
(`id,address,status,created_at`), future scheduled showings for the org
(`outcome is null OR 'scheduled'`, `scheduled_at >= now`, within `windowDays`) grouped by
property → `bookedInstants` per listing and the union → `availability.booked`, and open-inquiry
counts per property (`leads` in `new/replied/contacted`). Derive `lastWindowChangeMs` from
`max(created_at)` across rules/overrides/days_off. Call `assessLeasingHealth(...)`.

**`lib/leasing-snapshot.ts`:**
- New `buildLeasingHealthBlock(health: LeasingHealth, tz: string): string` — renders the §6
  briefing header: the status line + the one recommendation + the "accepting bookings /
  openings tomorrow / next opening" roll-up + a worst-first NEEDS ATTENTION list of the
  ranked alerts. When `green` and no alerts fire, collapse to one line
  ("🟢 Healthy — availability for the next {{n}} days").
- `buildSnapshotBlock` gains the health block **prepended** above NEW INQUIRIES (pass health
  in, or compose in the route — keep `buildSnapshotBlock` pure either way).
- **`snapshotHasContent`**: extend so it also returns `true` when `health.status` is `black`
  or `red` (forces the digest to send on an otherwise-quiet day). Yellow/green do NOT force.

**Event tokens** (`lib/notifications.ts`, `leasing.daily_snapshot`): the health text rides
inside the existing `{{snapshot}}` block, so **no new tokens strictly required**. Optionally
add `{{health_status}}` for the subject line — nice-to-have, not required.

## Part 3 — Tests

`scripts/test-leasing-health.ts` (tsx, run in the cloud container):
- Status boundaries: openDays 0 (+available listing)→black; 0 (no available listing)→not black;
  1→red; 4→yellow; 7 with evenings+weekends→green; 8-but-no-weekend→yellow (shape gap).
- Each alert fires only on its condition; `demand_pressure` needs both arms; ranking is
  severity-desc; green+quiet collapses to the one-liner.
- `snapshotHasContent` forces send on black/red, stays quiet on green/yellow-with-no-buckets.

## Guardrails / must-nots

- **No migration**, no schema change, no new RPC. Reads only.
- Do not touch the S500 reminder, the booking RPCs, or `lib/booking.ts` logic (import only).
- `availability.booked` MUST be the real taken instants — never `[]`.
- Keep `lib/leasing-health.ts` pure (all I/O in the route) so it's unit-testable and reusable
  by S513a.
- Preserve the existing snapshot behaviour for orgs with a healthy calendar — the digest must
  still read as today's status, not a nag.

## Verify (Cowork, after Codex returns)

1. `device_bash git diff` in MAIN — only the files above; no `supabase/migrations` touched;
   `git diff --check` clean.
2. Stage `lib/leasing-health.ts` + `lib/booking.ts` + `lib/leasing-snapshot.ts` + the test to
   the cloud container; `npx tsx scripts/test-leasing-health.ts` → all pass.
3. Hit `/api/cron/leasing-snapshot?dry=1&org=921f7c08-98af-428f-a238-36f4a781b0de&secret=...`
   (GET, dry) and confirm the rendered health block + status match a hand-count of Agile's
   next-7 availability. Dry = no mutation.
4. Noam pushes; Vercel READY. Live morning briefing on the next scheduled send.
