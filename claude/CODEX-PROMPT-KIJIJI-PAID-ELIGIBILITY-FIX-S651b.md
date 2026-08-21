# CODEX PROMPT — Kijiji paid lane, fix S651b: Professional eligibility must not hard-fail on the radio toggle

**Repo:** `vacantless-worker`, continue on branch `codex/s651-kijiji-paid-lane` (do NOT branch fresh; this stacks on the S651 paid-lane work).
**Standing rules:** no em dashes. Money lane — keep every existing guard; this change only relaxes an over-strict eligibility check, it must not weaken any pay guard.

## What the live recon found (2026-08-13, Agile prod, WORKER_PAY_MAX_CENTS=0, $0)
`submit:b:live:pay` on Agile's real Professional Kijiji account: filled 18 fields, attached 10 photos, clicked Post, reached the in-page plan stage, then `attemptPaidPlan` returned:
- `outcome: "professional_option_not_selectable"`
- `paid_plan_error_message: "Professional for-rent-by option was present but could not be selected"`
- `paid_plans_seen: 0` (never scraped the plan cards; bailed at the eligibility gate)
- $0, nothing posted, approval consumed, clean fail-safe.

Root cause: `ensureProfessionalEligible` (in `src/phase-b-submit.ts`) confirms the Professional radio is present (`proCount > 0`) and Owner is absent (`ownerCount === 0`), then insists on `professional.isChecked()` / `professional.check()` succeeding. On a Professional account that "for rent by" control is effectively the account's fixed mode and is rendered as a styled/likely-hidden radio, so `isChecked()` reads false and `.check({force:true})` throws, and the whole paid lane hard-fails before it can scrape a single plan.

## The fix (scope: `ensureProfessionalEligible` only)
Treat **Professional present + Owner absent** as eligible. The `.check()` becomes best-effort, not a gate:
1. Keep the two hard stops: `ownerCount > 0` -> `owner_account_use_free_lane` (never pay on a free-eligible account); `proCount === 0` -> `professional_option_missing`.
2. If `professional.isChecked()` is already true -> ok.
3. If not checked, TRY to select it, but do not hard-fail if the toggle won't take. Try in order and stop at the first that leaves it selected: (a) click the associated `<label>` (label[for=<id>] or the enclosing label) rather than the input; (b) `professional.check({ force: true })`; (c) a DOM fallback that sets `checked = true` and dispatches `input`+`change` events. Re-read `isChecked()` after.
4. After best-effort selection, return `{ ok: true }` as long as Owner is absent and Professional is present, EVEN IF the final `isChecked()` could not be confirmed — because Professional is the only for-rent-by option on this account, so proceeding is safe. Record the attempted method + final checked state in the returned detail / attempt metadata for diagnostics (e.g. `professional_select_method`, `professional_checked_final`), but do not block on it.
5. Only return `professional_option_not_selectable` in the genuinely-broken case where the control is present, NOT selected, AND we have positive evidence it is disabled/blocking (optional; if unsure, prefer proceeding, since the plan wall itself and the price/ceiling/saved-method guards downstream are the real safety net).

Do not touch the pay gate, the ceiling, the saved-method placeholder, or `basePackageCode` handling. Those stay exactly as shipped (this run must still stop at $0 next time because the ceiling is 0 and the placeholders are unfilled).

## Tests
Extend `scripts/test-paid-plan-logic.ts` or add a small DOM-logic unit if practical, but the core assertion is behavioral: keep all existing paid-plan tests green, `npm run typecheck` clean, `git diff --check` clean. If `ensureProfessionalEligible` is pure-enough to unit test its decision (present+ownerAbsent -> ok regardless of checked), add that case.

## After this lands
Re-run the SAME $0 recon on Agile (`TARGET_CHANNEL=kijiji WORKER_PAY_MAX_CENTS=0 npm run submit:b:live:pay`). Expected next state: it advances past eligibility, `scrapePlans` returns the Professional plan cards, and it stops at the ceiling/assertion with `paid_plans_seen > 0`, `paid_plan_summaries` populated (package codes + prices), and the `paid_plan_debug.total` text visible. That output is what we use to set the real `basePackageCode`, confirm the base price, and decide the tax-tolerance fix for the total-vs-base assertion. Still $0.

Report back: the diff, test results, and confirm the pay guards are untouched.
