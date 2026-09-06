# FINDINGS S681 - PR #9 is a phantom, and the Link Portals connect button promised what the app cannot do

Session 681, 2026-09-06.

## 1. "Merge PR #9 `70a2cf0`" was never a real task. CLOSE IT.

Carried across four handoffs as *"S674 error_code wire: PR #9 `70a2cf0`, unmerged,
undeployed, third session carrying it, no stated blocker."* Every element is wrong
[verified 2026-09-06 by full `git fetch` plus the GitHub PR page]:

- **PR #9 is a different PR.** "S631 Slice 3: Publish Everywhere co-pilot handoff + concierge
  queue", head `f43ddc3`, **MERGED 2026-08-08**, branch deleted the same day.
- **`70a2cf0` does not exist in the repository.** Not a commit, not on any branch, after
  fetching every remote ref. `git cat-file -t` reports a malformed object name. There is no
  `s674` or error-code branch on the remote at all.
- **The error_code plumbing is ALREADY IN MAIN.** `lib/distribution-attempts.ts:92` writes
  `error_code` from `input.errorCode`; the worker sets `kijiji_validation_error` at
  `phase-b-submit.ts:1571`; several app call sites write it.

**What is actually true:** 2,266 attempt rows, **zero** with a non-null `error_code`, zero
distinct codes. The wire exists and has never been exercised, because nothing gets far
enough to fail informatively. The cron is ~94% no-ops, the worker is dark, and the app cron
hardcodes `paymentCleared: false` so every kijiji job parks at `needs_payment` permanently.

**So this was never a merge problem. It is a "nothing runs" problem**, and it is downstream
of the session decision, not of a pull request. Caveat kept for honesty: a deleted branch
may once have held a refinement; what can be said is that nothing by that sha is reachable
and the plumbing is present.

## 2. The Link Portals "Log in" button promised a connection the app cannot make

`stage1ConnectHref` sends an `account_login` channel to
`/dashboard/settings?tab=distribution#channel-<key>`. The only control there writes a
**self-declared `account_status` dropdown** plus `automation_authorized`. **There is no
session-ingestion route anywhere in the app.** `lib/distribution-session-crypto.ts` exists;
nothing feeds it. The only artifact that works is a Playwright `storageState` captured by a
terminal command needing the service-role key.

So the old copy read:

- `stage1.kindLogin`: *"You use your own account for this site."*
- `stage1.buttons.login`: *"CLICK HERE TO SET UP YOUR {name} ACCOUNT"*

A landlord clicks "set up my Kijiji account", lands on a menu, picks "connected", and
nothing is connected. **That is the fastest way to lose a new signup, and it is exactly what
happened to the org whose concierge request then sat 48 days.**

**Shipped:** honest copy in `en` and `fr`, plus
`scripts/test-stage1-connect-copy-truth.ts` (22 assertions) which fails the build if the
copy ever claims setup or connection again, if the disclaimer is dropped, if an
`account_login` channel starts pointing at a real connect endpoint, or if anything but the
Meta channels claims `oauth`. A caveat comment now sits above
`CHANNEL_INTEGRATION_STATUSES` explaining that `live` means "has a post path", not "the
landlord can connect it".

**This is copy, not capability.** It stops the product overpromising. The fix that would
make it true is the self-serve session decision, which remains Noam's.

[[project_the_funnel_works_the_front_door_does_not]] [[project_agile_leasing_engine]]
