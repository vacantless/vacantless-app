# S432 — Surface the counterparty / MEMO line in expense triage

**Review range:** `b70c3de..<new HEAD>` (single commit)
**Scope:** view-layer only + one pure helper + its tests. No migration, no money path, no schema change.

## Problem (real dogfood data, Manning org 9315e41e)
`bank_transactions` rows render their primary label as `merchant ?? description`.
RBC's OFX export puts the generic transaction **type** in `merchant` (OFX `NAME`)
and the actual **counterparty** in `description` (OFX `MEMO`):

| `merchant` (shown) | `description` (hidden) |
| --- | --- |
| `e-Transfer sent` | `Kathy Boose XMVQS7` |
| `e-Transfer - Autodeposit` | (the tenant who paid) |
| `Misc Payment` | `AGILE REAL ESTA`  ← a $3,000 rent credit |
| `Bill Payment` | `Hydro One` |

So on every RBC row the counterparty was invisible, which makes the "is this
credit rent?" lane and the expense-triage lane guesswork.

## Change
- `lib/bank-feed/index.ts`: NEW pure `txnDetailLine(merchant, description)` →
  returns the counterparty/memo string to show as a secondary line, or `null`
  when there is nothing useful to add (no description; description duplicates the
  merchant case-insensitively/trimmed; or merchant is empty so the description is
  already the primary label). Provider-safe: Plaid rows where `merchant` already
  equals `description` yield `null` (no clutter).
- `app/dashboard/expenses/page.tsx`: render `txnDetailLine(...)` as a secondary
  `<p>` under the primary label in BOTH the credits/rent lane and the "To review"
  pending-expense lane. Primary label unchanged.
- `scripts/test-bank-feed.ts`: +9 cases (RBC payee/payer surfaced; null/empty;
  case+whitespace-insensitive dedupe; trim).

## Invariants to check
- The primary label (`merchant ?? description ?? fallback`) is byte-identical —
  only a secondary line was ADDED.
- `txnDetailLine` never returns a string equal (case-insensitively, trimmed) to
  the merchant, and never returns non-null when merchant is empty (would double
  the primary label).
- Pure function, no I/O, no new query columns (`merchant`/`description` were
  already selected in both lanes).

## Gates (verified in sandbox via `node -r sucrase/register` + `npx tsc`)
- tsc --noEmit clean; eslint clean on the 2 changed source files.
- `test-bank-feed` 25→**34/0**; `test-bank-import` 68/0 (no regression).

## Codex review — ACCEPTED (2026-07-07, range `b70c3de..539280e`)
No P1/P2. Confirmed safely additive: `txnDetailLine` is pure and only surfaces
`description` as useful secondary context; primary labels in both lanes unchanged;
both queries already selected `merchant` + `description`; no mutation/money-path
code changed. Codex re-ran: `git diff --check`, tsc clean, lint clean,
test-bank-feed 34/0, test-bank-import 68/0, test-rent-from-bank 22/0,
test-categorization-rules 47/0. Loop CLOSED.
