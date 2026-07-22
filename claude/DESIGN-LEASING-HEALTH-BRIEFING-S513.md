# DESIGN — Leasing Health engine + daily operational briefing (S513, thread #3 expanded)

**Design thread #3, elevated (Noam, 2026-07-18).** Status: DESIGN ONLY — nothing ships.
Companion to `DESIGN-AVAILABILITY-TRIPWIRE-AND-WAITLIST-S513.md`; this doc becomes the
**spine**, and the tripwire (A) + daily-line (D) from that doc become two *delivery
surfaces* of the one engine defined here. Pieces B (flag "couldn't-find-a-time" leads) and
C (auto-notify on reopen) stay as specced there and feed signals in here.

---

## 1. The magic question (the organizing principle)

> **A renter discovers this listing today. Can they easily book a viewing?**

If **yes** → stay quiet. If **no** → tell the operator *exactly why* and *exactly what to
do*, proactively. That is worth far more than a generic daily digest, and it is the mission
in one sentence: **help landlords avoid leaving money on the table** — an un-bookable live
listing is money on the table, silently.

Everything below is machinery for answering that question well and turning "no" into a
specific, actionable line.

---

## 2. Grounding: what is org-level vs per-listing (verified 2026-07-18)

This shapes what "per-rental health" can honestly mean today.

- **Availability WINDOWS are ORG-LEVEL.** `availability_rules` /
  `availability_days_off` / `availability_overrides` are all scoped to
  `organization_id`, not property. The booking page is per-property (`/r/[propertyId]`),
  but every listing in the org draws viewing times from **one shared calendar**. So these
  are **org-level** facts: days of future availability, no-evenings, no-weekends,
  "availability ends Tuesday," "no new windows added in 12 days."
- **Bookings / demand / age are PER-LISTING.** `showings.property_id`, `leads.property_id`,
  `properties.created_at`, `properties.status`. So these are **per-listing**: which shared
  slots are taken for this unit, open inquiries, waiting ("couldn't find a time") leads,
  days live.

**Implication.** The health model is a single **org-level availability-supply status** with
**per-listing demand overlays**. True per-listing availability calendars would be a schema
change (property-scope `availability_rules` + the booking RPC + clustering) — **out of scope
here; flag as a future option.** Most of Noam's examples are org-level and land immediately.

---

## 3. The Leasing Health status model (green / yellow / red / black)

One **org-level** status, driven primarily by **days of future bookable availability** =
distinct future calendar days (within the booking horizon) that have ≥ 1 *actually-bookable*
slot (windows − booked − lead-time; the booked-aware count from
`lib/availability-tripwire.ts` §3.2 of the companion doc).

| Status | Meaning | Default rule (tunable per org) |
|---|---|---|
| 🟢 **Green — Healthy** | Comfortable runway | ≥ 7 open days ahead, with reasonable shape |
| 🟡 **Yellow — Watch** | Running thin, or structural gaps | 2–6 open days ahead, **or** a shape gap (no evenings / no weekends) while green on count |
| 🔴 **Red — Action needed** | About to run out | ≤ 1 open day ahead (last viewing is today/tomorrow) |
| ⚫ **Black — Offline** | Live but un-bookable | listing `available` **and 0** future bookable slots |

**Black is the crown jewel** — it catches the common silent mistake: a live listing with no
future viewing times, leaking every renter who arrives. It must be impossible to miss.

Noam's proposed anchors (green ≈ 9, yellow ≈ 4, red = tomorrow, black = none) are close to
the defaults above — **exact green/yellow cutoffs are decision #1.**

---

## 4. The signal set (one computation, per org + per listing)

A pure engine `lib/leasing-health.ts` computes, from the shared calendar + per-listing data,
a `LeasingHealth` object. Each signal is both an input to the status AND a candidate alert.

**Org-level (shared calendar):**
- `futureOpenDays` — count + the actual dates ("Sun, Mon, Tue").
- `nextOpenDay`, `hasToday`, `hasTomorrow`, `lastOpenDay` ("availability ends Tuesday").
- `eveningAvailable` — any bookable slot after a config hour (~17:00). Absence → "all future
  viewings are during business hours."
- `weekendAvailable` — any Sat/Sun bookable slot. Absence → "no weekend availability."
- `daysSinceLastWindowChange` — from `max(created_at)` across availability_rules / overrides /
  days_off. Approximate (deletes aren't timestamped) — good enough for "you haven't added new
  viewing windows in 12 days." Flagged.

**Per-listing (overlay):**
- `bookedOutDays` / `fullyBookedSoon` — shared slots taken by *this* unit's showings ("viewing
  times full," "your last Saturday slot is booked").
- `openInquiries` — leads for this property in `new/replied/contacted`.
- `waitingLeads` — of those, `no_suitable_time = true` (needs **piece B**). "3 renters couldn't
  find a suitable viewing time."
- `daysLive` — from `properties.created_at` (proxy for time-on-market; flag if a truer
  publish timestamp exists later).
- `demandPressure` — `openInquiries` vs `futureOpenDays` ("17 inquiries but only 1 viewing day
  left" = high demand × thin calendar; the sharpest money-left-on-table signal).

---

## 5. The intelligent-alert catalog

Each alert = a rule over §4 + a **recommendation** + scope + how ready it is. Ranked by
severity in the output; only firing alerts render. Noam's examples, mapped:

| # | Alert (when true) | Scope | Recommendation | Ready |
|---|---|---|---|---|
| 1 | **Live but no future viewing times** (BLACK) | listing | "Add viewing windows now — this listing is live and un-bookable." | Now |
| 2 | **Last available viewing is today/tomorrow** (RED) | org | "Add windows past {{lastOpenDay}} before renters run out." | Now |
| 3 | **No availability after {{date}}** | org | "Extend your calendar past {{lastOpenDay}}." | Now |
| 4 | **Only N days of viewing availability** (YELLOW) | org | "Open more times before renters run out." | Now |
| 5 | **No weekend availability** | org | "Add a Saturday/Sunday window — most renters view on weekends." | Now |
| 6 | **All future viewings during business hours** (no evenings) | org | "Add an evening window (after 5pm)." | Now |
| 7 | **Viewing times are full / last {{Sat}} slot booked** | listing | "Your slots are booked out — add more or renters can't get in." | Now |
| 8 | **N inquiries but only M viewing day(s) left** | listing | "Demand is outrunning supply — open more times." | Now |
| 9 | **Live {{N}} days with no weekend availability** | listing×org | "This unit's been up {{N}} days without a weekend slot." | Now |
| 10 | **No new viewing windows added in {{N}} days** | org | "Your calendar may be going stale — refresh it." | Now (approx) |
| 11 | **{{N}} renters couldn't find a suitable time** | listing | "Offer these renters alternate times." | Needs **B** |

Alerts 1–10 are computable from data that exists **today**. Alert 11 needs piece B's flag.

---

## 6. The daily operational briefing (upgraded daily snapshot)

Replaces the generic availability line with a **leasing-health section** at the top of the
existing daily snapshot (`leasing.daily_snapshot`), worst-first. Shape:

```
Good morning — here's your leasing today.

LEASING HEALTH: 🟡 Watch
You have 2 days of viewing availability (Sun, Mon). No times after Monday.
→ Recommendation: add viewing windows before renters run out of times to book.

Accepting bookings today: 3 rentals · Openings tomorrow: 2 · Next opening: Sunday

NEEDS ATTENTION
⚫ 833 Pillette Unit 20 — live 8 days, no weekend availability, 5 open inquiries
🔴 Calendar ends Monday — add Tue+ windows
🟡 No evening viewings this week

(then the existing buckets: new inquiries 24h / showings today / later this week)
```

Principles:
- **Quiet when green.** If health is green and nothing fires, the health section shrinks to a
  one-line "🟢 Healthy — availability for the next N days" and the digest reads as today.
- **Never a to-do backlog** — it's a status view + the single most useful next action.
- **Reuse the existing send gate** (`snapshotHasContent`) — but consider letting a **black or
  red** health force a send on an otherwise-quiet day (a live-but-offline listing is exactly
  worth waking the digest for). Decision #4.

---

## 7. Architecture — build the engine ONCE, feed three surfaces

```
lib/leasing-health.ts   (PURE: calendar + bookings + listings → LeasingHealth + ranked alerts)
        │
        ├── Daily briefing   → app/api/cron/leasing-snapshot (health section; this doc §6)  = "D", upgraded
        ├── Same-day tripwire → app/api/cron/availability-tripwire (push on transition into red/black) = "A"
        └── Dashboard badge  → optional: a health chip on /dashboard (later)
```

The tripwire (A) is simply **"push immediately when health crosses into red/black between
briefings"** — same engine, edge-triggered delivery + the debounce state from the companion
doc. The daily briefing (D) is the **level view**, once a day. No logic is duplicated: both
call `lib/leasing-health.ts`. This is the key design decision — it keeps A, D, and any future
dashboard chip perfectly consistent, so they can never disagree about whether the calendar is
healthy.

---

## 8. Phasing (each independently shippable)

- **S513-H1 — Health engine + briefing (biggest cheap win):** `lib/leasing-health.ts` +
  alerts 1–10 + the daily-snapshot health section (§6). Reads only existing data, **no
  migration**. Catches BLACK (offline listings) immediately. Ship first.
- **S513a — Tripwire push:** the same-day red/black push consuming the engine + debounce
  state (mig 0158, per the companion doc). Ship second.
- **S513b — Flag "couldn't-find-a-time" leads:** unlocks alert #11 + fixes nurture mis-nudge.
- **S513c — Auto-notify waiting leads on reopen:** depends on B.
- **Later (optional):** dashboard health chip; true per-listing availability calendars
  (schema change — only if landlords ask to run different viewing hours per unit).

**Order: H1 → a → b → c.** H1 alone delivers the "good-morning briefing" Noam described and
the offline-listing catch, with zero schema risk.

## 9. Test expectations

- `lib/leasing-health.ts` is pure → `scripts/test-leasing-health.ts` (tsx, cloud): status
  boundaries (black/red/yellow/green at the cutoffs), each alert rule fires only on its
  condition, ranking is worst-first, and green+quiet collapses to the one-liner.
- Golden-render a sample briefing block for a thin calendar and assert the recommendation
  lines.

## 10. Decisions for Noam (pre-build)

1. **Green/yellow cutoffs:** green ≥ 7 open days, yellow 2–6, red ≤ 1, black 0 — or your
   9/4/tomorrow/none anchors, or other?
2. **Evening / weekend definitions:** evening = after 17:00? weekend = Sat+Sun? (per-org tz)
3. **"Stale calendar" threshold:** flag at 12 days since last window change (approx, ignores
   deletes) — or a different number, or drop it for v1?
4. **Does a black/red health FORCE the daily digest to send** on an otherwise-quiet day, or
   stay display-only (tripwire owns the "wake them up")?
5. **Start org-level** (one health status per landlord) as specced, or do you want the
   per-listing availability schema change scoped now? (Recommend org-level first.)
6. **Ship H1 first** (engine + briefing, no migration) before the tripwire — agree?
