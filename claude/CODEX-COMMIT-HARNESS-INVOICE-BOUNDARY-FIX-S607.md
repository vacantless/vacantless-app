# CODEX — commit the harness invoice-boundary ordering fix (S607, test-only)

**Status: a working-tree edit to `scripts/harness-stripe-slice-c.ts` is already applied (by Cowork via the device bridge) and PROVEN GREEN. Review, lint, commit by name (KI971), push `main`. Test-only; NO product code touched. Do NOT flip `LANDLORD_CAMPAIGN_ENABLED`.**

## What changed and why
The S606 invoice-boundary enhancement (0bc5164) read the "after" invoice only 3 days past the effective date — before the next monthly bill cut — so it re-read the OLD invoice and the `invoice after effective date bills NEW1` assertion failed. Naively advancing the clock +35d to force the NEW invoice released the subscription schedule early and broke the `#2` sequential-increase test.

Fix = **reorder, not force**: the NEW-rent invoice capture (advance to the first monthly boundary after the effective date, read the invoice, assert NEW1, print the boundary proof) now runs LAST — after the `#2` schedule-update test — so advancing the clock can no longer disturb the still-active schedule. The mid-flow read + printout were removed from the transition block and moved to just after the `#2 schedule still has 2 phases` assertion. Advance is `check1.effectiveUnix + 30 * DAY` (crosses the ~Sept 30 boundary, stays before the `#2` NEW2 date).

## Proof (run on macOS, sk_test in shell)
`STRIPE_SECRET_KEY=sk_test_... npx tsx scripts/harness-stripe-slice-c.ts`
→ **15 passed, 0 failed**. Boundary proof: `INVOICE @ ~09-01: $2,200.00` / `INVOICE @ ~10-01: $2,241.80`, effective ~09-05. (Was 13/0 at S467; the 2 added assertions are the literal before/after invoice amounts.)

## Do
- `npm run lint`, `npx tsc --noEmit`, re-run the harness (needs sk_test) if convenient.
- Commit by name (the one file), push `main`, report sha. Keep any fixups to the harness/test files only.
