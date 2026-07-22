TASK: Build S513-H1 — a pure "Leasing Health" engine plus a health section on the daily
leasing snapshot ("morning briefing"). NO migration, NO new RPC, reads only. This answers one
question for the landlord each morning: "a renter finds my listing today — can they easily
book a viewing?" — and if not, says exactly why and what to do.

════════════════════════════════════════════════════════════════════════
READ FIRST (context — repo-relative paths)
════════════════════════════════════════════════════════════════════════
Primary spec (follow it exactly; this prompt reproduces its substance):
  • claude/CODEX-BUILD-LEASING-HEALTH-BRIEFING-S513-H1.md
Design rationale (optional deeper context):
  • claude/DESIGN-LEASING-HEALTH-BRIEFING-S513.md            (the spine)
  • claude/DESIGN-AVAILABILITY-TRIPWIRE-AND-WAITLIST-S513.md (companion; S513a/b/c follow later)
Existing code to MODEL ON / IMPORT (do not duplicate their logic):
  • lib/booking.ts                          → generateSlots(av, now), types Availability, Slot.
                                              generateSlots already excludes av.booked + lead-time.
  • lib/viewing-reminder.ts                 → reminderAvailability() horizon clamp + the
                                              openViewingDaysNext7 / countOpenViewingSlotsNext7
                                              pattern you are GENERALIZING (but pass real booked, not []).
  • app/api/cron/viewing-reminder/route.ts  → mirror its availability-load block (the exact
                                              selects for rules / days_off / overrides and how it
                                              builds the Availability object).
  • app/api/cron/leasing-snapshot/route.ts  → the cron you will MODIFY; it already loads org,
                                              showings (today/week buckets) and leads. Reuse those reads.
  • lib/leasing-snapshot.ts                 → buildSnapshotBlock, snapshotHasContent,
                                              SnapshotBuckets, snapshotWindow, localDateString/
                                              localHour/localWeekday. You will MODIFY this.

════════════════════════════════════════════════════════════════════════
LOCKED DEFAULTS
════════════════════════════════════════════════════════════════════════
green ≥ 7 open days · yellow 2–6 · red ≤ 1 · black = 0 (with ≥1 available listing)
evening = slot local-hour ≥ 17 · weekend = Sat(6)/Sun(0) org-local
stale calendar = ≥ 12 days since last window change
window lookahead = 7 days
BLACK or RED status FORCES the daily briefing to send even on an otherwise-quiet day.
Availability is ORG-LEVEL (availability_rules has no property_id) — one status per org, with
per-listing overlays for demand/age. Do NOT attempt per-listing availability calendars.

════════════════════════════════════════════════════════════════════════
CREATE: lib/leasing-health.ts   (PURE — no I/O, no supabase, fully unit-testable)
════════════════════════════════════════════════════════════════════════
Booked-aware slot primitives (S513a's tripwire will import these later — put them HERE):
  openBookableDays(av: Availability, now: Date, days: number): string[]   // distinct YYYY-MM-DD, sorted
  countOpenBookableSlots(av: Availability, now: Date, days: number): number
  hasEveningSlot(av: Availability, now: Date, days: number, eveningStartHour=17): boolean
  hasWeekendSlot(av: Availability, now: Date, days: number): boolean
  — all built on generateSlots(); clamp horizon to `days` like reminderAvailability() does.
  — av.booked MUST be the real taken instants (never []).

Types:
  type LeasingHealthStatus = "green" | "yellow" | "red" | "black";
  type LeasingHealthAlert = { code: string; severity: 1|2|3|4; scope: "org"|"listing";
                              message: string; recommendation: string; propertyId?: string };
  type LeasingHealthConfig = { greenMinDays:7; yellowMinDays:2; redMaxDays:1; thinSlots:3;
                               eveningStartHour:17; staleDays:12 };
  type LeasingHealthInput = {
    now: Date; windowDays: number; availability: Availability;
    lastWindowChangeMs: number | null;
    listings: Array<{ propertyId:string; address:string; status:string;
                      createdAtMs:number|null; openInquiries:number; bookedInstants:string[] }>;
    cfg?: Partial<LeasingHealthConfig>;
  };
  type LeasingHealth = { status; futureOpenDays; openDays:string[]; nextOpenDay:string|null;
                         lastOpenDay:string|null; hasToday; hasTomorrow; eveningAvailable;
                         weekendAvailable; daysSinceLastWindowChange:number|null;
                         alerts: LeasingHealthAlert[] };

Export: defaultLeasingHealthConfig, and assessLeasingHealth(input): LeasingHealth.

Status rule (black > red > yellow > green):
  open = countOpenBookableSlots(av, now, windowDays); D = openBookableDays(...).length
  black  : some listing.status === 'available' AND D === 0
  red    : D <= redMaxDays (1)
  yellow : D < greenMinDays (7)  OR  (D >= 7 but !eveningAvailable || !weekendAvailable)
  green  : otherwise

Alerts (fire only when true; sort severity desc; keep copy short):
  offline (4, listing, each available listing when D==0): "Live and un-bookable." /
      "Add viewing windows now."
  ends_tomorrow (3, org, D==1): "Last viewing is {{lastOpenDay}}." / "Add windows past it."
  ends_soon (2, org, 1<D<7): "Only {{D}} days of availability ({{openDays}})." / "Open more times."
  no_weekend (2, org, !weekendAvailable): "No weekend viewing times." / "Add a Sat/Sun window."
  no_evening (2, org, !eveningAvailable): "All viewings are business hours." / "Add an evening
      window (after 5pm)."
  stale_calendar (1, org, daysSinceLastWindowChange >= 12): "No new windows in {{n}} days." /
      "Refresh your calendar."
  demand_pressure (3, listing, openInquiries>=5 AND D<=2): "{{n}} inquiries but {{D}} viewing
      day(s) left." / "Open more times."
  listing_stale_no_weekend (1, listing, daysLive>=7 AND !weekendAvailable): "Live {{n}} days,
      no weekend slot."
  Do NOT emit a separate "no availability after {{date}}" alert when ends_* already names lastOpenDay.

════════════════════════════════════════════════════════════════════════
MODIFY: app/api/cron/leasing-snapshot/route.ts
════════════════════════════════════════════════════════════════════════
After the existing bucket loads, per org (admin/service-role client), ALSO load:
  • availability_rules (weekday,start_minute,end_minute), availability_days_off (day),
    availability_overrides (day,start_minute,end_minute)  — same selects as the viewing-reminder cron.
  • org booking cols: booking_timezone, booking_slot_minutes, booking_lead_hours, booking_horizon_days.
  • properties where status='available': id,address,status,created_at.
  • future scheduled showings for the org (outcome is null OR outcome='scheduled',
    scheduled_at >= now, scheduled_at < now + 7d): group scheduled_at ISO by property_id →
    each listing.bookedInstants, and the UNION → availability.booked.
  • open-inquiry count per property: leads in status new/replied/contacted (reuse
    SNAPSHOT_NUDGE_STATUSES) grouped by property_id → listing.openInquiries.
  • lastWindowChangeMs = max(created_at) across availability_rules/overrides/days_off (null if none).
Build the Availability object exactly like the viewing-reminder cron does. Call
assessLeasingHealth({ now, windowDays:7, availability, lastWindowChangeMs, listings }).
Pass the resulting health into the snapshot render (below). Respect ?dry=1 (no writes/sends).

════════════════════════════════════════════════════════════════════════
MODIFY: lib/leasing-snapshot.ts
════════════════════════════════════════════════════════════════════════
  • Add buildLeasingHealthBlock(health: LeasingHealth, tz: string): string — renders:
      a status line (🟢/🟡/🔴/⚫ + label), the single top recommendation, a one-line roll-up
      ("Accepting bookings today: yes/no · Openings tomorrow: yes/no · Next opening: {{nextOpenDay}}"),
      and a worst-first "NEEDS ATTENTION" list of the ranked alerts (message + recommendation).
      When status==='green' AND alerts is empty, collapse to ONE line:
      "🟢 Healthy — availability for the next {{futureOpenDays}} days".
  • Prepend the health block ABOVE "NEW INQUIRIES — LAST 24 HOURS" in the assembled snapshot
    (either add a health param to buildSnapshotBlock or compose in the route — keep
    buildSnapshotBlock pure).
  • Extend snapshotHasContent so it ALSO returns true when health.status is 'black' or 'red'
    (force-send). Yellow/green do NOT force. (Add a health arg; keep the existing bucket logic.)

Optional: add a {{health_status}} token to leasing.daily_snapshot in lib/notifications.ts for
the subject line. Not required.

════════════════════════════════════════════════════════════════════════
CREATE: scripts/test-leasing-health.ts   (tsx; must pass under `npx tsx`)
════════════════════════════════════════════════════════════════════════
Cover: status boundaries (D=0 with available listing→black; D=0 with no available listing→NOT
black; D=1→red; D=4→yellow; D=7 with evenings+weekends→green; D=8 but no weekend→yellow); each
alert fires only on its condition; demand_pressure needs both arms; ranking is severity-desc;
green+quiet collapses to the one-liner; snapshotHasContent forces send on black/red only.

════════════════════════════════════════════════════════════════════════
GUARDRAILS — MUST NOT
════════════════════════════════════════════════════════════════════════
  • NO migration, NO schema change, NO new RPC. Reads only.
  • Do NOT modify the S500 viewing-reminder cron, the booking RPCs, or lib/booking.ts logic
    (import only).
  • availability.booked MUST be the real taken instants — never [].
  • Keep lib/leasing-health.ts 100% pure (all supabase I/O stays in the cron route).
  • Orgs with a healthy calendar must still read as a normal "today" digest — not a nag.
  • ?dry=1 must be fully side-effect-free.

════════════════════════════════════════════════════════════════════════
DELIVERABLE
════════════════════════════════════════════════════════════════════════
A single diff touching exactly: lib/leasing-health.ts (new), scripts/test-leasing-health.ts
(new), app/api/cron/leasing-snapshot/route.ts, lib/leasing-snapshot.ts, and optionally
lib/notifications.ts. No files under supabase/migrations. Ensure `npx tsx
scripts/test-leasing-health.ts` passes and the project typechecks.
