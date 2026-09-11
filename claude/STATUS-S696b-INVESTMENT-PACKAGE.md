# STATUS S696b: the investment package is built, and a cold review found two P1s in it

Date: 2026-09-11 (Session 696). Follows `FINDINGS-S696-MONETIZATION-THE-DOCUMENT-IS-THE-PRODUCT.md`, which argued the document is the product, and the question "what is not built that would be the biggest lever."

**Not committed.** Five new files plus this doc and a proposal. `COMMIT-S696b-INVESTMENT-PACKAGE.sh` commits and does not push. **No migration. No production data written. No Meta path touched. No control named in the App Review material renamed.**

## What it is

The outward-facing document for ONE building: the thing a seller hands to the market and a buyer's lender reads. Not another internal report.

| File | What it is |
|---|---|
| `lib/investment-package.ts` | Pure. Assembles the package and decides what may be published. |
| `scripts/test-investment-package.ts` | 75 assertions, most of them about what it refuses. |
| `app/dashboard/money/investment-package/load.ts` | One loader, shared by the page and the export, so they cannot drift. |
| `app/dashboard/money/investment-package/page.tsx` | Premium gated, building picker, period, asking price. |
| `app/dashboard/money/investment-package/export/route.ts` | The same package as CSV. |

It **assembles rather than recomputes**: the rent roll from `lib/rent-roll`, the operating numbers from the income statement's building tier shipped earlier today, the cap rate from `computeCapRate`. What is new is the lease expiry schedule, the rent gap, and the basis.

## The design rule, which is the actual point

Every other report in this codebase is read by the OWNER, who knows what is missing from their own books. **This one is read by a BUYER who does not.** So the package states the basis for every number and withholds any figure it cannot stand behind.

A cap rate is published only with all of: at least one operating cost item, at least three distinct months carrying one, a bounded period, at least ninety days of elapsed window, an asking price, and some in-place income. Short of any of those it comes back null with a sentence saying why. Same for the rent gap, which reports "not measured" rather than zero.

## What the cold review found, and what changed

A reviewer who had not seen the work written was asked to make a wrong number escape. **Two P1s, and both had the same root cause: I passed the module pre-computed summaries instead of the cost rows, so it could not tell which costs were this building's.**

**P1, fixed: the operating breakdown was the whole organization's costs.** `statement.operatingCategories` is built over every cost row with no building filter, while the headline came from the building row. A one-building document would have shown another property's spend, in a category line, to a third party, and contradicted its own total. Probed at $19,577.76 of lines against a $1,800.00 headline.

**P1, fixed: the default period published year-to-date cost as the annual figure.** "This year" spans 365 days, so nothing was scaled, and the basis block said in plain words that it had not scaled. On a triplex with $12,000 of cost recorded by September 11, that publishes a 4.80% cap rate where the run rate is 4.47%, with no warning. **Exactly the number the module exists to refuse.** The window is now clamped to the days that have actually elapsed.

The fix for both is structural: the package now takes the cost rows and applies `costBelongsToBuilding`, the same predicate `buildIncomeStatement` uses to attribute money. The gate and the money can no longer be measured over different sets.

Also fixed from the review: a lease already past its end date was counted as "rolling soon" and bucketed into a past month (it now has its own hold-over bucket and a warning); a building with no key bound to the organization's overhead bucket and reported somebody else's money as its own; financing rows inflated the cost-item count and suppressed the loudest warning; and three month LABELS inside a thirty-one day window passed the gate, so a ninety-day floor was added.

Accepted and not fixed: `parsePriceDollars` strips a minus sign, duplicate React keys on keyless buildings, and the unit label dropping a "(Main)" style alias. All cosmetic, none moves a number. Recorded here so they are a decision.

## Known and deliberate

**The rent gap has no source yet.** `load.ts` passes no market rent, so the gap is always unmeasured and says so rather than printing zeros. `lib/market-rent.ts` already computes a suggestion from the org's own comps, and wiring `suggestRentRange` per unit is the single most valuable next slice, because "are the rents at market" was the first question a real buyer asked about 18 Shorncliffe.

## Verification

- `tsc --noEmit` clean, `eslint` clean on all five files.
- `test-investment-package` **75/75**. Full suite **242 scripts, 3 failures**, the same three known reds.
- Plain-language gate: offenders 679, baseline 679, new or worse 0.
- No em dashes in any new file.

**The central refusal is guarded both ways**: the suite proves the cap rate is withheld on thin, unbounded and short-window bases, and also proves it IS published when the basis is sound. A guard that can only fail one way proves nothing.

## Follow-ups, ranked

1. **Wire market rent** from `suggestRentRange`, so the rent gap is real.
2. **A print-ready render**, since the artifact people actually hand over is a PDF, not a web page or a CSV.
3. **Capital improvements** have no home in the schema. 18 Shorncliffe needed one and it was a hand-made PDF.
