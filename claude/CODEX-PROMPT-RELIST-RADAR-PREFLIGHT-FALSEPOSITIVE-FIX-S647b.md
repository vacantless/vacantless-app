# CODEX PROMPT - Relist Radar preflight FALSE-POSITIVE fix (follow-up to d2203ad) - S647b

## What happened (live E2E retest of d2203ad on test org 8ea1da48)
The d2203ad preflight fix correctly stopped requiring the $0 card pre-delete, BUT it introduced a false
positive. On the live retest against a real occupied-slot ad (1741915100), the preflight reached the plan
wall (`needs_payment`, expected) and then FAILED with:
`error_code=kijiji_preflight_failed`,
`message="Kijiji needs: Rent, Size (sqft), Bedrooms, Bathrooms. Add them on the property, then retry."`
NO delete happened (fail-safe intact). But those facts are NOT missing: the same property just posted a
live $0 ad minutes earlier with `kijiji_needs=[]`, and the DB has sqft=800, beds=2, baths=1.0,
rent_cents=160000.

## Root cause
The new block in `runRelistRadarPreflight` (src/phase-b-submit.ts, ~1237-1266 in d2203ad) calls
`dumpFreePlanState(page, ...)` at the PLAN WALL and runs `kijijiNeedLabelsFromValidationMessages` over the
plan-wall `validationMessages`. At the plan wall, with no plan selected yet, Kijiji shows STALE
required-field validation for the core fields (this is the KI1044 stale-banner artifact - the same reason
the normal post path must IGNORE the plan-wall banner). So the fact-recheck misreads those stale "required"
flags as missing facts and fails.

Reaching `cls.outcome === "needs_payment"` (the plan wall) ALREADY proves the facts are present: a
genuinely missing real fact makes Kijiji re-error on the FORM and never advance to the plan wall, and that
case is already handled by the existing `if (cls.outcome !== "needs_payment")` branch just above (which
parses the REAL form-stage validationMessages into a "Kijiji needs: ..." message). The plan-wall recheck
is therefore both redundant and wrong.

## The fix
In `runRelistRadarPreflight`, DELETE the plan-wall `dumpFreePlanState` -> `validationMessages` ->
`kijijiNeedLabelsFromValidationMessages` -> `if (needMessage) return fail` block that was added in d2203ad.
Once `cls.outcome === "needs_payment"` is reached, treat the preflight as SUCCESS unconditionally:
- keep scraping plans for logging (`scrapePlans` / `plan_summaries`) if useful,
- keep the `preflight_expected_outcome: "needs_payment"` + `preflight_free_card_selection_deferred: true`
  metadata,
- return `{ ok: true, launched, prepared, preflightMeta }` and proceed to delete + repost.

Do NOT remove or weaken:
- the `if (cls.outcome === "live")` posted-unexpectedly guard (still hard-fail, no delete),
- the `if (cls.outcome !== "needs_payment")` branch (THIS is the correct, form-stage missing-fact catch -
  keep it exactly as is; it fires when the form re-errors and never reaches the plan wall),
- the earlier "form did not fill / no Post button" guards,
- all post-delete failure routes (kijiji_repost_failed_after_delete etc., backup intact),
- the transientFreePlanFailure needs_payment fresh-page retry from d2203ad (that part is correct - keep it).

Net effect: genuine missing facts still fail-no-delete (via the form-stage branch). A present-facts refresh
now passes preflight (needs_payment at the wall = facts proven), deletes the old ad, and reposts $0 on the
freed slot.

## Files
- `src/phase-b-submit.ts`: `runRelistRadarPreflight` - remove ONLY the d2203ad plan-wall
  `dumpFreePlanState` needs-recheck block; leave the surrounding form-stage checks and the return-ok path.

## Acceptance (live E2E is the discovery tool - prove end to end, not smoke-only)
On test org 8ea1da48 with a real live $0 ad as the refresh target and all facts present:
- preflight PASSES (reaches needs_payment, no false "Kijiji needs" failure),
- deletes the old ad, confirms gone,
- reposts a fresh $0 ad (Total $0.00, no paid button),
- new `external_url` != old, fresh ~60-day `external_expires_at`,
- `relist_radar_kijiji_delete` + `relist_radar_kijiji_repost` attempt rows present,
- item ends live/done, zero dollars charged.
- Negative check: temporarily null a real fact (e.g. sqft) on a throwaway property so the form re-errors
  BEFORE the plan wall -> preflight must still fail-no-delete via the form-stage branch with the correct
  "Kijiji needs: Size (sqft)" message.

## Preconditions unchanged
Worker branch codex/s647-kijiji-refresh-preflight-slot @ d2203ad is on the box now. After the fix: push,
merge to main (PR + Chrome), rsync to box, then `chown -R worker:worker /opt/vacantless-worker` (mandatory,
already in HOST-RUNBOOK). RELIST_RADAR_EXECUTE_FREE_ENABLED reverted OFF after this retest.
Prior context: `claude/CODEX-PROMPT-RELIST-RADAR-PREFLIGHT-FIX-S647.md`.
