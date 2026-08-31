# S308: Kijiji PAID-ONLY is not in the capability catalog, so the database cannot hold it

_Session 308, 2026-08-30. Read-only session. Nothing was written to the database, no code was changed, nothing was committed, pushed or deployed._

## The headline

Every prior session recorded this as a data defect: `kijiji.requires_payment = false` in both orgs, so the spend gate never engages. That framing is wrong, and acting on it would not have worked.

**`distribution_channel_accounts.requires_payment` is not an operator-owned field. It is a mirror of the static capability catalog, re-asserted on every Settings save.** A direct `UPDATE ... SET requires_payment = true` would be reverted by the next person who opens Distribution settings and clicks Save on the Kijiji channel, with no error and no audit trail.

The S667 PAID-ONLY decision was never encoded where the system actually reads it. It is a decision recorded only in prose.

## Proof, read from source at local app HEAD `3e109b2`

**The catalog is the source.** `lib/distribution-capabilities.ts:61` sets the shared default `requiresPayment: false`. The `kijiji` entry (`:90`) overrides `supportsCopilot`, `supportsConcierge`, `requiresLogin` and `postingPolicy`, and **does not override `requiresPayment`**. Exactly three channels do override it to `true`: `rentfaster` (`:139`), `viewit` (`:154`), `costar_loopnet` (`:167`).

**The write path re-asserts it.** `app/dashboard/settings/actions.ts:432` takes `const cap = channelCapability(channel)`, and `:476` puts `requires_payment: cap.requiresPayment` into the upsert payload. The same save also runs `:494` `payload.spend_authorized = false` and `:495` `payload.spend_revoked_at = cap.requiresPayment ? nowISO : null`. So a Settings save on Kijiji does not merely revert `requires_payment`; it clears the entire paid posture and leaves `spend_revoked_at` null, which reads as "never revoked" rather than "revoked".

**The database is a faithful mirror, not a corruption.** All ten `distribution_channel_accounts` rows agree with the catalog: `viewit` and `rentfaster` carry `requires_payment = true`, every other row carries `false`. There is nothing to repair in the data. [verified 2026-08-30 via execute_sql]

## What the gate actually does, read from the worker

`spendAuthorizationIssue` is in **`vacantless-worker/src/claim.ts:68`**, not in the app. Earlier notes implied the app. The order is:

```
:69  !account                        -> "missing_account"
:70  automation_authorized !== true  -> "automation_not_authorized"
:71  requires_payment !== true       -> return null      LINE OF INTEREST
:72  spend_authorized !== true       -> "spend_not_authorized"
:73  spend_revoked_at != null        -> "spend_revoked"
:74  !positiveCents(spend_max_cents) -> "spend_max_missing"
```

Line 71 returns `null`, which means PASS. `spend_authorized`, `spend_revoked_at` and `spend_max_cents` are never read for Kijiji.

**The bypass is silent.** Both call sites (`:198` and `:299`) only record a refusal when `a?.requires_payment === true` (`:204`, `:305`). A pass at line 71 writes no `distribution_run_items` audit row, no `error_code`, nothing. There is no artifact anywhere showing that a Kijiji job skipped the spend gate.

## The live position, and what is actually containing it

Both orgs' Kijiji rows carry `automation_authorized = true` and `requires_payment = false`, so **both pass `spendAuthorizationIssue` in full**. Agile's row was written 2026-07-24, Growth Test's 2026-08-28 12:48. Neither has `automation_authorized_at` or `_by` set, which is the known signature of a write no UI could have made.

What is holding the line is not the spend gate. It is that **`operator_submit_approved_at` is NULL on every Kijiji run item in the database, all orgs, all time** [verified 2026-08-30, `count(*) where channel='kijiji' and operator_submit_approved_at is not null` = **0**]. `claimApprovedJob` filters on `.not("operator_submit_approved_at", "is", null)` (`claim.ts:279`), so no Kijiji job is claimable regardless of the spend posture.

That containment is an approval-state accident, not a designed control. One approval on one Kijiji item makes a paid claim reachable with no spend authorization and no audit row.

`auto_submit_allowed = false` and `spend_authorized = false` on all ten rows, so the second and third belts are also on. The point stands that the belt everyone believes is holding is not the one holding.

## Resolves a standing memory discrepancy

The memory index carried both "GROWTH TEST kijiji `automation_authorized` IS NOW `true`" and "GT kijiji approvals REVOKED". Both are true and they are about different objects:

- `distribution_channel_accounts.automation_authorized` = **true** for Growth Test kijiji.
- `distribution_run_items.operator_submit_approved_at` = **NULL** on every Kijiji item.

There is **no `distribution_approvals` table**; the only approval-shaped column is `operator_submit_approved_at` on run items, and the only spend table is `distribution_channel_spend` [verified 2026-08-30 via `information_schema.tables`].

## The fix, in the right order

The naive fix is a DB write and it is not durable. The correct shape is:

1. **Code first.** Add `requiresPayment: true` to the `kijiji` entry in `lib/distribution-capabilities.ts`. This is the only place the value originates.
2. **Backfill second.** Set `requires_payment = true` on both Kijiji rows so the worker sees it before anyone happens to open Settings.

Step 1 without step 2 leaves the worker gate open until a Settings save. Step 2 without step 1 is reverted by the first Settings save. Both are needed and step 1 is the durable half.

**Do not do this blind.** Turning `requiresPayment` on for Kijiji changes landlord-facing copy through `distribution-channels.ts:610/618/731/732/733`, which switch on `input.requiresPayment` to render "Use paid posting assist", "Needs payment/setup" and "Set up payment rules". That is a customer-visible change to a live product, and it is the argument for the gate rather than a reason to skip it.

## APPLIED AND VERIFIED (working tree only, nothing committed)

The catalog change was applied and built. **It is a two-file change, not one line**, and the build found the second file.

**`lib/distribution-capabilities.ts`** gains `requiresPayment: true` on the kijiji CAP. That alone breaks `scripts/test-distribution-copilot.ts`, which asserted at `:75` and `:83` that **"kijiji has NO payment gate"** and **"kijiji has NO payment stop-gate step"**. Those two assertions are the S651 decision ("Kijiji stays FREE") written down as a test. S667 reversed that decision, so the assertions are superseded, not violated. Both were flipped to mirror viewit's `:91`/`:92`.

**The downstream effect is the one we want, and it is automatic.** `buildCopilotScript("kijiji")` now returns `stopGates: ["login","payment","captcha","final_review"]` and emits a payment step reading *"Complete any paid placement on Kijiji yourself, Vacantless never enters payment details"*, identical in shape to viewit's. The operator gets a real payment stop-gate in the co-pilot flow, and the never-enters-payment invariant is preserved.

**Verification, run in the cloud container against a fresh clone of PROD `b3b9b97`** (`npx tsx` and `next build` cannot run on the Mac bridge):

- `npx tsc --noEmit` clean.
- `npm run build` exit 0.
- **Full script suite, 233 files: 232 pass, 1 fail.**
- The blast radius was isolated by running the same suite on an UNPATCHED baseline and diffing the failure sets. Baseline fails exactly one test; patched fails exactly the same one plus `test-distribution-copilot`. After flipping the two superseded assertions, patched and baseline fail the identical single test.

**A PRE-EXISTING FAILURE ON PRODUCTION MAIN, not caused by this change:** `test-landlord-campaign` fails on a clean unpatched clone of `b3b9b97`, on the assertion **"test send does not select landlord_campaign_email"** (80 passed, 1 failed). Unrelated to Kijiji. Worth its own look.

**Also pre-existing:** `npm ci` fails on a clean clone of `b3b9b97` with *"Missing: @swc/helpers@0.5.23 from lock file"*. `npm install` resolves it. The lockfile is out of sync with `package.json` on production main.

## Not done, deliberately

**No database write.** The backfill (`update distribution_channel_accounts set requires_payment = true where channel = 'kijiji'`) is a separate approved gate and was NOT run. Until it runs, the worker keeps reading `false` and the gate stays open, because the catalog value only reaches the database through a Settings save.

**Nothing committed, merged, pushed or deployed.** The two source edits sit in the working tree on top of local `3e109b2`. Backups: `lib/distribution-capabilities.ts.bak-pre-s308-requires-payment` and `scripts/test-distribution-copilot.ts.bak-pre-s308` (both ignored by the S307 `.bak-pre-*` pattern, confirmed: `git status` shows only the two `claude/` docs as untracked).

**To reverse:** `git checkout -- lib/distribution-capabilities.ts scripts/test-distribution-copilot.ts`. Nothing else was touched.

**The Unit 20 tracked-link experiment lane stayed closed.** Today is 2026-08-30, before the 2026-09-05 read date. No ad was edited, no result read.
