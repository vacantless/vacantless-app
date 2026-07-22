# CODEX PROMPT — S515b tripwire not-stamping bug (paste to Codex)

Repo `vacantless-app`, base `main` @ `de8b12e`. Fix the bug in `claude/CODEX-BUILD-TRIPWIRE-NOT-STAMPING-S515b.md`.

Symptom: the availability-tripwire cron (`app/api/cron/availability-tripwire/route.ts`) runs and returns 200 on every scheduled/manual sweep, but org `921f7c08-98af-428f-a238-36f4a781b0de` (enabled, currently computes severity `ok`) never gets `availability_tripwire_last_state` stamped. Cause is invisible because the per-org `catch` (line 368) swallows throws into `summary.details` and the pinger discards the response body.

Do three things, single file (`route.ts`), no migration, no change to `lib/availability-tripwire.ts` classify/debounce logic or thresholds:
1. **Observability:** add `console.error(org id + stage + message)` in the per-org catch (line 368), and one concise `console.log` per processed org (org id, severity, open, openDays, nextLastState, updateErr?) + the final summary, so the next Vercel log reveals why `921f7c08` isn't stamping. Org ids + counts only, no PII.
2. **Stamp independent of send:** in the alert branch, the state `.update()` (line 322) currently runs only after `sendOrgNotification` (304) — if the send throws, state is never recorded and the org gets stuck. Wrap the send in its own try/catch: log + record `delivered:false` on failure but STILL run the state update so `last_state`/`last_alert_on` are recorded and debounce works.
3. **Surface update errors:** `console.error` the `updateErr` (with org id) at lines 327/355 instead of only throwing into the swallowing catch.

Keep `dry=1` (no write/send), `force`/`org` params, the 200-summary shape (only ADD fields), and `alwaysInclude` behavior. Run `tsc --noEmit` + `npm run build`. If your env can deploy + trigger a run, capture the Vercel log line for `921f7c08` and the resulting `last_state`, and if a specific throw shows up (e.g. a query in the line-172 `Promise.all`), fix that root cause too. **Do not push.** Return the `git diff` + build output.
