# Codex QA handoff — S445 agent one-tap outcome capture

**Range to review:** `fdd18cb..<HEAD after the S445 push>` (base = S444 close).
**Migration:** `0120_record_showing_outcome_from_agent_token.sql` — APPLIED on prod
(`nvhvdyxpyogvadpjlvij`). Additive SECURITY DEFINER RPC; no RLS change; reversible.

## What shipped
The covering agent's `/agent/[token]` shared-calendar page (0117 agent_token) let
them CONFIRM a viewing before it happens (0118). This adds one-tap **"Renter showed
/ No-show"** for a viewing whose scheduled time has PASSED, so the outcome is
captured by the person who was on-site. It closes the loop the operator-targeted
post-showing nudge (S392) couldn't: the operator often doesn't know whether the
renter showed; the assigned agent does.

## Files
- `supabase/migrations/0120_record_showing_outcome_from_agent_token.sql` — new
  RPC `record_showing_outcome_from_agent_token(p_agent_token, p_showing_id,
  p_outcome)`. Mirrors `confirm_showing_from_token` (0118): resolves the agent from
  the token (non-archived), loads the showing ONLY if assigned to that agent in
  that org (`for update`), and records the outcome. Accepts ONLY `attended` /
  `no_show` (a cancellation is a pre-viewing operator/renter action, never an
  on-site report). Replays `record_showing_outcome_from_token` (0098) lead-side
  effects: on `attended` advance the lead to `showed` (from new/replied/contacted/
  booked only); log a `Viewing marked X by <agent>.` note. An already-closed
  viewing returns `{ok:true, already:true}` (no-op — a double-tap never overwrites
  or flip-flops). Granted to anon; a wrong token records nothing.
- `app/agent/[token]/actions.ts` — new `recordOutcomeFromToken` server action.
  POST-not-GET (same KI585 rule as confirm — email link scanners fetch GETs).
  Validates outcome ∈ {attended, no_show} before any DB call; calls the RPC;
  redirects back with `?status=recorded_attended|recorded_no_show|error|invalid`.
- `app/agent/[token]/page.tsx` — per viewing, once `scheduled_at <= now` the action
  block flips from Confirm to "How did it go?" + Renter showed / No-show. Upcoming
  viewings still show Confirm. New result banners for the two recorded states.

## Design decisions worth a look
1. **Reuses the existing outcome semantics via a parallel token RPC**, not a new
   outcome path. `record_showing_outcome_from_agent_token` intentionally mirrors
   0098's lead-advance + note exactly, so the agent path and the operator
   `/showing/[token]` path produce identical records — one outcome model.
2. **agent_token + showing_id, re-derived server-side** (never surfaces the
   per-showing `outcome_token` in the agent page DOM), matching how Confirm works
   on the same page — the page's only credential stays the agent_token.
3. **`attended` / `no_show` only.** Cancellation is deliberately excluded: it is a
   decision made BEFORE the viewing by the operator or renter, not something the
   covering agent files from the doorstep.
4. **Idempotent / no flip-flop.** Recording is allowed only on an OPEN viewing
   (null / 'scheduled'); once closed, a repeat tap is a no-op success, so a
   double-tap or a race with the operator's own entry can't rewrite the result.
5. **`happened` is `scheduled_at <= now`** on the page; the page already keeps a
   viewing visible for 2h after start (existing grace), so the outcome ask appears
   right when the agent is finishing up.

## Gate
tsc clean; eslint clean. Live schema-QA on North Star (b733a191): seeded AgentA +
AgentB + 3 past viewings; RPC returned bad_outcome (cancelled), not_found (wrong
token), not_found (AgentB on AgentA's viewing), ok/attended, ok/no_show, already
(idempotent 2nd tap). Verified: attended -> lead `showed` + note; no_show -> lead
unchanged + note; untouched viewing stayed `scheduled`. Torn down clean.

## Known non-issues (don't re-flag)
- No unit test: the RPC is the source of truth and is SQL; it's verified by the
  live schema-QA above (the pure lib harness has no new logic to cover).
- The page shows outcome buttons whenever `scheduled_at <= now` within the existing
  2h visibility window; a viewing older than that has already dropped off the
  agent's list by design (the operator nudge / dashboard still cover late entry).
- Nudging cadence (how often to prompt for an unrecorded outcome) is a SEPARATE
  follow-up slice on the S392 cron, not part of this change.
