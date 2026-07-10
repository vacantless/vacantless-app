# Codex QA handoff — S445b outcome-nudge cadence + agent targeting

**Range to review:** `e1e83e7..<HEAD after the S445b push>` (base = S445 slice 1).
**Migration:** `0121_outcome_nudge_cadence.sql` — APPLIED on prod
(`nvhvdyxpyogvadpjlvij`). Additive columns + a CHECK; reversible.

## What shipped
The one-shot post-showing outcome nudge (0097/S392) becomes a bounded, stops-on-
answer escalation aimed at the person who was on-site.

## Files
- `supabase/migrations/0121_outcome_nudge_cadence.sql` — `showings.outcome_nudge_count`
  (int, default 0) + `organizations.outcome_nudge_max` (int, default 3, CHECK 1..3).
  `outcome_nudge_sent_at` retained as last-sent (observability); the COUNT drives
  the decision.
- `lib/reminders.ts` — new pure `outcomeNudgeStepDue({scheduledAtMs, nowMs, outcome,
  nudgeCount, maxNudges, offsets?, maxAgeMs?})`: the Nth nudge (0-indexed by count)
  is due once elapsed crosses `OFFSETS[count]`, gated by the cap (`nudgeCount >=
  maxNudges`), the step count (`nudgeCount >= offsets.length`), the 7d backlog
  bound, and a recorded outcome (any real outcome → never). New
  `OUTCOME_NUDGE_OFFSETS_MS = [2h, 20h, 44h]` (fresh / next-morning / final, all
  inside the 7d bound) + `OUTCOME_NUDGE_COUNT_COLUMN`. The old `outcomeNudgeDue` is
  **retained as a thin back-compat wrapper** delegating to the stepped primitive
  with `maxNudges=1, offsets=[grace]` — so its existing tests pass unchanged.
- `app/api/cron/showing-outcome-nudge/route.ts` — (a) reads `org.outcome_nudge_max`
  + `showings.outcome_nudge_count` + `assigned_agent_id`; (b) per row calls
  `outcomeNudgeStepDue` with the real count (or 0 under `?force=1`) and the cap; (c)
  **targeting**: an assigned viewing whose agent has an email routes to the agent
  (`audienceEmail = agent.email`, CTA = `/agent/{agent_token}`, no operator
  fallback) — else the operator (`operatorFallback`, CTA = `/showing/{outcome_token}`);
  (d) on a delivered send, bumps `outcome_nudge_count` (off the REAL prior count,
  not the force-zeroed one) + stamps `outcome_nudge_sent_at`. The
  no-stamp-on-undelivered guard (P2, 2026-07-01) is preserved.
- `app/dashboard/settings/notifications/{page,actions}.ts` — a "How often to
  remind" select (Just once = 1 / Follow up until answered = 3) rendered ONLY on
  the `leasing.showing_outcome_nudge` card, persisted to `organizations.outcome_nudge_max`
  (validated to 1 or 3; a bad/absent value leaves it untouched). `lib/org.ts` adds
  `outcome_nudge_max` to the Org type + select.

## Design decisions worth a look
1. **Step gate keyed on cumulative offsets from `scheduled_at` + the send count**,
   not last-sent time. With a few-hourly cron, successive steps land on separate
   sweeps (no burst) and are naturally spaced; the decision is independent of when
   prior nudges actually fired (catch-up safe). This is the core logic to scrutinize.
2. **Answer stops the series.** `outcomeNudgeStepDue` returns false for any real
   outcome, so once the agent taps Renter showed / No-show (S445 slice 1), no
   further nudge fires — the whole point of "nudge until filled, then quit".
3. **Agent-first targeting** closes the loop with slice 1: the person who can
   one-tap the answer is the one nudged. Operator is the fallback (unassigned / no
   agent email), unchanged.
4. **Account-level policy stays behind login.** The Off / Once / Follow-up choice is
   org config on the dashboard; per-viewing control (record the outcome) is one tap
   in the agent's inbox. Deliberately no magic-link org-config change (a forwarded
   link must not reconfigure an account).
5. **`force` bumps the real count**, not the zeroed one, so a test re-send never
   rewinds a showing's count.

## Gate
tsc clean; eslint clean. test-outcome-nudge 24 -> **36/0** (step gating per count,
per-org cap once-vs-follow-up, stop-on-answer, `"scheduled"` placeholder still
nudges, backlog bound, offsets ascending + inside 7d). reminders 13/0,
outcome-nudge-send 10/0. Migration verified on prod: all 9 orgs `outcome_nudge_max=3`,
0 out of range, count column present + zero. The cron ships DARK; recommended
post-deploy check = a `?dry=1&org=<northstar>` sweep (returns `to:agent|operator`
+ `nudge_step` per row, sends nothing).

## Known non-issues (don't re-flag)
- `outcomeNudgeDue` is intentionally retained as a delegating wrapper (back-compat
  for its existing callers/tests), not dead code.
- No SQL pre-filter on a sent stamp anymore (bounded escalation can send >1); the
  per-row `outcomeNudgeStepDue` + count is the gate. The in-band + outcome-blank SQL
  filter still bounds the scan.
- Offsets `[2h,20h,44h]` are fixed (not org-tz "morning") to stay pure + testable;
  the few-hourly cron cadence provides the real spacing. Matches the accepted
  tz-simplification posture elsewhere.
