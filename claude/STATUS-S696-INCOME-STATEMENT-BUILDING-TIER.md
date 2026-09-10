# STATUS S696: the income statement gets its building tier, so a triplex's costs stop vanishing into Unassigned

Date: 2026-09-10 (Session 696). Follows `FINDINGS-S696-RENT-REACHES-THE-UNIT-EXPENSES-CANNOT.md`, which measured the problem against Davis Muscovitch Rentals and 506 Manning.

**Not committed.** Three files changed on the Mac, plus this doc and a commit script. `COMMIT-S696-INCOME-STATEMENT-BUILDING-TIER.sh` commits and does not push. **No migration. No product data written. No Meta path touched. No control named in the App Review material renamed.**

## What was wrong

The income statement's v1 sent every building-scoped cost to the portfolio "Unassigned" bucket. `DESIGN-PREMIUM-PNL-INCOME-STATEMENT-S525.md` says so on purpose: "Per-building nesting (like the statement's `buildings` tier) is v2." This is v2.

It matters because a multi-unit building's real costs are building costs. 506 Manning's June bills are property tax $938.19, water $695.50 and gas $102.00, and none of them can honestly be filed against Unit 2. So the statement showed three unit rows with revenue and no costs, and a separate Unassigned line holding money that plainly belonged to the building.

## What changed

`lib/income-statement.ts` gains a building tier that mirrors `buildOwnerStatement`'s, so the two reports group a portfolio the same way:

- A building-scoped cost is held OUT of the per-unit `rows` and carried on its building's shared line. **Unassigned now means what the word says: tied to neither a unit nor a building.**
- New `buildings: IncomeStatementBuildingRow[]`, each with its unit rows nested underneath, a `shared` line, and a subtotal of the two. New `hasBuildingShared`. New exported `isStandaloneUnit`.
- **Shared costs are deliberately NOT pro-rated across the units.** Same rule the owner statement already follows: an allocated figure is an estimate, and every per-unit number in this report is meant to be literally true. If per-unit allocation is ever wanted it should be a labelled estimate on top, never a silent split.

`app/dashboard/money/income-statement/page.tsx`: the table runs line items down the side and properties across, so the tier is expressed as column order. Columns now come out grouped by building, each building's units followed by a "(building-wide)" column. A new `CategoryLineRow` keys category cells by COLUMN, not by `propertyId`, because a building-wide column carries a null `propertyId` and would otherwise collide with Unassigned.

The CSV is now ONE grouped table instead of a flat one, for a reason given below.

## The invariant, stated plainly

```
totals.X == sum(rows[].X) + sum(buildings[].shared.X)
```

for operating expenses, interest, principal and expense count. Every in-range cost is added to the portfolio total exactly once and then routed to exactly one of a unit row or a building's shared line. Tested for all four columns, not just the first.

## What a cold reviewer found, and what was done

A reviewer who had not seen the work being written was asked to attack the money. One P1 and four P3s were real.

**P1, fixed: the CSV stopped footing to its own TOTAL.** The per-property block still listed only unit rows while TOTAL was computed over every cost, so the building-wide money sat in the total and in no line above it. On the 506 Manning shape the block showed $327.70 of operating expenses against a TOTAL of $1,961.39. **This is the file an accountant opens**, both from the export route and inside the accountant-package zip. Fixed the way `statementToCsv` already does it: one grouped table (building subtotal, indented units, indented building-wide line) that foots by construction, rather than a flat table with a building block bolted on after.

**P3, fixed:** the page derived its shared column key from the raw `building_key` while the model trimmed it, so a padded key would have shown $0.00 on a category line while NOI showed the real cost. Both trim now. **P3, fixed:** the overhead bucket was getting a subtotal header plus an identical child row. **P3, fixed:** a dead `groupCostByBuilding` import. **P3, fixed:** the explanatory note was emitted inside the numeric block and unconditionally.

**P3, accepted, not fixed:** a `building_key` that no property carries falls back to showing the raw key as a column label, and two buildings on the same street can produce two identically labelled columns. Both are inherited from the owner statement, both are cosmetic, and neither moves a number.

**P2, deliberately NOT fixed, and now pinned by a test: T776 has no building tier.** It still buckets a building-scoped cost into its own Unassigned row, so inside one accountant package `t776-tax-package.csv` shows an Unassigned property block that `income-statement.csv` no longer has. **Portfolio totals still reconcile**, which is what the two files' cross-check asserts. The reviewer also caught that `test-t776.ts`'s per-property reconciliation loop passed only because its fixture had no building-scoped cost, so the guard had stopped guarding. A test now states the divergence outright, so changing it has to be a decision rather than a drift. **Giving T776 the same tier is the obvious follow-up.**

## Proof against the real numbers

June 2026, Davis Muscovitch Rentals, the actual figures from PROD.

As the data sits today, every cost unscoped:

```
506 Manning Avenue        rev 7396.00  opex    0.00  NOI 7396.00  int    0.00  net 7396.00
   Unit 1 (Main)          rev 2620.00  opex    0.00  NOI 2620.00
   Unit 2 (Upper)         rev 3352.00  opex    0.00  NOI 3352.00
   Unit 3 (Lower)         rev 1424.00  opex    0.00  NOI 1424.00
Unassigned / overhead     rev    0.00  opex 1900.69  NOI -1900.69
```

Once triage scopes the building bills to the building, the cleaner to the units she cleaned, and files the $1,950.69 `Loan interest` row that is still sitting untriaged:

```
506 Manning Avenue        rev 7396.00  opex 1900.69  NOI 5495.31  int 1950.69  net 3544.62
   Unit 1 (Main)          rev 2620.00  opex   65.00  NOI 2555.00
   Unit 2 (Upper)         rev 3352.00  opex  100.00  NOI 3252.00
   Unit 3 (Lower)         rev 1424.00  opex    0.00  NOI 1424.00
   Building-wide          rev    0.00  opex 1735.69  int 1950.69  prin 2258.41
```

Net income falls from $7,396.00 to $3,544.62. The first number was never real.

**Note what this does and does not do.** The code change makes the correct answer reachable. It does not fix Noam's data: all 10 bank-derived expenses still carry a null property AND a null building key, so the "as it sits today" picture is what he would see until someone scopes them. **No production data was written this session.**

## Verification

- `tsc --noEmit` clean; `eslint` clean on all changed files.
- `test-income-statement` 78/78 (was 63), `test-statements` 107/107, `test-t776` 53/53 (was 49), `test-accountant-package` 57/57, `test-spend-analysis` 31/31.
- Plain-language gate: **offenders 679, baseline 679, new or worse 0.** Unchanged.
- Em dashes removed from the two user-facing strings on the page that carried them.

**The footing check is proved able to fail**, per the broken-proof rule. It rejects a doctored TOTAL, and it rejects a reconstruction of the exact pre-v2 flat table. The first version of that negative test passed for the wrong reason (it deleted indented child lines, which the checker skips by design) and was replaced.

## Follow-ups, ranked

1. **Give T776 the same building tier**, so the two files in the accountant package agree per property and not only in total.
2. **An interest input.** A bank feed cannot split a mortgage payment into principal and interest; today every payment defaults to all-principal, so the statement claims zero interest deduction. Either a per-loan record or a plain annual-interest field the landlord types once from the mortgage statement.
3. **Scope the four confident 506 Manning rows and the interest row** in triage, to exercise the path on real data. That is a production data write and has not been done.
