# CODEX REVIEW+BUILD — Reliable, channel-coordinated, one-tap-confirmable showing reminders — S520

**Repo:** `vacantless-app`. **App HEAD:** `a3662f6`. Strategy/evidence: `claude/STRATEGY-SHOWING-REMINDER-CADENCE-2026-07-19.md`.
**Gate:** improves the EXISTING showing-reminder pipeline at its current entitlement. `renter_sms` is already **Growth+** (`lib/billing.ts`) — Agile (the live paying dogfood org) has it. This is a **reliability + coordination + confirmation fix, NOT a new Premium gate.** Do NOT move renter reminders/confirmation behind Premium (that is a takeaway from the live customer).

---

## 0. Why (prod + field evidence, 2026-07-19)
THE GATE for org 921f7c08 is **0 attended / 2 no_show / 4 cancelled**. No-shows are the core problem. Prod reminder stamps show the day-of touch is broken: the **24h email reminder fires reliably** (wide 22h band) but the **~2h reminder fired for only 1 of the last 6 showings** — it rides a free GitHub Actions pinger (`.github/workflows/reminders.yml`, every 15 min) whose scheduled runs are throttled/skipped, so the narrow 0–2h window is usually missed; Vercel native cron is Hobby (once/day). Separately, the cron fires **email AND a parallel SMS at the same tier**, so an SMS-enabled org double-pings.

Field evidence (full detail + sources in the strategy doc): (a) two spaced reminders beat one (AJMC RCT of 54k; Calendly "at least two") — a day-ahead + a near-time touch is the backbone; (b) **email = day-ahead detail/reschedule, SMS = day-of urgency** (Vital Interaction; Calendly "combination of email and texts") — split roles, don't duplicate; (c) the biggest lever is a **renter confirmation ask with the action embedded in the message** — ShowMojo ("action is required to avoid cancellation"), Calendly reconfirm (tap "Yes, I'm attending"), and **BrokerBay** (accept/confirm buttons live *inside* the SMS/email, no portal visit).

This ticket delivers the complete renter-facing intervention: reliable near-time reminder + channel coordination + a one-tap Confirm inside the message.

## 1. REVIEW FIRST (mandatory — deliver a short note, then build)
- `lib/reminders.ts` → `decideReminderKind` (`"24h"|"2h"` windows + priority) and the email/SMS stamp-column maps. Confirm exact boundaries + the one-kind-per-call contract.
- `app/api/cron/reminders/route.ts` — the sweep loop: how it selects due showings, calls `decideReminderKind`, sends `sendShowingReminder` (email) **and in parallel** `showingReminderSms`→`sendSms` (SMS, gated by `canUseRenterSms(plan)` + org `sms_enabled` + a usable/opted-in number), and stamps per-channel columns. CONFIRM it currently sends BOTH channels at every tier (the redundancy this ticket removes).
- `lib/sms.ts` → `showingReminderSms(p, kind)` — currently `kind: "24h" | "2h"`; needs a `"sameday"` variant. Note existing reschedule/opt-out affordances.
- `lib/email.ts` → `sendShowingReminder` — what confirm/reschedule/cancel links it already carries.
- **Token/confirm affordance:** `showings` has `cancel_token`, `outcome_token`, `confirmed_at`, `confirmed_by`, `confirmation_nudge_sent_at`. Find how the renter-facing **cancel** link works (the public route that consumes `cancel_token`) and whether any **renter confirm** route/token exists today. This decides reuse-vs-add in §2f.
- `lib/billing.ts` → `canUseRenterSms` + the `renter_sms` row (confirm Growth+ = true; do not change).
- `showings` grants — is service_role SELECT/UPDATE on `showings` table-wide or column-scoped (mig 0161 precedent)? Decides whether new columns need explicit grants.
- `.github/workflows/reminders.yml` — confirm the every-15-min ping (NO workflow change).

Review note should state: current windows; the both-channels-every-tier behavior; how the cancel_token public route is built (so the confirm route mirrors it); what confirm/reschedule affordances the email+SMS copy already carry; whether `showings` grants are column-scoped.

## 2. BUILD

### 2a. `lib/reminders.ts` — add the `"sameday"` tier (pure, `npx tsx`)
- Constants: `DAY_MAX_H=24`, `SAMEDAY_MAX_H=4`, `LASTMINUTE_MAX_H=2` (hours; ms internally; `SAMEDAY_MAX_H` tunable, evidence sweet spot 3–4h). Extension point for per-org override later; constants now.
- `ReminderKind` → `"24h" | "sameday" | "2h"`. `decideReminderKind` input gains `sentSameday`. Windows on `msUntil = scheduledAtMs - nowMs`:
  - `≤0` → `null` (never remind late — preserve current behavior).
  - `≤ 2h` → `"2h"` (unless `sent2h`).
  - `2h–4h` → `"sameday"` (unless `sentSameday`).
  - `4h–24h` → `"24h"` (unless `sent24h`).
  - `>24h` → `null`.
  - Precedence = highest-priority DUE & UNSENT kind: `2h` > `sameday` > `24h`. One kind per call (subsequent pinger runs pick up the rest). Preserve: a booking created inside a tier never emits a spurious earlier-tier reminder.
- Stamp maps gain `"sameday" → "reminder_sameday_sent_at"` (email) and `"sameday" → "reminder_sameday_sms_sent_at"` (SMS).

### 2b. Channel coordination — pure `channelPlan` helper (`npx tsx`)
Add a pure helper in `lib/reminders.ts`, replacing "always both":
```
channelPlan(kind, { smsDeliverable }) -> { email: boolean, sms: boolean }
```
- `smsDeliverable` = `canUseRenterSms(plan)` && org `sms_enabled` && renter has a usable, non-opted-out number (computed in the cron, passed in).
- Matrix:
  - `"24h"` → `{ email: true, sms: false }` (day-ahead detail = email only).
  - `"sameday"` → smsDeliverable ? `{ email: false, sms: true }` : `{ email: true, sms: false }` (SMS is the day-of nudge; **email fallback** so a non-SMS renter still gets a day-of touch).
  - `"2h"` → smsDeliverable ? `{ email: false, sms: true }` : `{ email: false, sms: false }` (optional last-minute SMS; behind constant `SEND_LASTMINUTE=false`, default OFF).
- The cron sends/stamps ONLY the channels `channelPlan` returns true for. Assert (tests) email+SMS are never both true for one kind, and a day-of touch is never dropped (fallback holds).

### 2c–2e. `lib/sms.ts` / `lib/email.ts` / cron wiring
- `showingReminderSms` gains a `"sameday"` short, urgent lead (e.g. `"you're booked for a viewing at {addr} today at {time}"`), keeping address + time + the confirm/reschedule affordance + opt-out line; `noEmDash`.
- Cron: select the new sameday stamp columns, pass `sentSameday`, compute `smsDeliverable` once per showing, call `channelPlan`, send/stamp only the returned channels. No new send primitives beyond the confirm links in §2f.

### 2f. One-tap **Confirm** embedded in the reminder (the BrokerBay/ShowMojo/Calendly lever)
Put the action IN the message, link-based (no inbound-SMS dependency — SMS is dark until QUO; a tappable link works on both channels now):
- **Confirm route + token:** if review finds an existing renter confirm route/token, reuse it. Otherwise add `showings.confirm_token uuid default gen_random_uuid()` (mirror `cancel_token`) and a public route (mirror the existing cancel route) that, given a valid token, stamps `confirmed_at = now()` and `confirmed_by = 'renter'` (idempotent — re-confirm is a no-op), then renders a friendly "You're confirmed for {time} at {addr}" page with a reschedule/cancel link. Org-scoped by the token (no auth), rate-safe, no enumeration (uuid token like cancel_token).
- **In-message CTA:** the `sameday` (and `24h`) email reminder gets a prominent **Confirm** button + Reschedule + Cancel links; the SMS reminder includes a short **confirm link** alongside the reschedule affordance. Reuse the existing link-building/token pattern from the cancel route.
- **Honesty:** copy may say "tap to confirm you'll be there" but must NOT threaten auto-release/cancellation (S520 does not release unconfirmed slots — that is S521). Keep it inviting, not coercive.

### 2g. Migration `0164` (ADDITIVE only)
- `ALTER TABLE showings ADD COLUMN reminder_sameday_sent_at timestamptz`, `ADD COLUMN reminder_sameday_sms_sent_at timestamptz` (nullable, no default, no backfill).
- If §2f adds a token: `ADD COLUMN confirm_token uuid DEFAULT gen_random_uuid()` (backfill existing rows a token in the same migration so live upcoming showings get a confirm link).
- If review finds column-scoped grants on `showings`: grant SELECT/UPDATE on the new stamp columns (and SELECT on `confirm_token`) to service_role, plus whatever grant the public cancel route relies on for its token, mirrored for confirm. If table-wide, none needed — state which.

## 3. CONSTRAINTS / INVARIANTS
- Additive only. No rename of `"24h"`/`"2h"` columns; no change to who can receive SMS.
- **No Growth takeaway:** renter reminders/confirmation stay Growth+; do NOT gate to Premium.
- Per-channel idempotent self-gating preserved; re-runs never double-send. Confirm route idempotent.
- Channel coordination must NEVER drop a day-of touch (email fallback at `sameday`) — assert in tests.
- Do NOT promise a consequence the system doesn't enforce (no "slot will be released" — that's S521).
- Pure logic (`decideReminderKind`, `channelPlan`) has no network/DB; the cron + route own all IO.
- Do NOT touch: repair `appointment-reminder`, `showing-confirmation-nudge` (the agent-facing nudge — S521 repurposes it, not this ticket), `showing-outcome-nudge`, feedback/nurture crons, `vercel.json`/`reminders.yml`.

## 4. VERIFICATION (Cowork re-runs independently)
- `scripts/test-reminders.ts` (extend): T-30h→null, T-20h→"24h", T-5h→"24h", **T-4h→"sameday"**, T-3h→"sameday", T-90m→"2h", past→null; sent-flags suppress a tier and fall through to the next due one; a booking made at T-90m yields only "2h".
- `channelPlan` tests: `24h`→email-only; `sameday`+smsDeliverable→sms-only; `sameday`+!smsDeliverable→**email-only (fallback)**; `2h`+smsDeliverable→sms-only (OFF by default constant); `2h`+!smsDeliverable→neither. Never both channels for one kind.
- Confirm route: valid token stamps `confirmed_at`/`confirmed_by='renter'` once (idempotent); invalid/absent token → safe 404/notice, no stamp; confirming does not alter outcome/cancel state.
- `git diff --check` clean; diff confined to `lib/reminders.ts`, `lib/sms.ts`, `lib/email.ts`, `app/api/cron/reminders/route.ts`, the public confirm route, migration `0164`, and tests. `vercel.json` + `reminders.yml` + appointment/confirmation/outcome crons UNCHANGED.
- `npx tsc --noEmit`, `npm run lint`, `npm run build` green.
- **Commit + push to `main`** (as with S519). Do NOT apply migration `0164` to prod — Cowork applies it via Supabase MCP on Noam's go after a rolled-back behavioral functest.

## 5. OUT OF SCOPE → S521 (operator confirmation layer)
The **operator-side** confirmation layer is the next ticket: BrokerBay's three confirmation **modes** as a per-org/property setting (auto-confirm / operator-confirms / renter-confirms), an **"unconfirmed = at-risk" operator surface** (repurpose the existing agent `showing-confirmation-nudge`), and **opt-in auto-release/flag** of unconfirmed slots. Natural home for a Premium up-sell layered ON TOP of the Growth baseline. Also out: QUO A2P SMS go-live (external gate); Vercel Pro native cron (optional robustness — flag, don't do); inbound-SMS reply parsing; per-org configurable offsets; holiday-aware scheduling.
