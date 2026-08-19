# DECISION - Kijiji goes PAID-ONLY, gated by a standing per-org spend authorization, cost passed through to the customer (S667)

_2026-08-19. Decided by Noam in session 667. This SUPERSEDES the S651 decision recorded in
`claude/FINDINGS-KIJIJI-PAID-RECON1-S651.md` ("Kijiji stays FREE, not paid")._

## The three decisions

1. **Kijiji becomes a paid channel.** Stop chasing the single free slot on the shared
   `admin@vacantless.com` account. Post on the cheapest paid package (observed **Lite $29.95**;
   Standard $53.79, Plus $95.13, Premium $254.25, all + tax).
2. **Consent is a STANDING PER-ORG SPEND AUTHORIZATION, not a per-post confirm.** An org authorizes
   a ceiling once. Inside the ceiling, posting stays single-click. Past it, the worker refuses and
   the item lands `needs_operator`.
3. **The fee passes through to the customer.** The landlord sees the line item.

## Why the S651 decision is being reversed, and what has to survive the reversal

S651 rejected the paid lane for one specific reason, quoted verbatim: **"it breaks single-click via
money consent."** That objection was never wrong and the S666 options paper never addressed it. It
is answered here, not overruled: a standing authorization moves the money consent from **per post**
to **per org, once**, so the single-click promise survives.

**The standing authorization is therefore a hard prerequisite, not a nice-to-have.** Shipping the
paid lane without it re-creates exactly the failure S651 refused. Do not enable
`WORKER_PAY_ONFILE` on any org before the authorization gate is in the claim predicate.

## What the code already gives us [verified 2026-08-19 by reading the repos]

**A spend ceiling already exists and already fail-safes correctly.**
`vacantless-worker/src/paid-plan-logic.ts:36` `decidePaidGate()` returns
`pay_onfile | needs_payment | over_ceiling`, and `over_ceiling` lands the item at
`needs_operator` with **no payment made** (`:99`). It is evaluated **twice** before the pay click
(`phase-b-submit.ts:1379` and `:1423`), with a second belt at `:1323` that returns `over_ceiling`
when the package total does not equal the base price, so a refused add-on or bundle cannot slip
through.

**But the ceiling is process-global, not per-org.** `phase-b-submit.ts:114`
`const PAY_MAX_CENTS = Number(process.env.WORKER_PAY_MAX_CENTS ?? 5000);` - one env var, default
**$50.00**, no DB column feeds it. That is the single thing this decision changes.

**The lane genuinely cannot spend money today.** `mappings/kijiji.json` `_meta.paidPlan` has
`basePackageCode: ""` and `savedMethodNames: ["^RECON_PENDING_SAVED_METHOD_NAME$"]`, a deliberate
never-match sentinel, and `phase-b-submit.ts:1387` / `:1431` force `needs_payment` whenever
`basePackageCode` is empty. The branch is dark by construction, not by luck.

**The per-org, per-channel row we need already exists.** `distribution_channel_accounts`, unique on
`(organization_id, channel)` (`0141_distribution_channel_accounts.sql:74`), already carries
`automation_authorized`, `automation_authorized_at`, `automation_authorized_by`,
`auto_submit_allowed` (`0177_distribution_worker_authorization.sql:22`) and `requires_payment`
(`0141:53`). **This is where the spend authorization belongs.** It is not a new table.

## Three defects this decision exposes. Fix them with the build, not after it

1. **`requires_payment` is selected and never tested.** `vacantless-worker/src/claim.ts:211` selects
   it; grep across the worker `src/` finds it at `claim.ts:24, 119, 211` only - a type and two
   selects, **zero uses**. A channel account flagged as requiring payment is claimed exactly like
   one that is free.

2. **`posting_policy` is written in six places and read in none.** Written at
   `settings/actions.ts:448`, `distribution-actions.ts:957/1032/1055`,
   `facebook-page-oauth.ts:282/322/376`. Grep found **no read or enforcement site anywhere.** The
   column offers `automatic_allowed | feed_only | human_confirmed | concierge_only | broker_only |
   not_supported` and none of them bind. This is the same failure shape as the Pillette 32
   do-not-advertise rule: **a rule that lives only in a field nothing reads does not bind the
   product.** Either enforce it or drop it.

3. **Operator approval is ALREADY treated as consent to spend.** `distribution-actions.ts:526`
   comments it explicitly: *"S631: approval consent covers both the free-channel operator gate and
   the paid-site payment gate. Approving a needs_payment item is the landlord's consent to the
   site's listing fee"*, and the update runs
   `.in("publish_status", ["needs_operator", "needs_payment"])`. So today a single operator click on
   a `needs_payment` item is legally the landlord's agreement to pay, with no ceiling, no per-org
   record and no audit of the amount. **That is the actual liability, and it exists right now,
   before any of this ships.** Splitting operator approval from spend authorization is what fixes
   it.

## The non-negotiables carried forward from the S666 options paper

- **A QA org must never post to a production channel account.** The worker's org gate protects
  against *deletes* (`phase-b-submit.ts:1578`, enforced `:2350`); there is no posting equivalent.
  Under a paid model a Growth Test loop no longer just burns a free slot, **it spends money.**
  This gate goes in before the first paid post, not after.
- **`listing_posts` still cannot model per-account state.** Its only unique index is
  `listing_posts_blank_draft_unique` on `(property_id, portal) where status='draft' and url is null`
  (`0144:26`), deliberately narrow, so multiple live rows per portal remain legal. Any
  listing-health signal built on it stays unreliable for Kijiji.
- **`codex/s666-duplicate-post-guard` (`6f262dc`) must land first.** Under a free model a duplicate
  post cost nothing. Under a paid model each duplicate is **$29.95**. The guard is reviewed and
  pushed; merge it before enabling any paid lane.

## Order of work

1. Merge `6f262dc` (`DEPLOY-S667-MERGE-DUPLICATE-POST-GUARD.sh`). Duplicates now cost money.
2. Per-org spend authorization on `distribution_channel_accounts`, enforced in the **claim
   predicate**, not only in the UI. See `claude/CODEX-PROMPT-KIJIJI-SPEND-AUTHORIZATION-S667.md`.
3. Posting-side org gate, so a QA org cannot spend a customer's money.
4. Pass-through billing line item.
5. Only then: recon `basePackageCode` and the real `savedMethodNames`, and light the lane on ONE
   org with a small ceiling.

## What is NOT decided

- The ceiling amount per org, and whether it is per month or per ad count.
- Whether pass-through is invoiced per ad or bundled with overage.
- Whether Kijiji is worth it at all once it is paid. **Agile has 202 Kijiji attempts and zero that
  ever produced a live ad from this system.** Revisit after the first paid month with real numbers,
  and be willing to take option D.
