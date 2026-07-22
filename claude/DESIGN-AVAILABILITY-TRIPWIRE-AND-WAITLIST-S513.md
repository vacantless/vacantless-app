# DESIGN — Availability tripwire + "couldn't-find-a-time" waitlist (S513)

**Design thread #3.** Date: 2026-07-18. Status: DESIGN ONLY — nothing ships this session.
App HEAD at design time: `e429050`. Latest migration: `0157`. Next free number: `0158`.

---

## 1. Why (the problem, grounded in a live example)

The operator model is now **week-CLOSED-by-default**: the operator (Aaliyah) opens
availability up for the coming week, rather than the old "always open, close off
exceptions." The new failure mode is quiet: **she forgets to open times, renters hit
the booking page, see nothing (or almost nothing) bookable, and nobody is told until
too late.**

What exists today only half-covers this:

- **S500 weekly viewing-times reminder** (`app/api/cron/viewing-reminder/route.ts`,
  event `leasing.viewing_availability_reminder`, ON for Agile Sun 17:00). It fires
  **weekly**, only when the next 7 days are **fully empty**, and — as Noam experiences
  it — reads as an operator-only nudge. It cannot catch a mid-week drop, and it says
  nothing when the calendar is *thin* rather than *zero*.

**Live example — Basma Preston, 2026-07-18.** She messaged Noam via Messenger, hit the
`/r` booking page, saw only ~2 days of times, none worked, and clicked *"Can't make
these times? Send your details instead →"*. This produced a lead with source
`website` — **indistinguishable from a generic inquiry**. The `leasing.new_lead` alert
did fire (to rentals@ / Peter / Noam), but nothing flagged that this renter *wanted to
book and couldn't*. And when the operator later opens new times, **nothing tells Basma**
— the nurture drip is purely time-based (+2/+5/+10 days from inquiry) and would just
re-nudge her to "come book" at the same thin calendar.

Three distinct gaps fall out of this, specced below as **A**, **B**, **C**. They are
independent and can ship in that order as **S513a / S513b / S513c**.

---

## 2. What's already in the codebase (reuse, don't rebuild)

Verified 2026-07-18 via `device_bash git` in MAIN:

- **Availability model:** `availability_rules` (recurring weekly windows),
  `availability_days_off`, `availability_overrides`; org settings
  `booking_timezone / booking_slot_minutes / booking_lead_hours / booking_horizon_days`.
  All save actions live in `app/dashboard/availability/actions.ts` and **none fire any
  lead-facing notification** on save (they `revalidatePath` + `redirect` only).
- **Slot computation:** `lib/booking.ts → generateSlots(availability, now)` returns days,
  each with `slots[]`. It **excludes** slots earlier than `now + lead_hours` and any
  instant present in `availability.booked` (ISO array of already-taken times).
- **Ready-made counters** in `lib/viewing-reminder.ts`:
  `countOpenViewingSlotsNext7()`, `openViewingDaysNext7()`, `isViewingWeekEmpty()`
  (`count < MIN_OPEN_SLOTS = 1`). **Caveat:** the S500 cron calls these with
  `booked: []`, i.e. it measures "do bookable *windows* exist at all," NOT "are there
  actually-free slots." **The tripwire must subtract real bookings** (see §3.2), or it
  will read a fully-booked week as healthy.
- **Recipient resolution:** `lib/leads-notify.ts → resolveLeadNotifyEmails(members,
  fallbacks)` returns every member holding `manage_leads`, else the first fallback
  address. **Confirmed** `owner_admin` holds ALL capabilities incl. `manage_leads`
  (`lib/roles.ts`), so the admin (thadmusco / Noam) is structurally a valid recipient.
- **Notification event registry:** `lib/notifications.ts` (code-registered events with
  `key / audience / subject / body`); `resolveNotificationRecipients({audience,
  configured, operatorFallback})`; `sendOrgNotification(...)` in
  `lib/notifications-server.ts`.
- **Nurture:** `app/api/cron/nurture/route.ts` + `lib/nurture.ts`. Time-based
  (+2/+5/+10d), statuses `new/replied/contacted`, gated on `nurture_enabled` and
  `property.status = 'available'`. Copy in `STEP_COPY`. It does **not** consider whether
  any slots are bookable (that's the mis-nudge risk in B).
- **Fallback lead path:** `app/r/[propertyId]/inquiry-form.tsx` has client state
  `skipTime` (set by the "Send your details instead" link) and a `hasSlots` prop, but
  **neither is submitted** — the server only sees an empty `slot`. `submitLead`
  (`app/r/[propertyId]/actions.ts`) → RPC `submit_public_lead` stamps `source='website'`.
  So today a "couldn't-find-a-time" lead and a generic inquiry are byte-identical
  server-side. `leads.source` / `leads.source_detail` columns exist; lead `status` enum
  = `new/replied/contacted/booked/showed/applied/leased/lost`.

---

## 3. A — Zero + thin availability tripwire (S513a, the core)

**Goal:** the moment bookable slots for the next N days drop to **zero OR thin**, send a
same-day alert to the operator **and force-CC the admin**, instead of waiting for the
weekly Sunday reminder.

### 3.1 Trigger semantics (Noam chose: Zero + thin)

Per org, over a lookahead window of **N days** (default **7**, configurable per org):

- `open = ` count of **actually-bookable** slots in the window (windows − booked − lead-time).
- `openDays = ` count of distinct days in the window that have ≥1 bookable slot.
- **Severity:**
  - `zero` when `open < 1`.
  - `thin` when `open < thin_slots_threshold` (default **3**) **OR** `openDays ≤ 1`.
  - `ok` otherwise.

The `openDays ≤ 1` arm is the **emergency floor**: a single remaining open day (or a
week that has collapsed below 3 total bookable slots) is effectively a cliff and warrants
an immediate push + admin CC.

> **DECISION (S514, 2026-07-18) — corrected.** An earlier draft claimed this arm "catches
> Basma's 2 days." It does **not**: `≤ 1` does not fire at 2 open days, and — verified against
> Agile's live calendar on 2026-07-18 — Agile then had 11 bookable slots across 2 open days
> (Jul 21 + Jul 24) and correctly classifies as `ok`. That is the intended behaviour, because
> the tripwire is deliberately **not** the tool for the Basma case. Basma had ample supply
> (11 slots); her problem was that neither of those 2 evenings worked *for her* — a per-renter
> demand↔supply mismatch, not an org-level staffing gap. Stretching the tripwire to fire at
> `≤ 2` days would make the emergency alarm fire on Agile's *normal* steady state (it runs
> 2–3 open days most weeks), training the operator to ignore it before a real cliff arrives.
> The three tiers stay clean and non-overlapping:
>
> - **Tripwire (A, this doc):** emergency floor — `≤ 1` open day **or** `< 3` bookable slots.
>   Rare, high-signal, force-CC the admin.
> - **Daily-briefing Yellow (S513-H1, LIVE):** ambient "watch" — `< 7` open days. This is the
>   tier that flags Agile's current 2-day week; it is already doing so.
> - **B + C (below):** the actual Basma fix — flag the "couldn't-find-a-time" lead, offer
>   alternates, auto-notify on reopen.
>
> `thin_slots` is per-org configurable (column, default 3). The `≤ 1` open-days arm is
> hardcoded; make it a per-org column only when a second org needs a different value (YAGNI).

### 3.2 How to count "actually bookable" (the key correction vs S500)

Add a booked-aware counter rather than reusing the `booked: []` call. In
`lib/viewing-reminder.ts` (or a new `lib/availability-tripwire.ts`):

```
countOpenBookableSlotsNextN(availability, now, days)   // availability.booked = real taken instants
openBookableDaysNextN(availability, now, days)
```

Load `availability.booked` from `showings` where `organization_id = org.id`,
`outcome in (null,'scheduled')`, `scheduled_at >= now`, `scheduled_at < now + N days`
(mirror the auto-assign week query). Everything else (rules / days_off / overrides /
slot_minutes / lead_hours) loads exactly as the S500 cron already does. Clamp the
lookahead horizon to N the same way `reminderAvailability()` clamps to 7.

### 3.3 Edge-triggered debounce (critical — the sweep runs every ~15 min)

Level-triggered would spam an alert every 15 minutes while the calendar stays thin. Use
**state-transition** alerting, stored on `organizations`:

- `availability_tripwire_last_state text` — `'ok' | 'thin' | 'zero'` (nullable = never evaluated).
- `availability_tripwire_last_alert_on date` — org-local date of the last alert sent.

Send an alert when:

1. severity is `thin` or `zero`, **AND**
2. it is a **worsening or first-seen transition** — `last_state` is `null`/`ok`, OR it
   escalated `thin → zero`, OR
3. it is **still** `thin`/`zero` but `last_alert_on` is an earlier org-local date than
   today (**at most one re-alert per day** while unresolved).

Always write `last_state` every run (even when `ok`, so a later drop re-fires). When
severity returns to `ok`, clear `last_alert_on` so the next drop is treated as fresh.
Do **not** re-alert on `zero → thin` improvement (it's getting better).

### 3.4 Recipients — operator + FORCED admin CC

Requirement: "CC the admin, not just the operator." Structurally `resolveLeadNotifyEmails`
already includes `owner_admin`, but to guarantee it even if the operator later narrows
`notification_settings.recipients`, resolve recipients as:

```
recipients = union(
  resolveNotificationRecipients({audience:'operator', configured, operatorFallback}),
  everyOwnerAdminMemberEmail    // ALWAYS included, additive, like showing_assigned's audienceEmail
)
```

i.e. the owner_admin email(s) are appended unconditionally and deduped. This is the
"admin always hears about a staffing gap" guarantee Noam asked for.

### 3.5 Delivery — new event + new cron

- **New event** `leasing.viewing_availability_dropped` (audience `operator`), registered
  in `lib/notifications.ts`. Default subject e.g. *"Heads up — {{org_name}} has almost no
  bookable viewing times"*; body names severity, `open_slots`, `open_days`, `window_days`,
  and CTAs to `viewing_times_url` (`/dashboard/availability`). Keep it distinct in tone
  from the weekly reminder so the two don't read as duplicates.
- **New cron** `app/api/cron/availability-tripwire/route.ts`, modeled 1:1 on the S500
  cron: `CRON_SECRET` auth, `?dry=1` / `?force=1` / `?org=` params, per-org loop with
  per-org try/catch, service-role admin client. Added to the same every-15-min GitHub
  Actions pinger that drives the other crons.
- **Per-org gate:** new column `availability_tripwire_enabled boolean default false`.
  Enable for Agile as a one-time data step (like S500 was), never globally-on by default.
- **Config columns:** `availability_tripwire_lookahead_days int default 7`,
  `availability_tripwire_thin_slots int default 3`.

### 3.6 Migration 0158 (A)

```
alter table organizations
  add column if not exists availability_tripwire_enabled boolean not null default false,
  add column if not exists availability_tripwire_lookahead_days int not null default 7,
  add column if not exists availability_tripwire_thin_slots int not null default 3,
  add column if not exists availability_tripwire_last_state text,
  add column if not exists availability_tripwire_last_alert_on date;
```

No RLS change (org-scoped columns, existing policies cover them). No new event seed
(events are code-registered).

---

## 4. B — Flag the "couldn't-find-a-time" leads (S513b)

**Goal:** make a renter who *wanted to book and couldn't* distinguishable from a generic
website inquiry, so the operator can offer alternate times and the nurture drip stops
mis-nudging them.

### 4.1 Capture the signal at the form

In `inquiry-form.tsx`, submit a hidden field that encodes the booking context at submit
time:

- `no_suitable_time = "1"` when EITHER `skipTime` is true (renter clicked "send your
  details instead" after being shown times) **OR** `hasSlots` is false (page offered zero
  bookable times at load). Otherwise omit it.
- Optionally `no_suitable_time_reason = 'skipped' | 'none_shown'` for analytics/copy.

No-JS safety: when `hasSlots` is false the form renders details-only, so a static hidden
`no_suitable_time=1` can be emitted server-side in that branch too; the `skipTime` case
requires JS (acceptable — a no-JS renter who's shown times and submits blank still lands
as a plain inquiry, which is the current behaviour).

### 4.2 Persist it

- **New column** `leads.no_suitable_time boolean not null default false` (migration 0158
  or a B-specific migration).
- `submitLead` reads the field and passes `p_no_suitable_time` to `submit_public_lead`;
  the RPC stamps the column. (Keep `source='website'` unchanged so existing source
  analytics don't shift; the flag is orthogonal.) RPC is `SECURITY DEFINER`; add the param
  with a default so older callers/tests don't break.

### 4.3 Surface it to the operator

- **Lead detail** (`lib/lead-detail.ts` / the lead page): a badge — *"Wanted to book —
  no suitable time"* — near the source label.
- **`leasing.new_lead` email:** when `no_suitable_time`, inject a line into the existing
  new-lead alert body (e.g. *"⚠ This renter couldn't find a workable viewing time — offer
  alternates."*) via a new template var, defaulting empty so other orgs are unaffected.
  The alert already fires (proven on Basma), so this is additive copy, not a new send.

### 4.4 Fix the nurture mis-nudge

For a lead with `no_suitable_time = true`, the generic "come book" drip is wrong while
the calendar is still thin. Options (pick in build):

- **Minimum:** in `nurtureStepDue` / the nurture cron, when `no_suitable_time` is set and
  the org currently has `open < thin_threshold` (reuse §3.2), **skip** the time-based
  step (don't advance `nurture_step_sent`) — the reopen notice (C) becomes their next
  touch instead. Mirrors the S493 "skip nurture when unavailable" pattern.
- **Better:** give these leads a **distinct copy variant** that acknowledges the gap
  ("we're lining up more viewing times and will let you know the moment they're open")
  rather than "come book now." Requires a small branch in `STEP_COPY` selection.

---

## 5. C — Auto-notify waiting leads when times open (S513c)

**Goal:** when the operator opens new bookable capacity, the leads who were waiting
(flagged in B) get *"new viewing times just opened for {{address}} — book here"*
automatically, instead of only via the generic time-based drip or manual outreach.

### 5.1 Trigger — decouple from the save action

Server actions shouldn't fan out email. Instead:

- When any capacity-**adding** save runs (`addAvailabilityWindow`,
  `addAvailabilityOverride`, `removeDayOff`) in `availability/actions.ts`, stamp
  `organizations.availability_reopened_at = now()`. (Deleting a window / adding a day off
  never triggers C.)
- A **sweep** picks it up — either a new `app/api/cron/availability-reopened-notify/route.ts`
  or a branch folded into the existing tripwire cron (same every-15-min pinger). Keeping
  it in the tripwire cron is attractive: that cron already computes bookable slots per org.

### 5.2 Who gets notified

Leads where ALL hold:

- `organization_id = org.id`, `no_suitable_time = true`,
- `status in ('new','replied','contacted')` (not booked/lost),
- property still `available`,
- `created_at` within a freshness cap (reuse `NURTURE_MAX_AGE_MS` = 30d),
- **not already told about THIS reopen:** `leads.reopen_notified_at is null OR
  reopen_notified_at < organizations.availability_reopened_at`.

**Guard:** only send if there are **actually open bookable slots now** (re-check §3.2) —
never send "times just opened" into a still-empty calendar (e.g. operator added a window
entirely in the past / behind lead-time). Cap per sweep per org (e.g. ≤ 25) to avoid a
blast; stamp `reopen_notified_at = now()` on each notified lead so it's once-per-reopen.

### 5.3 Delivery — renter-facing branded email

This is a **renter-facing** email (like nurture / auto-reply), NOT an operator
notification-settings event. Add `sendViewingTimesOpenedEmail(...)` in `lib/email.ts`
mirroring `sendNurtureEmail`: branded shell, Reply-To = org `reply_to_email` (so replies
reach the operator — this is the S511 reply-routing lane), CTA → the renter's `/r/{propertyId}`
booking link (carry any original tracking `?p=`). Log a lead-timeline note ("Notified —
new viewing times opened").

### 5.4 Migration (C)

```
alter table leads add column if not exists reopen_notified_at timestamptz;
alter table organizations add column if not exists availability_reopened_at timestamptz;
```

---

## 5b. D — Daily-summary availability line (S513d) — Noam add, 2026-07-18

**Goal:** make the calendar's health visible **every day, passively**, without waiting for
a threshold to trip. The tripwire (A) is edge-triggered ("you just dropped"); this is the
ambient, level view ("here's where you stand today"). Cheapest of all four pieces.

- The daily snapshot (`leasing.daily_snapshot`, cron `app/api/cron/leasing-snapshot/route.ts`,
  block built by `buildSnapshotBlock(buckets, tz)` in `lib/leasing-snapshot.ts`) already
  digests four buckets. Add one line to the `{{snapshot}}` block:
  *"Bookable viewing times (next 7 days): X slots across Y days"* — using the **same
  booked-aware counter** from `lib/availability-tripwire.ts` (§3.2), so A and D agree.
- Optionally make the line self-highlight when thin/zero (e.g. prefix with "⚠" when
  `open < thin_slots` or `openDays ≤ 1`) so it reads at a glance.
- **Do NOT change the send gate.** `snapshotHasContent()` still decides whether the email
  goes out; the availability line is display-only and rides an email that was going to send
  anyway. The "fire because it dropped" job stays with A, so a zero-availability day on an
  otherwise-quiet day is caught by the tripwire, not by forcing a snapshot send. (If Noam
  later wants the snapshot to send *because* availability is zero, that's a one-line change
  to `snapshotHasContent`, but keep the two concerns separate for now.)
- Build cost: load rules/days_off/overrides + booked in the snapshot cron (it already
  loads showings for the "today/this week" buckets — reuse that read where possible),
  compute the counter, append the line. New `{{open_slots}}`/`{{open_days}}` tokens on the
  event, or just bake the line into `buildSnapshotBlock`. No migration.
- **Sequencing:** depends on A only for the shared counter in `lib/availability-tripwire.ts`.
  Ship it alongside or right after S513a.

## 6. Recommended build staging

- **S513a — tripwire** (highest value, self-contained): mig 0158 (org columns) +
  `lib/availability-tripwire.ts` counters + event `leasing.viewing_availability_dropped` +
  cron `availability-tripwire` + pinger entry + enable-for-Agile data step. Ships alone.
- **S513b — lead flag**: `leads.no_suitable_time` + form hidden field + RPC param +
  lead-detail badge + new-lead email line + nurture skip/variant. Depends on nothing in a;
  can ship before or after.
- **S513c — reopen notify**: `leads.reopen_notified_at` + `organizations.availability_reopened_at`
  + save-action stamp + sweep + `sendViewingTimesOpenedEmail`. **Depends on B** (needs the
  `no_suitable_time` flag to know who's waiting).

- **S513d — daily-summary availability line** (ambient, no migration): one line in the
  daily snapshot reusing a's counter. Pairs naturally with a.

Order to ship: **a (+ d) → b → c**. Each is independently deployable and testable; a is the
one that directly closes the staffing-blind-spot Noam flagged, and d is the near-free
ambient companion.

## 7. Test expectations (pure-logic first, per house style)

- `lib/availability-tripwire.ts` pure counters + the severity/debounce decision function
  get a `scripts/test-availability-tripwire.ts` (tsx, run in the cloud container): zero,
  thin-by-count, thin-by-days, ok; and the transition table (ok→thin alert, thin→thin
  same-day suppress, thin→thin next-day re-alert, thin→zero escalate, zero→ok clear,
  ok→zero alert).
- B: a test that `no_suitable_time` round-trips form→RPC→column and drives the email var.
- C: a test that the waiting-lead query + "open slots now" guard select the right leads
  and stamp `reopen_notified_at`.

## 8. Open decisions for Noam (pre-build)

1. **Defaults:** N = 7 days, thin = < 3 slots OR ≤ 1 open day. OK, or different?
2. **Re-alert cadence** while unresolved: once per day (spec'd). Or only on escalation
   (thin→zero) with no daily nag?
3. **Nurture for flagged leads (B §4.4):** minimum (skip) vs better (distinct copy)?
4. **C trigger home:** its own cron vs a branch inside the tripwire cron?
5. Enable the tripwire for Agile only, or ship enabled-off and flip in-session?
