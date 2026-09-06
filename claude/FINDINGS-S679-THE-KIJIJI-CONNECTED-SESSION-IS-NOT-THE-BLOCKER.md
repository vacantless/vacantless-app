# FINDINGS S679 - "The Kijiji connected session" was never the blocker

_2026-09-04. All claims re-derived this session from Supabase and from the code at the
paths named. Supersedes the S678 line "Agile kijiji is account_status = needs_setup and
needs a login Cowork cannot perform. This blocks the entire worker lane."_

## The correction, in one line

**Agile already has a warmed Kijiji session, and `account_status` is a hand-typed
dropdown that the Kijiji posting lane never reads. The only gate that is actually shut
is spend authorization.**

## 1. The session material EXISTS. It was warmed on 2026-08-13.

`distribution_channel_sessions` [read 2026-09-04]:

| org | channel | last_validated_at |
|---|---|---|
| **Agile Real Estate Group** | **kijiji** | **2026-08-13 15:24:10Z** |
| Agile Real Estate Group | rentals_ca | 2026-07-25 |
| Agile Real Estate Group | zumper | 2026-08-28 |
| Growth Test | kijiji | 2026-08-11 |
| Growth Test | facebook_feed / instagram | 2026-09-02 |
| Growth Test | rentals_ca / rentfaster / viewit / zumper | Jul-Aug |

The row is encrypted Playwright `storageState` written by `npm run warm`
(`vacantless-worker/src/warm-session.ts`), a headed Chromium on Noam's Mac where he logs
in by hand. **It has already been done once for Agile Kijiji.** The claim that the lane
needs "a login Cowork cannot perform" describes a step that was completed three weeks ago.

**The honest unknown: whether those cookies are still valid.** Kijiji signs out easily
and `expires_at` is NULL on every row. Validity cannot be settled from the database; it
is settled by a run. But a dead session is a two-minute re-warm on the Mac, not a
structural blocker in front of a channel.

## 2. `account_status` is an operator dropdown, not a derived fact.

`updateDistributionChannelAccount` (`app/dashboard/settings/actions.ts:433,469`) reads it
straight off the Settings form and upserts it. Allowed values are the nine in
`CHANNEL_ACCOUNT_STATUSES` (`lib/distribution-capabilities.ts:192-201`), `connected`
among them. **Nothing in the worker or the app ever sets it from the presence of a
session.** Growth Test kijiji reads `connected` for the same reason: somebody picked it
in a dropdown.

## 3. The Kijiji posting lane does not read `account_status` at all.

Every read of the field in `vacantless-worker/src`:

| file:line | what it does |
|---|---|
| `phase-b-submit-facebook.ts:162` | **gate**, `!== "connected"` |
| `phase-b-submit-instagram.ts:137` | **gate**, `!== "connected"` |
| `takedown-leaseup.ts:176` | **gate**, `!== "connected"` |
| `phase-b-submit.ts:1590` | write only, sets `needs_login` on a dead session |
| `phase-b-submit-paid.ts:338` | write only, same |
| `claim.ts:25` | type field, selected and never compared |

`spendAuthorizationIssue` (`claim.ts:68-76`) is the whole worker-side gate for a paid
claim and it checks `automation_authorized`, `requires_payment`, `spend_authorized`,
`spend_revoked_at`, `spend_max_cents`. **`account_status` is not in it.**

What `needs_setup` DOES cost Agile, app-side: `lib/auto-distribution.ts:77`,
`lib/distribution-publish.ts:500`, `lib/channel-publish-autofire.ts:64`,
`lib/relist-radar.ts:440` and the lease-up takedown all require `connected`. So relist
radar cannot refresh an Agile Kijiji ad and the takedown path cannot fire. Those are real
but none of them is the decided paid-posting lane, and the app cron could never be that
lane anyway (`route.ts:292` hardcodes `paymentCleared: false`).

## 4. The gate that is actually shut

`distribution_channel_accounts`, Agile kijiji [read 2026-09-04]:

```
account_status        needs_setup      <- cosmetic for this lane
automation_authorized TRUE             <- already open
requires_login        TRUE
requires_payment      TRUE
spend_authorized      FALSE            <- THE GATE
spend_max_cents       NULL             <- THE GATE
spend_period_max_cents NULL
spend_revoked_at      NULL
posting_policy        human_confirmed
```

`spendAuthorizationIssue` returns **`spend_not_authorized`** today. Grant it and it
returns null.

**One Settings save closes all of it**, because that save writes `account_status`,
`spend_authorized`, `spend_max_cents` and `requires_payment` together. Tick the box AND
set a positive ceiling in the same save, or `settings/actions.ts:495` writes
`spend_revoked_at = now` instead.

## 5. Remaining real prerequisites (not blockers, but not nothing)

- **Spend ceiling has to clear a Lite ad**: $33.84 = 3384 cents, under the process-global
  `WORKER_PAY_MAX_CENTS` default of 5000. A per-org `spend_max_cents` below 3384 refuses.
- **Local `.env` points at Growth Test**, `TARGET_ORG_ID=8ea1da48-0cd2-45a4-bfba-023b31a67884`,
  `WORKER_ENABLED=` empty. Agile is `921f7c08-98af-428f-a238-36f4a781b0de` and
  `config.ts:75-82` HARD-ABORTS on it unless `ALLOW_AGILE_PROD=true`. Deliberate guard.
- **Where the worker runs.** `deploy/` is a Hetzner VPS with systemd units, and no session
  surface can reach that box. A Mac-local run is the only surface Cowork can help with.
- **The CVV wall still ends the lane** ([[project_kijiji_fee_wall_cvv]]). Nothing here
  changes that. This finding is about how far the automation gets BEFORE the wall.

## 6. Housekeeping spotted

- `vacantless-worker/WORKER_SUBMIT_LIVE=true` is a zero-byte FILE created by a mistyped
  command on 2026-07-23. Harmless, untracked, delete when convenient.
- An unrelated org, Abbas Husain, took a Kijiji run item to `publish_status = live` with a
  real ad URL at 2026-09-04 00:15Z, twenty-six minutes before this session opened.
  Not Agile, not our lane, noted so nobody reads it as Agile activity.

## The rule this produces

**A status column that a human types is not evidence about the system.** Before calling a
self-declared status field a blocker, grep for the reads. `needs_setup` rode four
sessions as "the thing blocking the whole channel" while the session it referred to had
been sitting warmed in the database since 2026-08-13.

[[project_agile_leasing_engine]] [[project_kijiji_fee_wall_cvv]]
