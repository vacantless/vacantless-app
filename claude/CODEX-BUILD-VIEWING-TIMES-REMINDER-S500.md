# Codex Build Ticket — S500: Weekly "set your viewing times" operator reminder (smart, opt-in)

**Date:** 2026-07-16 · **Author:** Cowork (grounded against real code on the Mac) · **Status:** IMPLEMENTATION-READY — build on the Mac
**Base:** HEAD `b8a3ac3` (S499b, clean tree), migration ledger through `0150`. **This slice ADDS migration `0151`.**
**Repo:** `.../Agile Lead to Lease Engine/vacantless-app`
**Why:** The viewing calendar is now opt-in (unset days default to closed, S499-era ops change). That removed "silently open + uncovered" but introduced "silently empty" — an operator who forgets to set next week's hours has a calendar renters can't book, and nobody notices. This is the generalized, in-product fix (replaces a bespoke per-org scheduled task): a per-org weekly reminder that only nudges when it's actually needed.

> ### Design in one line
> A new operator notification event + a weekly-gated cron route, modeled **exactly** on the existing `leasing-snapshot` daily digest (`app/api/cron/leasing-snapshot/route.ts`) — same auth, same per-org self-gating via a `_last_sent_on` stamp + org hour column, same notification substrate for copy/recipients/on-off, same operator-fallback recipients, same fire-on-data pattern. The only differences: it fires **weekly on an operator-chosen weekday** instead of daily, and it sends **only when the next 7 days have no bookable availability** (quiet when covered).

---

## PART A — Settings (organizations columns + Viewing Times UI)

**A1. Migration `0151_viewing_reminder_settings.sql`** — add to `organizations` (idempotent `add column if not exists`):
- `viewing_reminder_enabled boolean not null default false` — the toggle.
- `viewing_reminder_weekday smallint not null default 0` — 0=Sunday … 6=Saturday. `check (viewing_reminder_weekday between 0 and 6)`.
- `viewing_reminder_hour smallint not null default 17` — local hour to send. `check (viewing_reminder_hour between 0 and 23)`.
- `viewing_reminder_last_sent_on date` — self-gate stamp (mirrors `leasing_snapshot_last_sent_on`).

Default is **off** (explicit opt-in, matching how the operator "sets a reminder for themselves"). See Open Q1 on whether to default-on.

**A2. Viewing Times UI** — `app/dashboard/availability/page.tsx`, in the **Booking Settings** card (where timezone / slot / min-notice / "Agent confirms viewings" already live). Add a small block:
- A checkbox **"Email me a weekly reminder to set my viewing times"** (`name="viewing_reminder_enabled"`).
- A weekday `<select>` (`name="viewing_reminder_weekday"`, Sun–Sat) — shown/relevant when enabled; default Sunday.
- (Optional, keep if trivial) an hour select; otherwise default 17:00 and omit from the UI for v1.
- Copy under it: *"If your calendar has no open viewing times for the coming week, we'll email you on this day so renters never hit an empty calendar. Turn it off any time."*

**A3. Save** — extend `updateBookingSettings` in `app/dashboard/availability/actions.ts` (it already updates the org booking columns from this form) to read+persist the three fields: `viewing_reminder_enabled` (checkbox → boolean), `viewing_reminder_weekday` (validate 0–6), `viewing_reminder_hour` (validate 0–23, default 17). Don't touch the existing booking fields' handling.

---

## PART B — Notification event (code registry, NO migration)

`lib/notifications.ts` → append one entry to `NOTIFICATION_EVENTS`:
- `key: "leasing.viewing_availability_reminder"`, `audience: "operator"`, send-mode `notify` (same shape as `leasing.showing_outcome_nudge` / `leasing.daily_snapshot`).
- Default subject + body templates, operator-facing, with tokens: `{org_name}`, `{open_days_next_7}` (or a "your calendar is empty for the coming week" line), and a `{viewing_times_url}` action link to `/dashboard/availability`.
- Example subject: *"Your viewing calendar is empty for next week"*. Body: brief, "renters can't book a viewing until you add times — set them in Viewing Times", with the action button.

**Verify (Open Q4):** confirm `notification_settings.event_key` has **no** enum CHECK constraint (grep of migrations shows none — events are validated against the code registry, not a DB enum). If a CHECK exists, extend it in `0151`. Otherwise no DB change for the event.

---

## PART C — Pure logic (`lib/viewing-reminder.ts`, fully unit-tested)

Mirror `lib/leasing-snapshot.ts` (pure, no I/O):

**C1. `shouldSendViewingReminder({ nowMs, tz, weekday, hour, lastSentOn })` → `{ send: boolean, localDate: string, reason?: string }`**
- Compute the org-local date/weekday/hour from `nowMs` + `tz`.
- `send = true` only when: local weekday === `weekday` AND local hour >= `hour` AND not already sent this week (`lastSentOn` is null or its ISO week differs from today's / is > 6 days ago). Otherwise `send=false` with a reason (`wrong_day` / `before_hour` / `already_sent`).
- `localDate` = today's local `YYYY-MM-DD` for stamping. (Model on `shouldSendSnapshot`.)

**C2. `isViewingWeekEmpty(availability, now)` → boolean** — the "smart" gate.
- **Reuse `generateSlots` from `lib/booking.ts`** (do NOT fork the availability rules → do not reimplement weekly-rule/override/day-off precedence). Build the org `Availability` object (timezone, slot, lead hours, horizon, weekly rules, overrides, days-off) and run `generateSlots` over **the next 7 days**; empty = **zero open slots** in that window. (v1 threshold = strictly empty; see Open Q2.)
- Booked-instant exclusion is optional for v1 (if any window exists, it's "not empty"); if `generateSlots` already needs booked instants, pass them, else pass none.

Add `scripts/test-viewing-reminder.ts`: cases for the weekly gate (right day/hour/once-per-week, wrong-day skip, before-hour skip, already-sent skip) and `isViewingWeekEmpty` (a covered next-7 = false; all-days-off / no-rules next-7 = true; an override in the window = false).

---

## PART D — Cron route (`app/api/cron/viewing-reminder/route.ts`)

Copy the **structure** of `leasing-snapshot/route.ts` and adapt:
- `export const dynamic = "force-dynamic"; export const runtime = "nodejs";`
- Same `authorized(req)` (CRON_SECRET Bearer or `?secret=`), same `createAdminClient()` guard, same test affordances `?org=`, `?force=1`, `?dry=1`.
- Select orgs with the reminder columns + branding + booking config (`booking_timezone`, slot/lead/horizon, `viewing_reminder_enabled/_weekday/_hour/_last_sent_on`, `brand_color`, `logo_url`, `reply_to_email`, `public_contact_email`).
- Per org (wrapped in try/catch for **per-org isolation** — one org's throw must not abort the sweep):
  1. If `!viewing_reminder_enabled` → skip.
  2. `shouldSendViewingReminder(...)`; if `!force && !dry && !send` → skip with reason.
  3. Load the org's availability rows (`availability_rules`, `availability_overrides`, `availability_days_off`) + booking config → build `Availability` → `isViewingWeekEmpty`.
  4. **If NOT empty (calendar is covered):** send nothing, but **stamp `viewing_reminder_last_sent_on = localDate`** so it doesn't recompute all day, then skip. (This is the "stay quiet when covered" behavior.)
  5. **If empty:** `sendOrgNotification({ client: admin, org, eventKey: "leasing.viewing_availability_reminder", vars, operatorFallback, action: { label: "Set your viewing times", url: `${APP_URL}/dashboard/availability` } })`, then stamp `viewing_reminder_last_sent_on`.
- **Recipients:** same operator fallback as snapshot — `memberships` → auth user emails → `resolveLeadNotifyEmails(members, [reply_to_email, public_contact_email])`, capped. The substrate (`notification_settings`) still governs on/off-of-copy + configured recipients per the event.
- Return the same `Summary` shape (`scanned/sent/skipped/errors/details`).

**PART E — Wire the sweep** — `.github/workflows/reminders.yml`: add one `curl` step for `/api/cron/viewing-reminder` (copy an existing step, e.g. the leasing-snapshot one). The route self-gates to the org's weekday+hour, so a 15-min ping cadence is safe (idempotent, same as the others).

---

## Scope guardrails (v1 — do NOT gold-plate)
- **Email only.** No SMS this slice.
- **Smart gate:** send only when the next 7 days are genuinely empty. A covered org never gets pinged (that's the anti-fatigue design).
- **No** per-org custom thresholds, **no** dashboard banner, **no** "you're all set" positive email — silence when covered is the v1 "all good" signal. (Banner + reduce-toil recurring-availability templates are the deliberately-deferred next steps.)
- Reuse `generateSlots`; do not reimplement availability precedence.

## Invariants to preserve
- Do not touch the S499 reschedule work, S498/S498b surfaces, the other cron routes, `get_public_availability`, or the availability add/remove actions.
- Per-org isolation in the sweep (try/catch per org).
- Idempotent migration (`add column if not exists`, guarded checks).
- The route must **no-op safely** when `CRON_SECRET` or the service role isn't configured (mirror snapshot's guards).

## Verification (run on the Mac; report)
```
npx tsx scripts/test-viewing-reminder.ts     # new pure tests
./node_modules/.bin/tsc --noEmit && npm run lint && npm run build
```
Apply `0151` to a **QA sandbox** org (North Star `b733a191` or Maple Door `a0e2e45c`) via the Supabase MCP, then exercise the route against the sandbox only:
- `GET /api/cron/viewing-reminder?dry=1&org=<qa-id>` (CRON_SECRET) → renders the email + recipients WITHOUT sending; confirm it reports "would send" only when that org's next 7 days are empty.
- Flip the sandbox org's `viewing_reminder_enabled=true`, weekday=today, add/remove availability to toggle empty vs covered, and confirm `?force=1` sends when empty and stays quiet (stamps only) when covered.
- Do NOT test-send against Agile (live operator inbox). Cowork will do the live QA + apply `0151` to prod after the diff is verified.

## Open questions for Codex
1. **Default on/off:** ship `viewing_reminder_enabled` default **false** (explicit opt-in, per the "operator sets their own reminder" framing) vs default **true** (safe, since it self-silences when covered). Recommendation: false for v1; flag for Noam.
2. **"Empty" threshold:** strictly zero open slots in the next 7 days (v1) vs "thin" (< N). Recommend strict-zero to avoid noise; make the threshold a single named constant so it's easy to tune later.
3. **Weekly gate mechanics:** confirm the once-per-week rule (weekday match + hour reached + not-already-sent-this-week) can't double-fire across a 15-min ping window — the `_last_sent_on` stamp set on the send/quiet path should prevent it, same as snapshot's daily stamp.
4. **event_key CHECK:** confirm there's no DB CHECK constraint on `notification_settings.event_key` that a new key would violate (grep suggests none). If there is, relax it in `0151`.

## Files expected to change (focused diff)
- `supabase/migrations/0151_viewing_reminder_settings.sql` (new — Part A1)
- `app/dashboard/availability/page.tsx` (toggle + weekday control)
- `app/dashboard/availability/actions.ts` (`updateBookingSettings` persists the 3 fields)
- `lib/notifications.ts` (register `leasing.viewing_availability_reminder`)
- `lib/viewing-reminder.ts` (new — pure gate + empty-week check)
- `app/api/cron/viewing-reminder/route.ts` (new — the sweep)
- `.github/workflows/reminders.yml` (add the curl step)
- `scripts/test-viewing-reminder.ts` (new)

**Before final, report:** what changed, test/tsc/lint/build results, the dry-run output for a sandbox org (empty vs covered), and anything intentionally deferred.
