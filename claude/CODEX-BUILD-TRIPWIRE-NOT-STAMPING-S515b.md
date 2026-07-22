# CODEX BUILD — availability-tripwire never stamps org state (S515b, bug)

**Type:** bug fix + observability. **No migration.** Single route file (+ maybe a tiny helper).
**Repo:** `vacantless-app`. **Base:** `main` @ `de8b12e`. **File:** `app/api/cron/availability-tripwire/route.ts` (378 lines).

## Symptom (observed in prod, 2026-07-18)
Org `921f7c08-98af-428f-a238-36f4a781b0de` (Agile) has `availability_tripwire_enabled = true` but `availability_tripwire_last_state` is **still NULL**, hours after enable and after a **manually-triggered, successful** sweep run (GitHub Actions "Vacantless background sweeps" Run 162). The scheduled sweeps run ~hourly and succeed; the endpoint returns **200**. So the route is executing but **never stamping this org's state**.

Independently confirmed the org currently computes severity **`ok`** (11 open bookable slots across 2 days, thin threshold = 3), so it should hit the no-alert branch and stamp `last_state = 'ok'` — but doesn't. The failure is invisible because the per-org `catch` swallows errors into `summary.details`, and the cron pinger (`curl -sS`) discards the response body — so nothing reaches the Vercel logs.

## Root-cause candidates (the route, current line numbers)
For an **enabled** org, `last_state` is only written by one of two `.update()` calls:
- **no-alert branch** — line **350** (`.update({...})`), then line **355** `if (updateErr) throw ...`.
- **alert branch** — line **322** (`.update({...})`) — but this runs **only after** `sendOrgNotification(...)` at line **304**.

Any throw between the org-loop start (line ~149) and the relevant `.update()` lands in the per-org `catch` at line **368**, which does `summary.errors++` + `summary.details.push({...})` and **moves on — no `console.error`, no re-throw** → the org is never stamped and the failure is silent.

Two concrete failure modes to fix:
1. **Silent per-org throw (primary).** A Supabase query in the `Promise.all` (line **172**: `availability_rules` / `availability_days_off` / `availability_overrides` / `showings` with the `.or("outcome.is.null,outcome.eq.scheduled")` filter), or a compute/`update` error, throws for this org → swallowed at 368. We cannot tell which without logs.
2. **Alert-branch ordering (latent, dangerous).** In the alert branch the state update (322) happens **after** the send (304). If `loadMembers` (256) or `sendOrgNotification` (304) throws, the `catch` fires and `last_state` is **never stamped** → the org is stuck: it never debounces, re-attempts every run, and (if it were thin/zero) **never delivers the alert**. State must be recorded independent of send success.

## Changes

### 1. Make per-org failures observable (primary)
In the per-org `catch` (line **368**), add a `console.error` with the org id, a stage hint, and the error message, e.g.:
```ts
} catch (err) {
  const msg = err instanceof Error ? err.message : "unknown";
  console.error(`[availability-tripwire] org=${(org as any)?.id} threw: ${msg}`);
  summary.errors++;
  summary.details.push({ org: (org as any)?.id, error: `org_threw:${msg}` });
}
```
Also emit ONE structured line per processed org just before each `summary.details.push` in the non-dry paths (and once for the final summary), so the next run's Vercel logs show, for `921f7c08`: `enabled`, `severity`, `open`, `openDays`, `decision.nextLastState`, whether the update ran, and any `updateErr`. Keep it to concise `console.log`/`console.error` lines (no PII — org ids + counts only). This is the key to diagnosing #1.

### 2. Stamp state independent of send success (alert branch)
Restructure the alert branch (lines ~304–329) so the `organizations` state update (322) is **not gated on the send succeeding**. Wrap `sendOrgNotification` in its own try/catch: on send failure, log it, record `delivered:false` in details, but STILL run the state `.update(...)` so the org records `last_state`/`last_alert_on` and debounces correctly. A failed email must never leave the tripwire's state machine stuck. (Do not change the alert *decision* logic in `shouldAlertTripwire`, thresholds, or debounce semantics.)

### 3. Surface update errors instead of throwing into the void
Lines **355** and **327** currently `throw new Error("state_update:...")` on `updateErr`, which just lands in the swallowing catch. Keep the behavior but `console.error` the update error (with org id) before/instead of the bare throw so it's visible in logs.

## Guardrails
- Single file: `app/api/cron/availability-tripwire/route.ts` (a small pure helper is fine if it aids clarity). **No migration, no schema change, no change to `lib/availability-tripwire.ts` classify/debounce logic, no threshold/semantic change.**
- Preserve `dry=1` behavior (renders + reports, no send, no write) and the `force`/`org` query params.
- Preserve the 200-with-summary response shape and all existing `summary.details` fields (only ADD).
- Keep `alwaysInclude` owner-admin CC behavior intact.

## Verify
1. `tsc --noEmit` + `npm run build` clean.
2. After deploy, trigger the sweep (GitHub Actions → Vacantless background sweeps → Run workflow), then read Vercel runtime logs for `/api/cron/availability-tripwire`: confirm a per-org line for `921f7c08` shows its `severity` + any error.
3. Confirm `select availability_tripwire_last_state from organizations where id='921f7c08-...'` now returns `'ok'` (the org computes ok, so a clean pass must stamp it).
4. If the new logs reveal a specific throw (e.g., a query error from the `Promise.all`), fix that root cause too and note it.

## Return
`git diff` of the route file + `tsc`/build output, and — if the deploy + a triggered run is possible in your env — the Vercel log line for org `921f7c08` and the resulting `last_state`. **Do not push.**
