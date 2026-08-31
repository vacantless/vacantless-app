# Session 308 wrap, 2026-08-30: the decision was never where the system reads it

_Written 2026-08-30 20:40 EDT / 2026-08-31 00:40 UTC. Read-only session apart from two working-tree edits and four new files. Nothing committed, pushed, deployed, or written to the database._

> **WHY THIS FILE EXISTS HERE.** The S30x lane's own `NEXT-SESSION.md`, `SESSION_LOG.md` and wrap series live in the **`Vacantless QA + Product Build`** folder, which was NOT connected to this session and could not be granted (see BLOCKER below). This file is the S308 handoff, written into the repo `claude/` folder because that is the canonical, reachable, Codex-readable location. **Move or copy it into the QA lane's wrap series when that folder is next connected.**

---

## THE RESULT

Two verified defects found, both fixed and both stopped at the commit gate on purpose. Neither was the task anyone set out to do.

1. **The Kijiji PAID-ONLY decision was never encoded anywhere the system reads.** Four sessions carried it as a database defect. It is not one, and the fix everyone had queued would have been silently reverted.
2. **Production main has been RED for ten days** and nothing said a word.

---

## FIRST MOVE FOR SESSION 309

**Run `COMMIT-S308.sh preview` then `apply`** (project root). It commits the S308 catalog fix locally, on main, and does not push. Cowork cannot run it: `git commit` is a WRITE and writes are forbidden on the Mac bridge.

Then, and only after that commit lands, `APPLY-S308B-LANDLORD-CAMPAIGN-TEST-SEND-SELECT.sh preview` then `apply`. It is a separate change and `COMMIT-S308.sh` gates on nothing else being modified.

**TIME-ANCHORED, DO NOT PRE-EMPT.** The Unit 20 tracked-link experiment is read by scheduled task `trig_01VVvpkM8PTGBy3vTSgkqWzL` at **2026-09-05 13:00 UTC**. It is enabled and armed [verified 2026-08-30 via list_triggers]. Before that instant: do NOT read the result, do NOT write the attribution fix, do NOT re-edit any ad. S308 checked the clock and stayed out.

---

## FINDING 1: `requires_payment` is a CACHE, not operator state

`distribution_channel_accounts.requires_payment` is a **mirror of the static capability catalog**, rewritten on every Settings save. `settings/actions.ts:432` reads `channelCapability(channel)`, `:476` writes `cap.requiresPayment` into the upsert, and the same save runs `:494` `spend_authorized = false` and `:495` `spend_revoked_at = cap.requiresPayment ? nowISO : null`.

So the queued `UPDATE ... SET requires_payment = true` would have been reverted, with no error and no audit trail, by the next person to click Save on the Kijiji channel. **All ten rows already agree with the catalog. There was never anything to repair in the data.** The kijiji CAP simply never overrides the shared `requiresPayment: false` default at `distribution-capabilities.ts:61`; `rentfaster`, `viewit` and `costar_loopnet` do.

**The general rule, worth more than the Kijiji case: before "fixing" a column, find its WRITER.** A column some server action rewrites from a constant is a cache, not state. A decision recorded only in prose is not encoded anywhere.

### The gate, corrected

`spendAuthorizationIssue` is **not in the app at all**. It is `vacantless-worker/src/claim.ts:68`. Prior notes implied the app.

```
:69  !account                        -> "missing_account"
:70  automation_authorized !== true  -> "automation_not_authorized"
:71  requires_payment !== true       -> return null   PASS, skips everything below
:72  spend_authorized !== true       -> "spend_not_authorized"
:73  spend_revoked_at != null        -> "spend_revoked"
:74  !positiveCents(spend_max_cents) -> "spend_max_missing"
```

**The bypass is SILENT.** Both call sites (`:198`, `:299`) only record a refusal when `requires_payment === true` (`:204`, `:305`), so a pass at `:71` writes no audit row and no `error_code`.

**Both orgs pass the gate in full today.** What actually contains Kijiji is that `operator_submit_approved_at` is NULL on **every** Kijiji run item, all orgs, all time (count = 0 [verified 2026-08-30 via execute_sql]), and `claimApprovedJob` filters on it (`:279`). That is an approval-state accident, not a designed control. One approval makes a paid claim reachable with no spend authorization and no audit row. **The belt everyone believes is holding is not the one holding.**

### A discrepancy resolved rather than picked

Memory carried both "GT kijiji `automation_authorized` IS NOW true" and "GT kijiji approvals REVOKED". **Both are true, about two different objects**: the channel-account flag, and `distribution_run_items.operator_submit_approved_at`. There is no `distribution_approvals` table; the only spend table is `distribution_channel_spend`. Do not resolve a contradiction between two memory lines by deleting one. Find the two objects.

---

## FINDING 2: production main has been RED since 2026-08-20

`scripts/test-landlord-campaign.ts` fails on a clean clone of PROD `b3b9b97`. Bisected by checking out commits and running it:

| commit | date | result |
|---|---|---|
| `7f8e19d` | 2026-08-20 | 81 passed, 0 failed |
| `039a955` "S669 renter reply routing" | 2026-08-20 | **80 passed, 1 failed** |
| `b3b9b97` (PROD) | 2026-08-27 | **80 passed, 1 failed** |

`039a955` widened the landlord-campaign **test-send** org select from eight columns to the full campaign list, picking up `landlord_campaign_email`, and did not touch the test.

**Nothing leaked.** The routing control, "test send routes only to `test_to`", still passes; the `testMode` branch uses `to_email: normalizedTestTo!` and never reads `org.landlord_campaign_email`, which is only consumed on the real path at `:808`. The broken assertion is the weaker guard: do not even FETCH the landlord address on a test send. Worth keeping.

**One string fixes it and turns the whole repo green: 233 of 233 scripts pass, zero failures.** First fully green suite since 2026-08-20.

**A widened `select` is a behaviour change, not a refactor.**

**Nothing told anyone.** Ten days, seven production deploys, a red suite throughout. There is no gate running these 233 scripts on push. S308 only found it by cloning production main and running them by hand to check an unrelated change. **That absence is arguably the bigger finding.**

---

## VERIFIED STATE [all 2026-08-30]

| thing | value | method |
|---|---|---|
| PROD | `b3b9b97`, READY, aliased to app.vacantless.com + vacantless.com, `aliasError: null` | Vercel MCP |
| app local HEAD | `3e109b2`, main, **3 commits UNPUSHED** | git on bridge |
| app remote main | `b3b9b97` | `git ls-remote` |
| worker local HEAD | `89ef02c`, main, **1 commit UNPUSHED** | git on bridge |
| worker remote main | `8efb93b` | **GitHub read in Chrome** (ls-remote cannot auth from the bridge) |
| prod reachability | authenticated `/dashboard/properties` renders in Chrome | Chrome |
| box run mode | **UNVERIFIABLE this session**, port 22 unreachable. Last proven `submit:b:dark` (S305) | /dev/tcp probe |
| kijiji channel rows | `requires_payment=false`, `automation_authorized=true`, BOTH orgs | execute_sql |
| all 10 channel rows | `auto_submit_allowed=false`, `spend_authorized=false` | execute_sql |
| experiment task | `trig_01VVvpkM8PTGBy3vTSgkqWzL`, enabled, fires 2026-09-05 13:00 UTC | list_triggers |
| 2 paused tasks | still paused on purpose, `enabled` absent, `next_run_at` in the past | list_triggers |

**Pre-existing, not caused by S308:** `npm ci` fails on a clean clone of `b3b9b97` (`Missing: @swc/helpers@0.5.23 from lock file`); `npm install` resolves it. The lockfile is out of sync with `package.json` on main.

---

## UNCOMMITTED STATE HANDED FORWARD

Working tree, app repo, on top of local `3e109b2`:
- `lib/distribution-capabilities.ts` (+1/-0)
- `scripts/test-distribution-copilot.ts` (+2/-2)

Untracked in `vacantless-app/claude/`:
- `FINDINGS-S308-KIJIJI-PAID-ONLY-IS-NOT-IN-THE-CATALOG-SO-THE-DB-CANNOT-HOLD-IT.md`
- `FINDINGS-S308-MAIN-HAS-BEEN-RED-SINCE-S669-LANDLORD-CAMPAIGN-TEST-SEND.md`
- this file
- `DRAFT-NARAYAN-PILLETTE-PRICE-HYPOTHESIS-S672.md` **left untracked ON PURPOSE**, the pricing lane closed in S672

Project root, executable, previewed clean, abort paths proven:
- `COMMIT-S308.sh`
- `APPLY-S308-KIJIJI-REQUIRES-PAYMENT.sh` (already applied; kept for reference and reversal)
- `APPLY-S308B-LANDLORD-CAMPAIGN-TEST-SEND-SELECT.sh` (NOT applied)

Reverse everything with `git checkout -- lib/distribution-capabilities.ts scripts/test-distribution-copilot.ts`.

---

## OUTSTANDING

1. **Commit S308** (Noam, script ready). Then **apply and commit S308b**.
2. **Push and the DB backfill, together.** Pushing main triggers a Vercel production deploy and ships landlord-facing paid wording to the LIVE Agile org. The backfill is `update distribution_channel_accounts set requires_payment = true where channel = 'kijiji'`. **Between them the catalog says paid and the worker still reads free**, so do not leave a long gap. Both are gates Noam owns.
3. **Connect `Vacantless QA + Product Build`** via the desktop folder picker. `device_request_folder_access` is REFUSED for it.
4. **OPTIONAL, not a task:** a CI gate that runs `scripts/test-*.ts` on push. This session is the argument for it.
5. **OPTIONAL:** the `npm ci` lockfile drift on main.

---

## CORRECTIONS AND MISSES THIS SESSION

- **My preflight clock went stale.** `date -u` read 11:47 UTC at preflight; the DB later read 22:03 and an external HTTP `Date` header confirmed it. The session had idled about ten hours across an MCP reconnect. I reported the early time to Noam and had to correct it. **A `date` read at preflight is not valid for the whole session, and this project's FIRST MOVE gates are time-anchored.** By session end UTC had rolled to 2026-08-31 while Toronto was still 2026-08-30, the exact calendar-day trap the DON'T RE-MAKE block warns about.
- **A gate proof that proved nothing.** My first attempt to prove `COMMIT-S308.sh`'s gates bite used a scratch repo whose base commit already contained the edits, so the diffs were empty and three tests aborted at GATE 2 instead of their intended gates. Rebuilt the fixture with pre-patch originals as the base. **A perturbation test that fails at the wrong gate is not evidence about the gate you meant to test.** Same family as the S306 miss.
- **Nearly reported a false clock bug.** The 10-hour gap looked like DB/shell clock skew. Checking an independent source first (HTTP `Date`) showed both were right at different times.
- **Assumed `spendAuthorizationIssue` was in the app** because prior notes implied it. One grep corrected it.

---

## NEW STANDING FACTS

- **RE-READ THE CLOCK at any time-anchored gate.** Preflight `date` goes stale.
- **Neither shell reaches `vacantless.com`.** Cloud egress is `connect_rejected` by org policy; the device VM says "Network is unreachable". Prove reachability in **Chrome**.
- **Session-number collision.** `SESSION_LOG.md` in the Agile folder already contains SESSIONS 300-309 dated **2026-06-22** from an exhausted series. The current S30x series is a different, newer one in the QA folder. **Do not add today's S308 to that log; it would collide with the 2026-06-22 entry.**
- **`device_request_folder_access` can be REFUSED outright**, not merely declined. That is different from S662's grantable case, and the folder picker is then the only route.
