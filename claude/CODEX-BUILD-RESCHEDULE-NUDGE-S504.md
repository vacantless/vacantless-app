# CODEX BUILD — Reschedule-proposal re-reminder (Part B) — S504

**Part B (final slice) of `DESIGN-SHOWING-CLUSTERING-AND-RESCHEDULE-COHERENCE-2026-07-16.md`.** Codex verdict on Part B = **ACCEPT-WITH-CHANGES** (the P2 decision is resolved below). Part C shipped (S502), Part A shipped + verified live (S503, `d87360e` + mig `0152`). This closes the design.

Grounded against `HEAD = d87360e` (`main`). Line numbers at that SHA.

## Why
When an operator suggests new times, `proposeShowingTimes` (`app/dashboard/showings/actions.ts:81`) expires prior pendings, inserts one pending `showing_reschedule_proposals` row, and emails via `sendRescheduleProposal` (`lib/email.ts:484`). **Nothing follows up.** If the renter doesn't act, the proposal just sits there — proven live with Brien (proposed 09:05, re-sent 12:18, no automatic follow-up; a human had to re-nudge). Part B adds a single automated re-nudge.

## P2 decision (resolved) — direct renter email, per-org boolean, default OFF
`sendRescheduleProposal` is a **direct renter transactional email**, not a `NOTIFICATION_EVENTS` send. So the re-nudge is the **same email re-sent** — do **not** invent a notification event for it. Gate it with a single per-org boolean, mirroring the S500 `viewing_reminder_enabled` opt-in precedent. **Default OFF**; Noam flips it on for Agile when ready (customer-facing sends need his go-ahead). Unlike S500 there is **no weekday/hour schedule** — the nudge fires relative to each proposal's `created_at`, not a weekly clock.

## Migration `0153` (additive columns only — no function/schema-shape change)
Idempotent, safe to apply anytime (no function replacement, no live-flow risk):
```sql
alter table public.showing_reschedule_proposals
  add column if not exists reminded_at timestamptz;

alter table public.organizations
  add column if not exists reschedule_nudge_enabled boolean not null default false;

comment on column public.showing_reschedule_proposals.reminded_at is
  'When the one-shot reschedule re-nudge was sent for this pending proposal (null = not yet). Caps the nudge at one.';
comment on column public.organizations.reschedule_nudge_enabled is
  'Whether app/api/cron/reschedule-nudge re-emails an unresponded pending reschedule proposal once, N hours after it was created.';
```

## New cron route — `app/api/cron/reschedule-nudge/route.ts`
Model on `app/api/cron/viewing-reminder/route.ts` but **simpler** (no notification event, no weekday/hour gate). `export const dynamic = "force-dynamic"; export const runtime = "nodejs";` Reuse the same `authorized(req)` CRON_SECRET helper (Bearer header or `?secret=`). Support `?dry=1`, `?org=<id>`, `?force=1`. All admin reads pinned `cache: "no-store"` (createAdminClient).

**`RESCHEDULE_NUDGE_AFTER_HOURS = 24`** as a route constant (documented as tunable).

**Candidate selection.** A proposal qualifies iff ALL:
- `showing_reschedule_proposals.status = 'pending'` AND `responded_at IS NULL` AND `reminded_at IS NULL`
- its org's `reschedule_nudge_enabled = true`
- `created_at <= now() - interval 'RESCHEDULE_NUDGE_AFTER_HOURS hours'`
- the joined showing is still live: `showings.outcome = 'scheduled'` AND `showings.scheduled_at > now()` (do **not** nudge for a slot that already passed)

(There is at most one pending proposal per showing — `proposeShowingTimes` expires priors and the `0149` partial unique index enforces it — so no "newest" tiebreak is needed.)

**Claim-then-send (spam-safe idempotency).** For each candidate, **stamp first, then send**: `update showing_reschedule_proposals set reminded_at = now() where id = $1 and reminded_at is null` and proceed **only if that update affected the row** (claimed it). This makes the nudge exactly-once even if two sweeps overlap. Tradeoff (intended): a failed send is not auto-retried — acceptable for a one-shot nudge, and preferable to risking a double email. In `?dry` mode, do **not** claim or send — just report.

**Re-send.** Reconstruct the existing `RescheduleProposalPayload` (`lib/email.ts:410`) from the joined rows and call `sendRescheduleProposal` unchanged:
- `renter_name/renter_email` from the lead; `org_name/brand_color/logo_url/reply_to_email` from the org; `property_address` from the property.
- `current_when_label` = `formatSlotLong(showings.scheduled_at, tz)`; `proposed_when_labels` = `proposed_slots.map(s => formatSlotLong(s, tz))` (org `booking_timezone`).
- `proposal_url` = `${APP_URL}/showing/reschedule/${token}`; `renter_url` = `${APP_URL}/r/${property_id}`; `lead_id` from the showing.
- Optionally log a `messages` row (`channel:'note', direction:'outbound', body:'Re-sent suggested viewing times (auto follow-up).'`) mirroring the proposeShowingTimes note — keep it a note, no lead-status change.

**Response.** Return a `Summary` (`ok, scanned, sent, skipped, errors, details[]`) like viewing-reminder. In `details`, key entries by `proposal_id` / `showing_id` / `org` — **do not** put renter email/name/PII in the JSON.

## Workflow — `.github/workflows/reminders.yml`
Add one curl step mirroring the viewing-reminder step (`:78–80`):
```yaml
      - name: Reschedule nudge
        run: |
          curl -sS -X GET \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            "https://vacantless-app.vercel.app/api/cron/reschedule-nudge" \
            || true
```
(The sweep self-gates: default `reschedule_nudge_enabled=false` means a safe no-op until an org opts in; each org's `_last_sent` equivalent is the per-proposal `reminded_at`.)

## Invariants (do not change)
- `proposeShowingTimes`, `accept_reschedule_proposal`, `book_public_showing`, and `sendRescheduleProposal` are **untouched** — the cron reuses the existing email and payload.
- Part C reminder routes (`reminders`, `showing-confirmation-nudge`) and `lib/reminders.ts` are untouched. (Note: those already *suppress* while a proposal is pending — Part B is the complementary nudge on the proposal itself, no overlap.)
- No `NOTIFICATION_EVENTS` entry added; no notification-settings change.
- One re-nudge per proposal (the `reminded_at` cap). A new `proposeShowingTimes` call expires the old proposal and creates a fresh one with `reminded_at = null`, so a genuinely new proposal is independently eligible.
- Default OFF for every org.

## Verification
- New `scripts/test-reschedule-nudge.ts` (or extend `scripts/test-reschedule-proposal.ts`): candidate logic — a pending, unresponded, unreminded, aged (>24h), upcoming proposal on an **enabled** org is eligible; each of {responded, expired/accepted, already-reminded, created <24h ago, showing outcome≠scheduled, showing time in the past, org disabled} is skipped. Assert claim-then-send is exactly-once (a claimed row is not re-selected/re-sent in a second pass).
- `tsc --noEmit` + lint + `next build` clean (Noam runs the gate).
- `?dry` run (Noam holds CRON_SECRET): with `reschedule_nudge_enabled=true` for Agile and Brien's proposal aged past 24h, the dry summary lists Brien's proposal as a would-send candidate; with the flag off, it's skipped as `disabled`.
- Cowork verifies the diff via `device_bash git` in MAIN: only `app/api/cron/reschedule-nudge/route.ts` (new), `supabase/migrations/0153_*.sql` (new), `.github/workflows/reminders.yml` (one curl step), and the test file. No edits to the proposal/accept/booking/email/Part-C code.

## Deploy sequencing
`0153` is additive columns only — zero risk to any live flow, no Brien concern. Apply `0153` to prod (Supabase MCP) **before** the push (the route reads `reschedule_nudge_enabled` / `reminded_at`), then push. Everything stays a no-op until Noam sets `reschedule_nudge_enabled=true` for Agile — that flip is his go-ahead (it's what starts the renter-facing re-nudges).

## Done = the whole design ships
With C (S502) + A (S503) + B (S504), `DESIGN-SHOWING-CLUSTERING-AND-RESCHEDULE-COHERENCE-2026-07-16.md` is fully built.
