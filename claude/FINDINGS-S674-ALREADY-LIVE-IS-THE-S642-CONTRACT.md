# S674: `already_live` is not a defect, it is the S642 contract, and the attempt table is 94% cron

_Written 2026-08-31 EDT (2026-09-01 UTC). Every figure read from production via the Supabase MCP,
read-only. Every code claim is a quoted line at `file:line`. Nothing was deployed, migrated, or
written to the database._

**This corrects step 1 and step 2 of section 7 of
`FINDINGS-S673-THE-ENUM-ALREADY-EXISTS-IN-METADATA.md`.** S673's central correction of S309 stands
and gets stronger. Its own two prescribed fixes do not survive contact with the code.

Baseline re-derived at the top of this session, not carried:
**PROD `82776e6`** [`dpl_EPZj62eUfYjMhcr4qLfhiWpPjkiC`, READY, target production, verified
2026-08-31 via the Vercel MCP under team `team_ZXGSRj58HSrUPu0FZJ9I46qV`].
**Schema `0223`**, read from the object: `get_public_listing` still carries `status <> 'draft'`
[verified 2026-08-31 via `pg_get_functiondef`].
**Worker `origin/main` = `8efb93b`.** Local `main` is **one commit ahead and unpushed**,
`89ef02c "S304: add a dark mode to the autopilot sweep"`, touching only
`src/autopilot.ts`, `src/autopilot-channels.ts` and `scripts/test-autopilot-channels.ts`. Every
anchor in this document and in the S674 build prompt is byte-identical at `8efb93b` and at
`89ef02c` [verified by `git grep` at both revisions].

---

## 1. The headline: the attempt table is 94.3% freshness-cron rows

| slice | rows |
|---|---|
| `distribution_publish_attempts` total | **1,986** |
| `metadata->>'source' = 'distribution_freshness_cron'` | **1,872 (94.3%), 22 run items** |
| everything else, i.e. every real publish attempt ever | **114** |
| `status_after = 'stale'` | 1,831 |

[verified 2026-08-31 via Supabase.]

S309 and S673 both quote statistics "of 1,986" or "of 1,973". **That denominator is a monitoring
cron writing no-op rows**, the same cron memory already records as inflating `attempt_count`. It was
never going to carry an `error_code`, a `live_url` or an outcome.

So the sentence "**`error_code` is 0 of 1,986**" is true and means almost nothing. The honest
version is: **0 of 114 real attempts carry an `error_code`, and 0 of 1,986 carry an
`error_message`.** The fix in section 4 is still worth doing. The number that justified it was
inflated seventeen-fold.

**Rule: on `distribution_publish_attempts`, exclude `distribution_freshness_cron` before counting
anything, and then count per run item.** S673 said "measure per run item, never per attempt". This
is the same rule one level up: measure per real attempt, never per row.

## 2. `already_live` is the deliberate S642 worker contract

S673 step 1 reads: *"Fix `already_live`. An attempt that captured a `live_url` must not land at
`needs_operator`. Worker change, normal review and deploy."*

**The worker is forbidden from doing anything else, on purpose, in three places.**

The comment sits directly above the call, `vacantless-worker/src/phase-b-submit.ts:2969-2971`:

> `// S642 worker contract: even after a proven live Kijiji post, leave the run`
> `// item at needs_operator with external_url so the app's completeConciergeItem`
> `// path performs the final go-live/proof write.`

The app carries the same rule as an assertion that throws. It governs the app's own cron publisher
(`app/api/cron/distribution-worker/route.ts:294` calls it before every gate write, and
`scripts/test-distribution-worker.ts:211` asserts that the route still calls it), so it is the rule
stated twice against two different writers rather than a guard on the Node worker itself.
`vacantless-app/lib/distribution-worker.ts:94-99`:

> `export function assertWorkerNeverTerminal(status: string): void {`
> `  const forbidden = ["live", "submitted", "skipped", "rejected"];`

headed by `vacantless-app/lib/distribution-worker.ts:88-91`:

> `Belt-and-suspenders guard the cron calls before writing publish_status: the`
> `worker must never persist a terminal/live state. ... it exists to catch a future edit.`

And the worker's own `Landing` type cannot express any other landing,
`vacantless-worker/src/submit-logic.ts:29-30`:

> `export type Landing = {`
> `  publishStatus: "needs_operator" | "needs_login" | "needs_payment";`

**The other half of the handoff is shipped and visible.** The Publish-for-me desk computes
`hasCapturedUnconfirmedAd` at `vacantless-app/app/dashboard/admin/concierge/page.tsx:288-289`
(`Boolean(item.external_url) && status === "needs_operator"`), renders an emerald
**"Posted, awaiting confirmation"** panel with an "Open captured ad" link at `:362-378`, counts them
in the header as `postedAwaitingConfirmationCount` at `:226-230`, and
`concierge-actions.ts:399` blocks a second approval with `.is("external_url", null)`, redirecting to
`?err=already_posted` when an ad is already captured.

**Doing what step 1 asks would break a shipped, deliberate, guarded handoff and trip an assertion
written specifically to catch it.** This is the standing rule "check for a DELIBERATE STATE before a
status change", and S673 wrote the step without checking.

## 3. The `already_live` bucket is 5 run items, not 11 attempts, and two of the five are documented non-proofs

S673 section 3 diagnosed attempt-weighting as the flaw that produced 2.8%. **Its own section 4 then
reports `already_live` as "11 attempts" and prescribes a worker fix on that basis.** Per run item:

| run item | org | channel | attempts in bucket | `external_posted_at` | verdict |
|---|---|---|---|---|---|
| `4dc42e36` | Growth Test | kijiji | **7 of the 11** | null | the retry-loop item; `external_url` later cleared from the desk |
| `e8d80187` | Growth Test | kijiji | 1 | 2026-08-12 13:04 | real captured ad, still awaiting confirmation |
| `6407dcac` | Growth Test | kijiji | 1 | 2026-08-12 14:39 | real captured ad, still awaiting confirmation |
| `9cbff38e` | Growth Test | rentfaster | 1 | null | **false live from a classifier bug S633 already fixed** |
| `35dceeeb` | Agile | zumper | 1 | null | **a manage url the runner says is not proof, by design** |

[verified 2026-08-31 via Supabase.]

**Seven of the eleven are one item**, `4dc42e36`, the same item S666 identified as producing ten
distinct live Kijiji ads by itself. The bucket is the retry loop again.

**The rentfaster row's captured `live_url` is `https://www.rentfaster.ca/admin/add-listing/`**, the
form the runner had just filled. That is not an undiscovered defect. It is a **known bug that was
found and fixed**, and the fix comment names this exact URL,
`vacantless-worker/src/phase-b-submit-rentfaster.ts:58-64`:

> `S633 FIX: the old pattern (/rentfaster\.ca\/.*(listing|rental|ad|ref)/) FALSE-MATCHED the create`
> `form URL itself - "/admin/add-listing/" contains "listing" (and "ad") - so a publish click that`
> `never navigated (blocked by validation) was reported as "live" and marked published.`

The row is dated **2026-08-08**, before the fix. (Its `metadata->>'source'` is
`phase_b_submit_rentfaster`, which no literal grep finds because it is template-built at
`vacantless-worker/src/phase-b-submit-paid.ts:611`,
`` source: SUBMIT_LIVE ? `phase_b_submit_${spec.defaultChannel}` : ... ``. Search for the template,
not the string.)

**The zumper row's `live_url` is `https://www.zumper.com/manage/properties/listing/649459`**, a
back-office page. The runner says so itself, `vacantless-worker/src/phase-b-submit-zumper.ts:410-418`:

> `S567 - ZUMPER DELIBERATELY DOES NOT MARK ITSELF LIVE, and this is not an oversight. Its liveUrl`
> `is page.url() read straight after the Publish click: a manage url, not the ad's own status.`

**So the strict count of run items that reached a proven public ad detail page is 3, all kijiji**
(9 attempts, 3 items) [verified 2026-08-31 via Supabase]. S673's "5 of 11 ever reached live" counts
both non-proofs in its numerator. **n = 11 items was already far too small to price on. It has not
improved.**

### The trap this sets for S673 step 4

S673 step 4 is *"Backfill the classification from existing metadata"*. **Historical metadata carries
the classifier output that was live when the row was written.** The rentfaster row is a row written
by a classifier that has since been fixed. A backfill imports the S633 bug, and every other
pre-fix classifier state, as if it were fact, then hands the result to a pricing decision.

**A metadata backfill must be dated against the fix history of the code that wrote it, or it is not
evidence.** At minimum, exclude rows written before the fix for the channel they belong to, and
never treat a `live_url` as proof without the runner's own definition of proof for that channel
(kijiji has the S567 `/v-` bar; zumper by design has none).

### What IS real, and it is operational

`e8d80187` and `6407dcac` captured live Kijiji ads on 2026-08-12 and have been sitting on the
Publish-for-me desk under "Posted, awaiting confirmation" ever since. **Nineteen days.** The code
did its job and handed off. Nobody took the handoff. That is the actual `already_live` finding, and
no worker change addresses it.

## 4. Step 2 hits a name collision, and it is a real migration, not a one-liner

S673 step 2: *"Give the deliberate stop its own status. `submit_ready` is not an escalation."*
The finding is correct. The implementation is not free.

- The DB check constraint `distribution_run_items_publish_status_check` allows exactly
  `blocked, queued, submitting, submitted, needs_operator, needs_login, needs_payment, live,
  rejected, skipped` [read from `pg_get_constraintdef`, 2026-08-31]. A new value needs a migration,
  **migration first**, because code that writes a value the constraint rejects fails closed.
- **`submitted` is already taken and means something else.** It is the feed-partner status,
  "feed submitted to a partner, awaiting acceptance" (`lib/distribution-capabilities.ts:215`), it is
  live on **11 run items** today, and it is in `assertWorkerNeverTerminal`'s forbidden list. Reusing
  it for the Kijiji stop gate would silently merge two unrelated meanings.
- The worker's `Landing.publishStatus` union has to widen, and so does everything downstream:
  `normalizePublishStatus`, `isResolvedPublishStatus`, the desk query and filters, the run timeline,
  and the launch-coverage layer.

**This is its own slice with a migration, not a step to bundle into a wire change.** It should be
scoped as one, after step 3.

## 5. The spend refusal writes an error code onto current state and no attempt at all

While tracing the writers: `recordSpendAuthorizationRefusal` (`vacantless-worker/src/claim.ts:88-121`)
writes `error_code: "spend_authorization_required"` and an `error_message` onto
`distribution_run_items` and **records no attempt row**. Run items are current state, so the next
pass overwrites it and the refusal leaves no history. That is the same silence memory already
records for `automation_not_authorized`, one layer down: not just no audit row on the skip, but no
durable trace of the refusal either.

## 6. Revised sequence, replacing S673 §7 steps 1 and 2

1. **Drop step 1.** `already_live` at `needs_operator` with an `external_url` is correct behaviour.
   Reclassify it out of the failure bucket in the measurement, do not change the worker. The real
   item is operational: two Growth Test kijiji ads have been awaiting desk confirmation since
   2026-08-12.
2. **Ship the `error_code` wire** (was step 3, now first because it is the only one with no
   migration and no contract change). Build prompt:
   `CODEX-PROMPT-S674-WIRE-ERROR-CODE-INTO-THE-ATTEMPT-ROW.md`.
3. **Then scope `submit_ready` as its own slice**, migration first, with a name that is not
   `submitted`.
4. **Then re-measure**, excluding `distribution_freshness_cron`, counting per run item, and dating
   every metadata classification against the fix history of the runner that wrote it. Step 4 of
   S673 (backfill from metadata) is only safe with that dating applied.
5. S309 steps 3 to 5 stand unchanged: session `expires_at`, `external_account_label`, the credential
   consent record, then the tier boundary, then the console.

## 7. What does not change

Everything S673 got right, which is most of it: the reason enum already exists in
`metadata`, captcha is 0 and login is 3 of 78, the 2.8% is a retry artifact, `metadata.live` is the
run mode flag and not a result, and `error_code` needs a wire and not a column. This document
narrows two of its five steps and hardens its denominator rule. The strategic conclusion, that the
agency tier is the better-margin branch, is untouched.
