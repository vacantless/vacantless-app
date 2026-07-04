# S411 - OFX/QFX bank-feed file import (CSV/OFX spec, Slices 1+2)

Date: 2026-07-04
Repo: `vacantless-app` on `main`
Spec: `CSV-OFX-BANK-FEED-IMPORT-SPEC-2026-07-01.md` (S397). Noam confirmed all three
open questions: gate at `bank_feed` (Growth+); MBNA DOES offer OFX/QFX download, so
OFX Slices 1+2 are the whole job and CSV (Slice 3) waits; ship OFX-first.

## What this closes

The live aggregator feed (Plaid, 0058) covers RBC / TD / Amex-CA, but issuers Plaid
and Flinks don't support (e.g. MBNA) can't connect. This lets the owner upload the
issuer's own OFX/QFX transaction export and run it through the EXACT same pipeline:
stage -> dedupe -> autoApplyRules -> triage -> owner statement. An imported
transaction is indistinguishable downstream from a Plaid transaction.

## Design (Option B from the spec: a SYNTHETIC connection)

An imported account is ONE `bank_connections` row with `provider='csv'` (added to the
CHECK), no `bank_connection_secrets` row (there is no pull token), `last_synced_at`
reused as "last imported at". Every imported transaction hangs off it exactly like a
Plaid transaction, so `filterNewTransactions` / the triage page / `autoApplyRules` /
`buildOwnerStatement` are all reused verbatim (they only ever see `NormalizedTxn` /
`bank_transactions` rows).

## Files

New:
- `lib/bank-import/ofx.ts` - PURE OFX/QFX parser -> `NormalizedTxn[]`. `<STMTTRN>`
  blocks; `externalId` = `<FITID>` (the OFX per-txn unique id = deterministic dedupe
  key); `TRNAMT` through the shared `normalizeAmount(cents, -1)` (OFX: negative =
  outflow); `DTPOSTED` stripped to `YYYY-MM-DD`; `NAME`/`MEMO` -> merchant/description;
  `merchantEntityId`/`streamId` = null (rules degrade to the merchant-name fallback,
  which `bestRuleForTxn` already handles). A block missing FITID/date/amount is
  skipped and counted.
- `lib/bank-import/index.ts` - the file -> `NormalizedTxn[]` seam:
  `detectImportFormat` (ext then content probe), `parseImportFile` (OFX now; CSV
  returns `csv_unsupported` = Slice 3), `importConnectionExternalId` (stable per
  account so re-import reuses the connection), `defaultImportLabel`.
- `scripts/test-bank-import.ts` - 54 pure tests (FITID dedupe, negative=outflow,
  date/time+tz strip, ACCTID masking, NAME/MEMO fallback, re-parse stability,
  overlap-only-new via `filterNewTransactions`, format detection, connection identity,
  empty/no-txn bodies).
- `app/dashboard/expenses/import-actions.ts` - the `importTransactionsFromFile`
  server action (kept OUT of the reviewed `actions.ts`). Capability
  `manage_work_orders` + entitlement `canImportTransactions`; parses in-memory,
  upserts the `provider='csv'` connection, dedupes via `filterNewTransactions`,
  inserts with `source='import'`, calls the shared `autoApplyRules`, redirects
  `?imported=N&skipped=M`.
- `app/dashboard/expenses/triage-core.ts` - `insertExpenseAndAssign` + `autoApplyRules`
  + the rule-row mappers, EXTRACTED verbatim from `actions.ts` (plain module, NOT
  "use server") so the import action reuses them WITHOUT exposing `autoApplyRules`
  as a public server action. actions.ts now imports them.
- `supabase/migrations/0104_bank_import.sql` - additive: provider CHECK
  `plaid|flinks` -> `+csv`; `bank_connections.import_format` (`ofx|csv`, null for
  live); `bank_transactions.source` (`live|import`, default `live` = zero change at
  the live insert sites). RLS/grants unchanged (a csv row is just another org-scoped
  row with no secret). APPLIED to prod DB (verified: CHECK includes csv, both columns
  present).

Edited:
- `lib/bank-feed/index.ts` - added `canImportTransactions(entitlements) =
  hasLiveBankFeed(entitlements)` (its own predicate so the Free-wedge option can be
  flipped here alone later).
- `app/dashboard/expenses/actions.ts` - imports the moved helpers from
  `./triage-core` (behavior identical); `syncConnectionById` now defensively returns
  0 for any non-plaid/flinks provider, so a stray "Sync now" on a csv connection can
  never reach `getBankFeedProvider('csv')` (which throws).
- `app/dashboard/expenses/page.tsx` - "Import from a file" form (`.ofx/.qfx` +
  optional label) under Connected accounts; csv connections badge "imported" and
  drop the "Sync now" button; `?imported`/`?import=<reason>` banners.

## Dedupe / idempotency (the correctness core)

`externalId = <FITID>` verbatim. `filterNewTransactions` guards
`(connection_id, external_id)` before insert AND the DB has `unique(connection_id,
external_id)`, so re-importing an overlapping date range stages only genuinely new
rows. Verified both in the unit tests and the DB replay below.

## PII / security

- TRANSACTION exports only, never PDF statements (full account number).
- The raw OFX `<ACCTID>` is masked to last-4 in the parser (`maskAccountId`) and the
  full value is NEVER persisted (`account_external_id` = the 4-char mask). A unit test
  asserts the raw ACCTID never appears in the output.
- No credentials handled; no `bank_connection_secrets` row for a csv connection.
- Uploaded bytes parsed in-memory, not retained; 8 MB cap.
- Read-only; never moves money.

## Deliberate scope / choices (don't "fix")

- OFX-first; CSV (Slice 3, needs per-issuer column mapping) intentionally returns
  `csv_unsupported` for now.
- Direct import (drop -> import) instead of a separate parse-preview-confirm step:
  OFX is deterministic (no column mapping) and re-import is idempotent, so a preview
  adds clicks without safety here (Tesla minimal-clicks). The preview/mapping step is
  planned for the CSV slice.
- Imported bank_transactions carry `source='import'`; the expense created at triage
  keeps `source='bank'` (unchanged `insertExpenseAndAssign`) - the provenance badge
  lives on the transaction, not the expense.

## Verification (here)

- `npx tsc --noEmit` - clean (exit 0).
- `npx eslint --no-cache` on all new + changed files - green (exit 0).
- `scripts/test-bank-import.ts` - 54/0. Regressions: `test-bank-feed` 25/0,
  `test-expenses` 60/0.
- Migration applied to prod DB via the Supabase connector; verified the provider
  CHECK now includes `csv` and `import_format` + `source` columns exist.
- DB pipeline replay on North Star QA (`b733a191`) via execute_sql: created a
  `provider='csv'` connection + 3 imported rows (`source='import'`, 2 debits / 1
  credit); a re-import of FITID `F1` with `on conflict do nothing` inserted 0 (dedupe
  held); 2 debits surfaced as pending for triage; then deleted the connection + rows
  (QA reset to 0 csv connections, verified).

## NOT done here (post-deploy)

- Live UI smoke: dropping a real `.ofx` on the deployed Expenses page and walking
  triage end to end needs this commit deployed first. Recommended as the first
  post-deploy check on North Star QA (Growth), then real use on 506 Manning / MBNA.
