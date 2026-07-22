# CODEX BUILD — Auto-notify waiting leads when viewing times reopen (S513c)

**Scope: S513c only** — when an operator opens new bookable viewing capacity, the leads who
previously *wanted to book but couldn't* (flagged `no_suitable_time` by S513b) get one
renter-facing *"new viewing times just opened for {{address}} — book here"* email, automatically,
instead of only via the time-based nurture drip or manual outreach. Design:
`claude/DESIGN-AVAILABILITY-TRIPWIRE-AND-WAITLIST-S513.md` §5 (C). This is the third and final
cut of design thread #3; it **depends on S513b's `leads.no_suitable_time`** (LIVE, mig 0160) and
**reuses S513a's availability engine** (`lib/availability-tripwire.ts`, LIVE).

App HEAD at spec time: `229e110` (main; S513a/S514/S513b/S515/S515b live). Latest migration on
disk: `0161`. **Use `0162`.**

**Live example this exists to fix (Basma Preston, 2026-07-18):** she hit `/r`, was shown ~2 days
of times, none worked for her, clicked *"Can't make these times? Send your details instead →"* →
a lead now correctly flagged `no_suitable_time=true` (S513b). When Aaliyah later opens new
viewing windows, **nothing tells Basma.** S513c closes that loop.

---

## ★ THE ONE DECISION THAT MUST NOT DRIFT — read before coding

**The "reopen" signal is "the operator ADDED bookable capacity," NOT "the tripwire recovered."**

It is tempting to key S513c off the S513a tripwire's `zero/thin → ok` recovery edge (the
tripwire already runs and stamps `availability_tripwire_last_state`). **Do not.** Basma's org was
never in `zero`/`thin` — verified 2026-07-18 it had 11 bookable slots across 2 open days and
classified `ok` the *entire* time. Her problem was a per-renter demand↔supply mismatch, not an
org-level outage. A recovery-edge trigger would **miss every `no_suitable_time` lead on a
healthy-but-thin calendar** — i.e. exactly the population S513c is for.

So the trigger is: **the operator performs a capacity-ADDING availability save → stamp
`organizations.availability_reopened_at = now()`.** A sweep then notifies waiting leads whose
last notification predates that stamp, *guarded* by "there are actually open bookable slots right
now." This is independent of the tripwire's severity and independent of `availability_tripwire_enabled`.

---

## Verified code refs (2026-07-18, via `device_bash git` in MAIN)

- **`app/dashboard/availability/actions.ts`** — the save actions. Capacity-**adding** (these three
  stamp the reopen): `addAvailabilityWindow` (line ~116), `addAvailabilityOverride` (line ~224),
  `removeDayOff` (line ~210). Capacity-**removing** (must NOT stamp): `deleteAvailabilityWindow`,
  `addDayOff`, `removeAvailabilityOverride`. Each action ends with `revalidatePath(...)` +
  `redirect(...)` and fires **no** notification today. `updateBookingSettings` /
  `updateClusteringSettings` are deliberately out of scope (a horizon/lead-hours tweak is not a
  "new times opened" event).
- **`lib/availability-tripwire.ts`** — re-exports `countOpenBookableSlots(availability, now, days)`
  and `openBookableDays(...)` from `lib/leasing-health.ts`. **Reuse `countOpenBookableSlots` for
  the "open now" guard — do not rebuild a counter.**
- **`app/api/cron/availability-tripwire/route.ts`** — copy its **availability-load block** as the
  template: `Promise.all` over `availability_rules` / `availability_days_off` /
  `availability_overrides` / future `showings` (`outcome.is.null,outcome.eq.scheduled`,
  `scheduled_at >= now`, `< now + N days`, ascending), then build the `Availability` object
  (`slot_minutes`/`lead_hours`/`horizon_days`/`booked`/`rules`/`days_off`/`overrides`). Also copy
  its `authorized()` (CRON_SECRET), `createAdminClient()`, `safeErrorMessage()`, per-org
  try/catch + `stage` tracker, and `?dry=1`/`?force=1`/`?org=` param handling.
- **`app/api/cron/nurture/route.ts`** — copy its **lead-selection shape**: service-role select on
  `leads` with `status in NURTURABLE_STATUSES`, `created_at > now - NURTURE_MAX_AGE_MS`, joining
  `properties(status, address, rent_cents)` + `organizations(...)`; per-row try/catch; on send,
  `insert into messages` a timeline note. Reuse `NURTURABLE_STATUSES` (`['new','replied','contacted']`)
  and `NURTURE_MAX_AGE_MS` (30d) from `lib/nurture.ts` — do not redefine.
- **`lib/email.ts`** — `sendNurtureEmail` (line ~1292) and `sendWaitlistVacancyAlert` (line ~1161)
  are the pattern for a renter-facing branded email. Shared helpers already exist:
  `APP_BASE_URL`, `DEFAULT_SENDER_EMAIL`, `BREVO_ENDPOINT`, `DEFAULT_BRAND_COLOR`, `replyToOf()`,
  `firstName()`, `escapeHtml()`, `listingUrl(propertyId)` (= `${APP_BASE_URL}/r/${encodeURIComponent(propertyId)}`,
  line ~971), and the `SendResult` type. **Reuse them; add no new transport.**
- **`.github/workflows/reminders.yml`** — the every-15-min pinger. Each cron is a `curl -sS -X GET`
  step with `Authorization: Bearer ${{ secrets.CRON_SECRET }}`. The `availability-tripwire` step is
  at line ~86; add the new one right after it, same shape.
- `leads.reopen_notified_at` and `organizations.availability_reopened_at` **do not exist yet** —
  mig 0162 adds them.

---

## File 1 — `supabase/migrations/0162_reopen_notify.sql`  (Codex writes; Cowork/Noam applies)

```sql
alter table public.leads
  add column if not exists reopen_notified_at timestamptz;

alter table public.organizations
  add column if not exists availability_reopened_at timestamptz;
```

No RLS change (org-scoped columns; existing policies cover them). No RPC. Both nullable
(null `availability_reopened_at` = never reopened → org contributes nothing; null
`reopen_notified_at` = lead never notified → eligible on first reopen).

## File 2 — `app/dashboard/availability/actions.ts`  (stamp the reopen)

In **exactly the three capacity-ADDING actions** — `addAvailabilityWindow`,
`addAvailabilityOverride`, `removeDayOff` — after the successful insert/delete and **before**
`revalidatePath`, set `availability_reopened_at = now()` on the org:

```ts
await supabase
  .from("organizations")
  .update({ availability_reopened_at: new Date().toISOString() })
  .eq("id", orgId);
```

`addAvailabilityWindow` and `addAvailabilityOverride` already resolve `const org = await
getCurrentOrg()` (so use `org.id`) and `const supabase = createClient()` — reuse both; stamp after
the `.insert(...)`. **`removeDayOff` is different:** it currently has NO `getCurrentOrg()` — it
resolves the org implicitly via RLS on `.delete().eq("id", id)`. Add `const org = await
getCurrentOrg(); if (!org) return;` at its top (it already calls `requireCapability`), then stamp
`.eq("id", org.id)` after the successful delete. Do not add a new client — reuse each action's
`createClient()`. **Do NOT stamp** in `deleteAvailabilityWindow`, `addDayOff`,
`removeAvailabilityOverride`, `updateBookingSettings`, `updateClusteringSettings`,
`setAllowDoubleBooking`. If a stamp update errors, log and continue — it must never break the
operator's save (worst case is a missed notify, self-heals on the next capacity-add).

## File 3 — `lib/availability-reopen.ts`  (NEW — pure, unit-testable logic)

Keep the decision logic pure and DB-free (house style: pure logic first). Export:

```ts
// A lead is eligible for a reopen-notify for a given org reopen instant.
export function isReopenLeadEligible(args: {
  noSuitableTime: boolean;
  status: string;                    // lead status
  propertyStatus: string | null;     // must be 'available'
  createdAtMs: number | null;
  nowMs: number;
  reopenNotifiedAtMs: number | null; // leads.reopen_notified_at
  reopenedAtMs: number | null;       // organizations.availability_reopened_at
}): boolean
// true iff: noSuitableTime && status ∈ NURTURABLE_STATUSES && propertyStatus === 'available'
//   && (nowMs - createdAtMs) <= NURTURE_MAX_AGE_MS
//   && reopenedAtMs != null
//   && (reopenNotifiedAtMs == null || reopenNotifiedAtMs < reopenedAtMs)

export const REOPEN_NOTIFY_MAX_PER_ORG = 25;

// Given an org's current open-slot count and its eligible leads, the leads to
// actually notify this sweep (empty when open < 1 — the "don't notify into an
// empty calendar" guard — else the first REOPEN_NOTIFY_MAX_PER_ORG).
export function reopenLeadsToNotify<T>(open: number, eligible: T[]): T[]
```

Import `NURTURABLE_STATUSES` + `NURTURE_MAX_AGE_MS` from `lib/nurture.ts`; do not redefine.

## File 4 — `app/api/cron/availability-reopened-notify/route.ts`  (NEW — the sweep)

A new dedicated cron (see "Open decision (Noam)" below for why NOT folded into the tripwire cron).
`export const dynamic = "force-dynamic"; export const runtime = "nodejs";`

Flow:
1. `authorized(req)` (CRON_SECRET, copy from tripwire route) → 401 if not. `createAdminClient()`
   → 200 `service_role_not_configured` summary if null. Params: `force` (`?force=1` bypasses the
   `reopen_notified_at < reopened_at` freshness check but **NOT** the open-slots guard), `dry`
   (`?dry=1` renders/reports, no send, no stamp), `onlyOrg` (`?org=`).
2. **Select candidate leads** (mirror the nurture select): `leads` where
   `no_suitable_time = true`, `status in NURTURABLE_STATUSES`, `created_at > now - NURTURE_MAX_AGE_MS`,
   joining `properties(status, address, rent_cents)` +
   `organizations(id, name, brand_color, logo_url, reply_to_email, availability_reopened_at)`.
   (If `onlyOrg`, filter to that org.)
3. **Group by org.** For each org: read `availability_reopened_at`; if null, skip (nothing
   reopened). Filter its leads with `isReopenLeadEligible(...)` (File 3) — this applies the
   `reopen_notified_at < reopened_at` once-per-reopen gate, property-available, age, and status.
   In `force` mode, treat the `reopen_notified_at` gate as satisfied but keep every other predicate.
4. **Load availability once for the org** (copy the tripwire route's load block) and compute
   `open = countOpenBookableSlots(availability, now, lookaheadDays)` with `lookaheadDays` from
   `org.availability_tripwire_lookahead_days ?? 7` (reuse the existing column; a plain default of
   7 if you prefer not to select it). Compute `toNotify = reopenLeadsToNotify(open, eligible)`.
   **If `open < 1`, `toNotify` is empty — never send "times opened" into an empty calendar.**
5. For each lead in `toNotify` (per-lead try/catch): `sendViewingTimesOpenedEmail(...)` (File 5).
   On `sent`: `update leads set reopen_notified_at = now() where id = lead.id` (this stamp is
   strictly after `reopened_at`, so the lead won't re-fire until the *next* reopen) and
   `insert into messages` a timeline note `channel:'email', direction:'outbound', body:'Notified — new viewing times opened'`.
   On send failure: count an error, do **not** stamp (so a later sweep retries).
6. Return a `Summary` (`ok/scanned/sent/skipped/errors/details[]`) like the other crons;
   `console.log` a one-line per-org + final summary in the tripwire route's style so a Vercel-log
   read can diagnose it (green GH-Actions run ≠ HTTP 200).

**Debounce proof (fires once per reopen):** a notified lead's `reopen_notified_at` is set to a
time strictly greater than the org's `availability_reopened_at`, so on subsequent sweeps
`reopen_notified_at < reopened_at` is false → not re-notified. When the operator adds capacity
again, `availability_reopened_at` bumps to a newer instant that again exceeds the lead's stamp →
eligible once more. Exactly once per distinct reopen. (Two capacity-adds within one 15-min sweep
window collapse into a single notify; that's fine.)

**RECOMMENDED optional (say if you'd rather not):** when a lead is reopen-notified, also set
`nurture_last_sent_at = now()` in the same update. This prevents the same lead getting a nurture
drip email *and* a reopen email in the same window (the `no_suitable_time` nurture variant literally
promises "we'll let you know when times open" — this is that promise being kept). It does not
advance `nurture_step_sent`, so no step is skipped. Default to including this one-field addition.

## File 5 — `lib/email.ts`  (`sendViewingTimesOpenedEmail`)

Add `sendViewingTimesOpenedEmail(p): Promise<SendResult>` mirroring `sendNurtureEmail` /
`sendWaitlistVacancyAlert`:
- Payload: `{ lead_id, property_id, renter_name, renter_email, org_name, brand_color, logo_url,
  reply_to_email, property_address, rent_cents }`.
- Branded HTML shell in the existing style (logo if `logo_url`, `brand` = `brand_color || DEFAULT_BRAND_COLOR`,
  `firstName(renter_name)`, `escapeHtml` all interpolations).
- **Reply-To = `replyToOf(p.reply_to_email, p.org_name)`** (S511 reply-routing — replies reach the
  operator). Sender name `p.org_name || "Vacantless"`, `DEFAULT_SENDER_EMAIL`.
- **CTA button → `listingUrl(p.property_id)`** (the renter's `/r/{propertyId}` booking page). Match
  the nurture pattern — plain listing URL, **no invented tracking param** (there is no stored `?p=`
  on the lead to carry).
- Subject e.g. `New viewing times just opened` + (address ? ` — ${address}` : "") — mirror how
  `sendNurtureEmail` appends the address. Copy tone: warm, one-line lead ("Good news — new viewing
  times just opened for {address}. Grab one that works for you:"), single CTA ("Book a viewing").
- Guard `no_api_key` / `no_renter_email` and the `fetch` try/catch exactly like the siblings; return
  `SendResult`.

## File 6 — `.github/workflows/reminders.yml`  (pinger entry)

Add a step immediately after the `availability-tripwire` step (line ~86), identical shape:

```yaml
      - name: Trigger availability-reopened-notify sweep
        run: |
          curl -sS -X GET \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            "https://vacantless-app.vercel.app/api/cron/availability-reopened-notify" \
            -w "\nHTTP %{http_code}\n"
```

## File 7 — `scripts/test-availability-reopen.ts`  (tsx, runs in the cloud container)

Pure-logic tests against File 3 (no DB):
- **Eligibility selects the right leads:** flagged + nurturable + property `available` + within age
  + (`reopen_notified_at` null OR `< reopened_at`) → eligible; and each negative in isolation →
  ineligible: not flagged; status `booked`/`lost`; property not `available`; older than
  `NURTURE_MAX_AGE_MS`; org `availability_reopened_at` null; `reopen_notified_at >= reopened_at`
  (already told about this reopen).
- **Once-per-reopen:** after stamping `reopen_notified_at = reopened_at + 1ms` the lead is
  ineligible; after a newer `reopened_at` it is eligible again.
- **Open-slots guard:** `reopenLeadsToNotify(0, eligible)` → `[]`; `reopenLeadsToNotify(5, eligible)`
  → eligible (capped).
- **Cap:** with 40 eligible, `reopenLeadsToNotify(5, 40leads).length === REOPEN_NOTIFY_MAX_PER_ORG`.

(Optionally also assert the sweep's `?dry=1` details shape if you add a lightweight harness, but the
pure tests are the required bar — mirror `scripts/test-availability-tripwire.ts`.)

---

## Guardrails / must-nots

- **Trigger on capacity ADDED, never on the tripwire recovery edge.** (See the ★ decision.) Stamp
  only in the three capacity-adding actions.
- **The open-slots guard is mandatory** — never email "new times opened" when `open < 1` (e.g. the
  operator added a window entirely in the past / behind lead-time). `force=1` must NOT bypass it.
- **Once per reopen** via `reopen_notified_at` vs `availability_reopened_at`; stamp only on a
  successful send; cap ≤ `REOPEN_NOTIFY_MAX_PER_ORG` (25) per org per sweep.
- **Renter-facing email, not an operator notification-settings event** — do not add a
  `lib/notifications.ts` event; use `lib/email.ts` + `replyToOf` like nurture.
- Reuse `countOpenBookableSlots`, `NURTURABLE_STATUSES`, `NURTURE_MAX_AGE_MS`, `listingUrl`,
  `replyToOf`, `escapeHtml`, `firstName` — add no duplicate counter/transport/constant.
- **Do NOT touch** the shipped `lib/availability-tripwire.ts`, its cron, or the S513b RPC/columns.
  New cron + new pure module + additive email fn + 3 one-line stamps + 2 columns + 1 pinger line.
- Other orgs / normal leads unaffected: an org that never reopens (null `availability_reopened_at`)
  and any lead without `no_suitable_time` are never selected.
- **Codex writes the migration file only** — do not apply it. Migration to prod is via Supabase MCP
  by Cowork; the push is Noam's.

---

## Deliverable — a single diff touching exactly

```
NEW:  supabase/migrations/0162_reopen_notify.sql        (2 columns)
MOD:  app/dashboard/availability/actions.ts             (stamp reopened_at in the 3 add actions)
NEW:  lib/availability-reopen.ts                        (pure eligibility + guard + cap)
NEW:  app/api/cron/availability-reopened-notify/route.ts (the sweep)
MOD:  lib/email.ts                                      (sendViewingTimesOpenedEmail + HTML)
MOD:  .github/workflows/reminders.yml                   (pinger entry)
NEW:  scripts/test-availability-reopen.ts               (tsx pure tests)
```

Ensure the new test passes, existing tripwire/nurture/notification tests still pass, and the
project typechecks (`npx tsc --noEmit`) + builds (`next build`) + lints.

---

## Verify (Cowork, after Codex returns)

1. `device_bash git diff` in MAIN — only the files above; `git diff --check` clean; no migration
   applied by Codex; shipped tripwire lib/route + S513b RPC untouched.
2. Confirm the `availability_reopened_at` stamp is in **exactly** `addAvailabilityWindow` /
   `addAvailabilityOverride` / `removeDayOff` and **absent** from the capacity-removing actions.
3. Confirm the sweep's open-slots guard blocks a send when `open < 1` even in `force` mode, and
   that `reopen_notified_at` is stamped only after a successful send.
4. Stage `lib/availability-reopen.ts` + `lib/nurture.ts` + the test to the cloud and `npx tsx` it.
5. Apply `0162` via Supabase MCP (Noam's go). Rolled-back functest: seed a flagged lead +
   an org `availability_reopened_at`; assert the eligibility query selects it, the guard suppresses
   when no slots, and a stamp of `reopen_notified_at = now()` de-lists it.
6. Noam pushes; Vercel READY. Enable path: reopen-notify runs for **any** org with waiting flagged
   leads — no per-org enable flag — so once live it is armed for Agile automatically. Smoke: as an
   op, add a viewing window in `/dashboard/availability` for an org that has a flagged waiting lead
   → next sweep the lead gets the "new viewing times just opened" email (Reply-To = the operator)
   and shows the timeline note; a second sweep does not re-send.
```
