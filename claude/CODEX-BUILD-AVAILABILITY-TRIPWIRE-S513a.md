# CODEX BUILD — Availability tripwire (zero + thin), S513a

**Scope: S513a only** — the core same-day zero/thin availability alert. Pieces B
(flag "couldn't-find-a-time" leads) and C (auto-notify waiting leads on reopen) are
**separate follow-on tickets**, do not build them here. Full design + rationale:
`claude/DESIGN-AVAILABILITY-TRIPWIRE-AND-WAITLIST-S513.md`.

**App HEAD at spec time: `97362c6` (S513-H1 is now LIVE).** Latest migration: `0157`.
**Use `0158`.**

Model the **cron skeleton** (auth / per-org loop / dry-force-org params / notification
plumbing) on the S500 weekly reminder — `app/api/cron/viewing-reminder/route.ts`. Model the
**availability + real-bookings assembly** on the **S513-H1 daily-snapshot route**
(`app/api/cron/leasing-snapshot/route.ts`, the block that builds `availability` and calls
`assessLeasingHealth`, ~lines 300–390) — it already loads rules/days_off/overrides + real
future showings into `availability.booked`. Do **not** copy S500's `booked: []`.

---

## ⚠️ What changed vs the design-time draft (read this first)

This ticket was re-cut 2026-07-18 after S513-H1 shipped. Three corrections vs the earlier
draft — they are load-bearing:

1. **Reuse H1's counters — do NOT re-implement them.** S513-H1 already shipped and
   unit-tested `openBookableDays(av, now, days)` and `countOpenBookableSlots(av, now, days)`
   as **named exports of `lib/leasing-health.ts`** (both booked-aware via `generateSlots`,
   both window-clamped). `lib/availability-tripwire.ts` **imports** these; it must not
   duplicate `countOpenBookableSlotsNextN`/`openBookableDaysNextN`.
2. **Availability assembly is already written** in the H1 snapshot route — mirror it, don't
   reinvent from S500 (which is `booked: []` and would read a fully-booked week as healthy).
3. **The "forced admin CC" needs a real mechanism.** `resolveNotificationRecipients` only
   honors `operatorFallback` **when `configured` is empty** — so appending the admin to
   `operatorFallback` (the old draft's suggestion) **silently drops the admin the moment the
   operator sets any custom recipient list**, which is exactly the case the requirement
   guards against. Fix it by adding a new `alwaysInclude` channel (see §Forced admin CC).

---

## Goal

When an org's **actually-bookable** viewing slots for the next N days drop to **zero or
thin**, send a same-day alert to the operator **and always CC the owner_admin**. This is the
mid-week, edge-triggered complement to the weekly Sunday empty-week reminder (S500), which
only fires weekly and only on a fully-empty calendar.

## Behaviour

Per org (only where `availability_tripwire_enabled = true`), every sweep (~15 min):

1. Load availability + booked exactly as the **H1 snapshot route** does: `availability_rules`,
   `availability_days_off`, `availability_overrides`, org
   `booking_timezone / booking_slot_minutes / booking_lead_hours / booking_horizon_days`, and
   real future showings (`showings` where `organization_id = org.id`,
   `outcome.is.null,outcome.eq.scheduled`, `scheduled_at >= now`, `scheduled_at < now + N days`)
   mapped into `availability.booked` (ISO). Reuse the snapshot route's exact selects/filters.
2. Compute, over N = `availability_tripwire_lookahead_days` (default 7), using the H1 exports:
   - `open = countOpenBookableSlots(av, now, N)` (imported from `lib/leasing-health.ts`).
   - `openDays = openBookableDays(av, now, N).length` (imported from `lib/leasing-health.ts`).
3. Severity (`classifyTripwire`): `zero` if `open < 1`; else `thin` if
   `open < availability_tripwire_thin_slots` (default 3) **OR** `openDays <= 1`; else `ok`.
4. **Edge-triggered send decision** (`shouldAlertTripwire`) using
   `organizations.availability_tripwire_last_state` and `availability_tripwire_last_alert_on`
   (org-local date via the org tz — reuse `localDateString` from `lib/leasing-snapshot.ts`):
   - Send when severity ∈ {thin, zero} AND (`last_state` ∈ {null,'ok'} OR escalation
     `thin`→`zero` OR (`last_state` unchanged thin/zero AND `last_alert_on` < today-local)).
   - Never send on improvement (`zero`→`thin`, or →`ok`).
   - **Always** write `last_state = severity` each run (non-dry). On send, set
     `last_alert_on = today-local`. When severity is `ok`, set `last_alert_on = null` (so the
     next drop is fresh).
   - `?dry=1` computes + reports but writes nothing and sends nothing; `?force=1` bypasses the
     debounce (still respects `enabled`); `?org=<id>` scopes to one org.
5. **Recipients** = operator audience via `resolveNotificationRecipients` (configured list, else
   `operatorFallback` from `resolveLeadNotifyEmails(members, [reply_to_email, public_contact_email])`,
   same as S500) **plus every owner_admin member email via the new `alwaysInclude` channel**
   (see below). Cap at `MAX_RECIPIENTS = 10`.

## Forced admin CC — the mechanism (additive, backward-compatible)

The admin CC must survive even when the operator has narrowed `notification_settings.recipients`.
`operatorFallback` cannot do this (it is used only when `configured` is empty). Add a first-class
"always include these addresses" channel:

- **`lib/notifications.ts → resolveNotificationRecipients`**: add optional
  `alwaysInclude?: string[]`. Push each `alwaysInclude` address through the same `push()` dedup
  **before** the configured/fallback list (so the `MAX_NOTIFICATION_RECIPIENTS` slice can never
  truncate the admin away). For `audience === "operator"`, order is: `audienceEmail` →
  `alwaysInclude[]` → (`configured` else `operatorFallback`). Absent/empty ⇒ exact current
  behaviour (every existing caller is unaffected — verify by running the existing
  `scripts/test-*` for notifications).
- **`lib/notifications-server.ts → sendOrgNotification`**: add optional `alwaysInclude?: string[]`
  to the args and thread it into the `resolveNotificationRecipients({...})` call (both the live
  path and any dry/preview path). Default undefined ⇒ no change.
- **The tripwire cron** resolves admin emails from the already-loaded `members` array:
  `members.filter(m => m.role === 'owner_admin').map(m => m.email)` (normalize/drop blanks), and
  passes them as `alwaysInclude`. In the `?dry=1` branch, pass the same `alwaysInclude` into the
  `resolveNotificationRecipients` preview so `recipients` in the dry report already shows the
  admin.

Rationale for `alwaysInclude` over reusing `audienceEmail`: `audienceEmail` is a single address
with a specific meaning ("the natural operator party for this send"); there can be ≥1 owner_admin,
and the tripwire has no single "assigned" party. `alwaysInclude` generalizes cleanly and is reusable
by future operator-safety events.

## Files

1. **`supabase/migrations/0158_availability_tripwire.sql`** (Codex writes the file only; Cowork
   applies to prod via Supabase MCP):
   ```sql
   alter table public.organizations
     add column if not exists availability_tripwire_enabled boolean not null default false,
     add column if not exists availability_tripwire_lookahead_days integer not null default 7,
     add column if not exists availability_tripwire_thin_slots integer not null default 3,
     add column if not exists availability_tripwire_last_state text,
     add column if not exists availability_tripwire_last_alert_on date;
   ```
   No RLS change (existing org policies cover new columns). No event seed.

2. **`lib/availability-tripwire.ts`** (new, pure — no I/O). **Imports the counters, does not
   redefine them:**
   ```ts
   import { openBookableDays, countOpenBookableSlots } from "./leasing-health";
   // (optionally re-export them for the cron/test if convenient)

   export type TripwireSeverity = "ok" | "thin" | "zero";

   export function classifyTripwire(args: {
     open: number; openDays: number; thinSlots: number;
   }): TripwireSeverity;

   export function shouldAlertTripwire(args: {
     severity: TripwireSeverity;
     lastState: string | null;      // 'ok' | 'thin' | 'zero' | null
     lastAlertOn: string | null;    // org-local YYYY-MM-DD
     todayLocal: string;            // org-local YYYY-MM-DD
   }): { alert: boolean; nextLastState: TripwireSeverity; nextLastAlertOn: string | null };
   ```
   `shouldAlertTripwire` encodes the §Behaviour.4 table and returns the state to persist:
   `nextLastState = severity` always; `nextLastAlertOn = todayLocal` when `alert`, `null` when
   `severity === 'ok'`, else unchanged (`lastAlertOn`).

3. **`app/api/cron/availability-tripwire/route.ts`** (new): clone the shape of
   `viewing-reminder/route.ts` (CRON_SECRET `authorized()`, `createAdminClient`, Summary type,
   per-org try/catch, dry/force/org). Select the new org columns. Assemble `availability` +
   `booked` per the H1 snapshot route. Compute open/openDays via the H1 exports, `classifyTripwire`,
   `shouldAlertTripwire`. Event key `leasing.viewing_availability_dropped`. On send call
   `sendOrgNotification({ ..., eventKey, vars, operatorFallback, alwaysInclude: adminEmails,
   action:{label:'Set your viewing times', url: `${APP_URL}/dashboard/availability`} })`. Persist
   `last_state`/`last_alert_on` from `shouldAlertTripwire` (skip writes when `dry`).

4. **`lib/notifications.ts`**: (a) the `alwaysInclude` addition above; (b) register event
   ```
   key: "leasing.viewing_availability_dropped", audience: "operator",
   ```
   Default subject: `Heads up — {{org_name}} has almost no bookable viewing times`
   Default body (clearly the URGENT mid-week one; distinct in tone from the weekly reminder so an
   operator with both on never sees two identical emails):
   ```
   {{org_name}} currently has {{open_slots}} bookable viewing slot(s) across {{open_days}} day(s)
   in the next {{window_days}} days. Renters may be hitting the booking page and finding nothing
   that works. Open more times so viewings keep flowing.
   ```
   Vars supplied by the cron: `org_name, open_slots, open_days, window_days, viewing_times_url`.

5. **`lib/notifications-server.ts`**: the `alwaysInclude` thread-through above.

6. **`.github/workflows/reminders.yml`**: add a step mirroring the existing "Trigger
   viewing-reminder sweep" step, hitting `/api/cron/availability-tripwire` with the same
   `Authorization: Bearer ${{ secrets.CRON_SECRET }}` GET.

7. **`scripts/test-availability-tripwire.ts`** (new, tsx): unit-test the pure helpers.
   - `classifyTripwire`: zero (open=0); thin-by-count (open=2, days=3, thin=3); thin-by-days
     (open=4 all on 1 day); ok (open≥3 across ≥2 days).
   - `shouldAlertTripwire` transition table: null→thin (alert; next thin/today), ok→thin (alert),
     thin→thin same day (suppress), thin→thin next day (alert), thin→zero (alert), zero→ok
     (no alert; nextLastAlertOn null), ok→zero (alert), zero→thin (no alert).
   - (Counters themselves are already covered by `scripts/test-leasing-health.ts`; no need to
     retest them here — but you may add one integration assertion that the imports resolve.)

8. **`scripts/test-notifications*.ts`** (whichever test covers `resolveNotificationRecipients`):
   add a case proving `alwaysInclude` addresses appear **even when `configured` is non-empty**,
   are deduped, and are ordered ahead of the configured list (never truncated by the cap).

## Enable for Agile (data step, after deploy — Cowork via Supabase MCP, not Codex)

```sql
update organizations set availability_tripwire_enabled = true
where id = '921f7c08-98af-428f-a238-36f4a781b0de';
```
Leave every other org off (default false).

## Guardrails / must-nots

- Do **not** touch the S500 reminder cron, `lib/viewing-reminder.ts`, the H1 snapshot route's
  behaviour, `lib/leasing-health.ts` logic (import only), or any booking RPC.
- Do **not** re-implement the bookable-slot counters — import H1's.
- Do **not** pass `booked: []` — the tripwire is worthless if it ignores real bookings.
- Do **not** send on severity improvement, and do **not** level-trigger (no alert every 15 min
  while thin) — the debounce is the whole point.
- The `alwaysInclude` change must be a pure superset of current behaviour: with it absent, every
  existing notification send is byte-identical (confirm via the existing notification tests).
- Keep the alert copy distinct from `leasing.viewing_availability_reminder`.
- `?dry=1` must be side-effect-free (no state writes, no sends).
- Migration goes to prod via Supabase MCP; Codex writes the file only.

## Verify (Cowork, after Codex returns)

1. `device_bash git diff` in MAIN — confirm only the files above; no migration applied by Codex;
   `git diff --check` clean.
2. Stage `lib/availability-tripwire.ts` + `lib/leasing-health.ts` + `lib/booking.ts` +
   `lib/notifications.ts` + the two test scripts to the cloud container; run
   `npx tsx scripts/test-availability-tripwire.ts` and the notifications test → all pass. Re-run
   `npx tsx scripts/test-leasing-health.ts` to confirm the shared counters still pass unchanged.
3. Apply `0158` to prod via Supabase MCP; enable for Agile.
4. Noam pushes; Vercel READY.
5. `GET /api/cron/availability-tripwire?dry=1&org=921f7c08-98af-428f-a238-36f4a781b0de&secret=...`
   — confirm computed `open_slots / open_days / severity` matches a hand-count of Agile's next-7
   availability (Agile is currently ~Jul 21 + Jul 24 open ⇒ expect `thin` via the `openDays <= 1`
   or `< 3 slots` arm), and confirm `recipients` in the dry report includes the owner_admin
   (thadmusco) email even though Agile has configured operator recipients. Dry = no mutation.
