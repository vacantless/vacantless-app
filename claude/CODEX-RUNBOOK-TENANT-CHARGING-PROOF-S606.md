# CODEX RUNBOOK — Prove "increase → tenant billed the new amount" on a Stripe Test Clock (S606)

**Status: verification run. Stripe TEST mode only — never a live charge. Do NOT flip
`LANDLORD_CAMPAIGN_ENABLED`. Do NOT touch product code.**

> **CURRENT STATUS (2026-07-31): Step 1 is DONE — commit `0bc51646` "test: add KI971 stripe invoice
> boundary proof" already enhanced `scripts/harness-stripe-slice-c.ts` to read real invoice line amounts
> and print the two-row `INVOICE @ before: $OLD / INVOICE @ after: $NEW / Effective date` proof; tsc+lint
> clean; `test-stripe-rent-update.ts` 24/0. Codex confirmed the harness SELF-PROVISIONS the Test
> Clock/customer/PM/product/price/subscription/schedule under the test key — NO connected-account id is
> needed. Only Step 2 remains, gated on `STRIPE_SECRET_KEY=sk_test_...` being exported into the shell.**

## Goal
A current, legible proof that the rent rail bills the tenant the **new** rent **only on the legal effective
date** (never before) after a served increase. Verified S467 (2026-07-12); re-run on today's `main`.

## Step 1 — DONE (commit 0bc51646). No action needed.
The harness now prints the literal invoice amounts across the effective-date boundary (OLD before / NEW
after) as a two-row summary. Do not redo it.

## Step 2 — run the proof (BLOCKED until a TEST key is exported to the shell)
Preconditions to state in the report: `STRIPE_SECRET_KEY = sk_test_…` (sandbox). The harness
self-provisions everything else. Then:
```bash
npx tsx scripts/harness-stripe-slice-c.ts
```
Assertions to capture:
1. Two-phase schedule created (phase 1 current → effective date; phase 2 new, open-ended; proration none).
2. Clock just **before** effective date → invoice bills the **OLD** amount (no early charge).
3. Clock **past** effective date → next invoice bills the **NEW** amount (the two-row printout).
4. Idempotency: a re-run / later edit **replaces** phase 2, never stacks a second schedule.
5. Report: harness pass/fail (target ≥ S467 13/0), the two literal invoice amounts + effective date, and
   `test-stripe-rent-update.ts` (24/0 today).

## Acceptance
- Step 2, once the sk_test key is available, is green and the report shows **OLD-amount-invoiced-before /
  NEW-amount-invoiced-on-effective-date** in test mode, no live money. That two-row invoice printout is
  Noam's tenant-charging proof. No product code change; keep any fixups to harness/test files.
