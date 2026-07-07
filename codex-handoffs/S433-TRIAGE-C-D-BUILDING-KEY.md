# S433 — Rent-triage parked items (c) bulk-ignore + (d) triplex-as-one-building

Review range: `c24de73..<HEAD after DEPLOY-S433>`

Two parked rent-triage items from KI631, both surfaced by the real 506 Manning
whole-account dogfood.

## (d) triplex-as-one-building — the root fix + the double-row cosmetic

**Root cause (proven on live data).** `properties.building_key` is a STORED
GENERATED column off the IMMUTABLE `building_key(address)` SQL function (0049).
The three Manning units were entered as `…, Unit 1 (Main), …` / `Unit 2 (Upper)`
/ `Unit 3 (Lower)`. The function stripped the `Unit N` token but NOT the trailing
`(Main)/(Upper)/(Lower)` parenthetical, so it survived in the street portion and
forked ONE physical building into three distinct `building_key`s. Consequences on
the By-building owner statement: a whole-building cost (mortgage/tax/insurance)
had no single building to attach to → "Unassigned / overhead"; and each
single-unit building double-rowed (bold header + one nested unit row for the same
figures).

**d1 — migration `0112_building_key_unit_parenthetical.sql` (APPLIED to prod via
the Supabase connector before deploy; the file is committed for the repo record).**
Extends the unit-token match to OPTIONALLY consume an immediately-following
parenthetical (`([[:space:]]*\([^)]*\))?`), so `Unit 1 (Main)` strips as one unit
segment. Deliberately surgical: a STANDALONE parenthetical NOT preceded by a unit
token (a genuinely distinct `123 Main St (North Tower)`) is left intact so two
real buildings on one lot never merge. Recompute is a no-op row rewrite
(`UPDATE properties SET address = address`) that forces the STORED generated
column to recompute — no DROP/ADD, no index churn.

Pre-flight verification on live data (all via `execute_sql`):
- Exactly **4 of 29** properties change key: the 3 Manning units collapse to
  `506 manning avenue, toronto, on m6g 2v7` + 1 QA leftover (`99 QA Test Lane,
  Unit S409 (create-with-photos)`). Verified post-apply.
- **ZERO** rows in `expenses` / `work_orders` / `categorization_rules` /
  `org_building_policies` reference any old Manning/QA key → nothing stranded by
  the recompute.
- Recompute mechanism validated in a rolled-back transaction before applying.

**TS mirror** — `lib/listing-fill-sheet.splitAddressUnit` gets the SAME regex
change (0049's no-TS/SQL-drift rule), so the building LABEL on the statement
matches the new grouping. `+3` tests.

**d2 — the double-row cosmetic (view + one pure helper).** New pure
`isStandaloneUnit(b)` in `lib/statements.ts` = `buildingKey != null &&
unitRows.length === 1 && sharedMaintenanceCents === 0`. The By-building table
(`rent/statement/page.tsx`) renders a standalone unit as a SINGLE row (its own
full address) instead of a bold building-header row + a redundant nested unit
row. Real multi-unit buildings (Manning is now one after d1) keep header +
nested rows; the "Unassigned / overhead" bucket (`buildingKey == null`) is
explicitly excluded. `+6` tests.

Deliberate scope note: the CSV export (`statementToCsv`) is unchanged — an
accountant's export keeps explicit Building-subtotal + Unit lines (they
reconcile); the felt "double-row" pain was the on-screen table.

## (c) per-account import scoping → bulk-ignore (c1)

A commingled personal-account OFX import dumps dozens of personal debits into the
To-review queue with no bulk clear (KI631a; S421 already fixed the
"Remember-this is future-only" half via the retroactive sweep). New
`ignoreAllPending` server action (`app/dashboard/expenses/actions.ts`): flips
every **pending debit** for the org to `ignored` in one org-scoped update
(`.eq organization_id`, `.eq triage_status pending`, `.eq direction debit`, then
`.select("id")` for the count). Guarded by `manage_work_orders` + a `confirm=1`
form token. It never touches the credits (rent) lane, another org, or already
filed lines; "ignore" is a SOFT status (no expense created, nothing deleted).
Button lives AFTER the queue list ("Ignore remaining {N}") so the operator files
real property costs first; `?ignored_bulk=N` banner.

## What to check
- `building_key()` regex: `Unit 1 (Main)` strips whole; a standalone
  `(North Tower)` with no unit token is untouched; existing `Unit/Suite/Apt/#`
  behavior unchanged.
- `splitAddressUnit` mirrors the SQL exactly (same standalone-parenthetical
  guard); `unit` still extracts the token.
- `isStandaloneUnit` excludes the null overhead bucket and any building with a
  shared cost or >1 unit.
- `ignoreAllPending`: org-scoped, pending+debit only, confirm token, soft status.

## Gates (verified in sandbox: node -r sucrase/register + npx tsc)
tsc clean; eslint clean on touched files; test-statements 103→**107/0**,
test-listing-fill-sheet 209→**213/0**, test-rent-from-bank 22/0,
test-bank-feed 34/0.

## S433b — folded Codex's one P2 (bulk-ignore scope/count mismatch)

Codex ACCEPTED S433 except one P2: the To-review queue renders only the 100 most
recent pending debits (`.limit(100)`), but the "Ignore remaining {pending.length}"
button called an action that ignored EVERY pending debit for the org. On a >100
line import the operator would silently ignore unseen rows that could include real
property costs (and ignored rows don't show in the normal UI). Fixed:

- `app/dashboard/expenses/actions.ts` — `ignoreAllPending` now reads the submitted
  line IDs (`formData.getAll("ids")`) and ignores ONLY those via `.in("id", ids)`.
  The org + pending + debit predicates stay as defense in depth (a stale/foreign
  id, a credit, or an already-filed line can never flip). Empty ids → no-op.
- `app/dashboard/expenses/page.tsx` — the bulk form now emits a hidden
  `<input name="ids">` per VISIBLE line, so it clears exactly what's on screen;
  button relabelled "Ignore these {N}". Added a true `pendingTotal` head-count;
  when more pending debits exist than the 100 shown, the helper text says so
  ("Showing the N most recent — M older lines will appear after you clear these"),
  and clearing the page reveals the next batch to sort. The action can never touch
  a line the operator hasn't seen.

Range for the fold: `b04083a..<HEAD after DEPLOY-S433b>`. Gates re-run: tsc clean,
eslint clean on the two touched files (pure-lib test suites unaffected — no lib
changed).
