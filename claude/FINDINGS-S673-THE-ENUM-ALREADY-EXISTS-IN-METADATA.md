> **[SECTION 7 STEPS 1 AND 2 ARE SUPERSEDED 2026-08-31 by `FINDINGS-S674-ALREADY-LIVE-IS-THE-S642-CONTRACT.md`. Read that alongside this one.]** Step 1 is withdrawn: `already_live` landing at `needs_operator` with an `external_url` is the **deliberate S642 worker contract** (`vacantless-worker/src/phase-b-submit.ts:2969-2971`), guarded by `assertWorkerNeverTerminal` in the app, and the Publish-for-me desk already renders the other half of the handoff. Step 2 is real but is a **migration-first slice**, not a one-liner, and must not reuse the name `submitted`, which the feed-partner path already owns on 11 live rows. Two of the five `already_live` run items are documented non-proofs at source (a rentfaster false-live from a classifier bug S633 already fixed, and a zumper manage url the runner itself says is not proof), so step 4's metadata backfill must be dated against the runner's fix history. Section 1's denominator also needs care: **1,872 of the 1,986 rows are `distribution_freshness_cron` no-ops**; only 114 are real publish attempts.

# S673: the reason enum already exists in metadata, and the 2.8% is a retry artifact

_Written 2026-08-31. Every figure read from production via the Supabase MCP, read-only. Nothing was
deployed, migrated, or written._

**This corrects `FINDINGS-S309-SYNDICATION-IS-AN-ESCALATION-BUSINESS-NOT-AN-AUTOMATION-ONE.md`.**
Its strategic instinct survives. Its headline number does not, and its step 1 is unnecessary.

## 1. The enum does not need to be shipped. It can be read today.

S309 prescribed shipping a `needs_operator` reason enum and measuring for two weeks. **The reason is
already recorded on every one of the 78 concierge `needs_operator` attempts**, in structured form, in
`distribution_publish_attempts.metadata`. That column is non-empty on all 1,986 rows and carries
`outcome`, `challenge`, `reached_form`, `reached_review`, `missing`, `free_plan_reason`,
`validation_errors`, `live_url` and about a hundred other keys.

All eight buckets fall out of a single read-only query, no deploy and no two-week wait:

| reason | n | pct | channels |
|---|---|---|---|
| `stop_gate_by_design` | 19 | 24.4% | kijiji, rentfaster, viewit, zumper |
| `never_reached_end` | 18 | 23.1% | rentals_ca, rentfaster, viewit, zumper |
| `unclassifiable` | 15 | 19.2% | kijiji |
| `already_live` | 11 | 14.1% | kijiji, rentfaster, zumper |
| `payment_or_account_wall` | 8 | 10.3% | kijiji, rentals_ca |
| `login_required` | 3 | 3.8% | rentfaster, zumper |
| `field_rejected` | 3 | 3.8% | kijiji |
| `listing_cap` | 1 | 1.3% | kijiji |
| **`captcha`** | **0** | **0%** | none |

Derived from `outcome`, `challenge` and `live_url`. The query is in section 7.

## 2. Both of S309's strategic unknowns are answered, and both answers are favourable

S309 said the enum was needed because two questions could not be answered without it. They can.

**"If a channel's escalations are mostly captcha, that channel is not agency-able."**
**Captcha is zero.** Across 78 escalations on five channels, `challenge` is `none` on 68,
`sign_in_required` on 3 and `unknown` on 7. Not one captcha. The concern that shaped the whole
copilot-only carve-out is empirically absent.

**"Login-dominant means an AI agent cannot resolve it, and that decides the margin."**
**Login is 3 of 78, 3.8%.** So the agency tier is an AI service with occasional human backup, not a
human service with AI assist. That is the better-margin branch, and it was the open question S309
said would take a fortnight to settle.

## 3. The 2.8% is attempt-weighted, and the denominator is a retry bug

S309 reported concierge at 3 live out of 107 attempts. The 107 attempts are **11 distinct run items**.
One Growth Test kijiji item accounts for 44 attempts on its own, one rentfaster item for 19, one Agile
kijiji item for 11. That is the S306 finding at work: `releaseToNeedsOperator` preserves the approval,
so a proven item re-runs forever. **Counting attempts counts the retry loop, not the failures.**

Per run item, which is the unit that matters (one listing on one channel):

| org | items attempted | ever reached live |
|---|---|---|
| Agile Real Estate Group | 4 | 1 |
| Growth Test | 7 | 4 |
| **total** | **11** | **5, or 45%** |

Strict definition: `status_after='live'`, or `outcome` in (`live`,`published`) **with a non-empty
`live_url`**. Not 2.8%. **n is 11, so 45% is not a number to price on either** - but it is an order of
magnitude away from the figure the business conclusion was hung on, and it changes what to do next.

## 4. Two defects the classification exposes

**`already_live`: 11 attempts posted the listing and still parked at `needs_operator`**, on kijiji,
rentfaster and zumper, between 2026-07-24 and 2026-08-13, each with a captured `live_url`. The ad went
up and the system recorded it as needing a human. This is why S309 counted 3 lives where the items say
5. **Fix this before measuring anything**, or every future measurement inherits the same undercount.

**`stop_gate_by_design`: 19 attempts, the largest bucket.** The runner filled the form, reached the
review screen and stopped, because it is built to stop. `submit_ready` is the system working as
designed. Counting it as an escalation is what makes the automation look broken. **It needs its own
status, distinct from `needs_operator`**, or the metric will keep saying "failed" when the answer is
"waiting for the human it was always going to wait for".

Together these two account for **30 of 78, 38%** of the apparent failure rate, and neither is a failure.

## 5. `error_code` exists on two tables. Find the writer before adding a column.

S309 read "not one `error_code` in any of the 1,973 rows" as a missing field. It is a missing wire.

- **`distribution_run_items.error_code` IS written**, with real values: `spend_authorization_required`
  (`claim.ts:99`), `worker_stale_submitting_reclaimed` (`claim.ts:143`), `kijiji_validation_error`
  (`phase-b-submit.ts:1571`), `kijiji_preflight_failed`, `kijiji_delete_not_confirmed` and others via
  `releaseRefreshToOperator` (`phase-b-submit.ts:1724`). In production 10 of 80 rows are non-null
  (8 `blocked`, 2 `kijiji_preflight_failed`). But run items are **current state**, so each pass
  overwrites the last, and 7 of the 9 items sitting at `needs_operator` today have it null.
- **`distribution_publish_attempts.error_code` is 0 of 1,986**, and so is `error_message`. The app's
  own recorder accepts the value (`lib/distribution-attempts.ts:76`, `:92`,
  `errorCode?: string | null` defaulting to null) and **every caller passes null**.

So the durable log has a column for this, the worker computes the value, and nobody carries one to the
other. **Thread the existing `error_code` into the attempt row.** Do not add a new column.

## 6. A trap that nearly went into this document

**`metadata.live` is the run MODE flag, not a result.** It is `true` on 26 of the 78 escalations,
including every `validation_error`, every `professional_account_no_free` and the single `over_ceiling`,
none of which carry a `live_url`. Reading it as "the listing went live" produced a plausible, wrong
72.7% success rate, which was in a draft of this file before `live_url` was checked against it.
**Only `outcome` in (`live`,`published`) with a non-empty `live_url` means the ad went up.**

## 7. Revised sequence

S309's steps 3 to 5 stand unchanged: session `expires_at`, `external_account_label`, the credential
consent record, then the tier boundary, then the console. Steps 1 and 2 are replaced.

1. **Fix `already_live`.** An attempt that captured a `live_url` must not land at `needs_operator`.
   Worker change, normal review and deploy.
2. **Give the deliberate stop its own status.** `submit_ready` is not an escalation. Until it is
   separated, every rate computed from `needs_operator` is wrong by about a quarter.
3. **Thread `error_code` from the run item into the attempt row.** One field, no schema change. That
   closes the 15 `unclassifiable` kijiji rows, which are the only genuinely dark ones.
4. **Backfill the classification from existing metadata** using the query below, as a view or a
   one-time column. **No two-week wait: the fortnight of data S309 asked for is already on disk.**
5. Re-measure per run item, not per attempt, and only then draw the tier boundary.

Measure per run item every time. Attempt-weighted rates on this table are dominated by the retry loop
and will keep producing numbers like 2.8%.

## 8. The query

```sql
select
  case
    when metadata->>'outcome' in ('live','published')
         and coalesce(metadata->>'live_url','') <> ''          then 'already_live'
    when metadata->>'challenge' = 'sign_in_required'
      or metadata->>'outcome'   = 'needs_login'                then 'login_required'
    when metadata->>'challenge' ilike '%captcha%'              then 'captcha'
    when metadata->>'outcome' in ('professional_account_no_free',
                                  'professional_option_not_selectable',
                                  'plan_confirmed_not_enabled') then 'payment_or_account_wall'
    when metadata->>'outcome' = 'over_ceiling'                 then 'listing_cap'
    when metadata->>'outcome' = 'validation_error'             then 'field_rejected'
    when metadata->>'outcome' = 'submit_ready'                 then 'stop_gate_by_design'
    when metadata->>'outcome' in ('review_not_reached','end_not_reached','no_form')
                                                               then 'never_reached_end'
    when metadata->>'outcome' is null                          then 'unclassifiable'
    else 'other' end as reason,
  count(*)
from distribution_publish_attempts
where transport='concierge' and status_after='needs_operator'
group by 1 order by 2 desc;
```

## 9. What does not change

The escalation-as-unit-of-billing idea, the refusal to sell captcha bypass, the credential governance
gaps, and the observation that syndication is priced nowhere today. Those were the valuable parts of
S309 and none of them depended on the 2.8%. What changes is that the automation is not running at
under 3%, the two blockers to the agency tier are near-zero, and the instrumentation to prove it is
already in the database.
