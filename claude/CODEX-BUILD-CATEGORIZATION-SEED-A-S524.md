# CODEX BUILD — Categorization seeding from an accounting export (FreshBooks CSV) — S524 (Feature A)

**Repo:** `vacantless-app`. **App HEAD:** `4c962b9` on `main`.
**Plan gate:** `accounting` (Premium) — reuse the EXISTING entitlement; do NOT add a new gate key.
**Migration:** `0166` (additive: two new staging tables). Apply separately (Noam applies to prod).
**Follows:** Slice A reconciliation (S518, shipped) + Feature C rent-suggest safety (S519, shipped).
**Design source:** `claude/DESIGN-ACCOUNTING-CATEGORIZATION-SEEDING-S519.md` §1 + `claude/DESIGN-PREMIUM-ACCOUNTING-INHOUSE-S518.md`.

---

## 0. One-line task

Let a Premium landlord upload an export of their ALREADY-categorized transactions from their prior accounting software (FreshBooks CSV first), **match** those rows to the org's existing `bank_transactions`, and **apply the prior categorization** — via derived categorization rules (preferred) or direct filing — with a **review-before-commit preview**. Rows the source marked personal / non-rental are **excluded**, never filed. This is the concrete "leave FreshBooks" onboarding unlock that makes Premium's accounting module real.

**Critical framing:** Feature A does NOT create `bank_transactions`. Vacantless already ingests the bank feed (Plaid + OFX import). The gap is *categorization history*, not data. This feature seeds categorization onto transactions that already exist; unmatched ledger rows are reported, never staged as phantom transactions.

---

## 1. REVIEW FIRST (deliver this note before building)

Read the code and write a short note confirming:
1. How `bank_transactions` are staged today (`app/dashboard/expenses/import-actions.ts` + `lib/bank-import/`), the columns available (`amount_cents`, `direction`, `posted_on`, `merchant`, `description`, `raw_category`, `merchant_entity_id`, `stream_id`, `account_external_id`, `triage_status`, `expense_id`), and that `triage_status` is one of `pending|assigned|ignored|rent|excluded` (migrations 0058 + 0163).
2. How the rules engine works (`lib/categorization-rules.ts`): `validateRuleInput`, `draftRuleFromAssignment`, `bestRuleForTxn`, `ruleAutoFiles`, and how `autoApplyRules(orgId)` in `app/dashboard/expenses/triage-core.ts` retroactively files pending debits that match a scoped rule (claims-first via `insertExpenseAndAssign`).
3. How the reconcile Slice-A actions file a debit as an expense, a credit as rent, or exclude a txn (`app/dashboard/money/reconcile/actions.ts`) — including the Feature-C rail dedupe rule (a rail deposit LINKs to the existing `rent_payments` row; it does not create a second).
4. The expense category whitelist (`lib/expenses.ts` `EXPENSE_CATEGORIES`) and `categoryFromRawHint`.
5. That the `accounting` entitlement gate + `manage_work_orders` / `manage_tenancies` capability checks are the correct auth for this surface (mirror `requireAccountingOrg` in the reconcile actions). Confirm NO billing change is needed.

Then build.

---

## 2. What to build

### 2a. Pure parser — `lib/accounting-import/freshbooks.ts`
Parse a FreshBooks CSV export into `LedgerRow[]`. Pure (no I/O); the caller reads the file bytes. Mirror the discipline of `lib/bank-import/ofx.ts`.

```ts
export type LedgerRow = {
  rowNo: number;              // 1-based source row for the preview
  date: string;               // ISO "YYYY-MM-DD"
  amountCents: number;        // absolute value, always >= 0
  direction: "debit" | "credit";
  description: string | null; // payee / notes
  sourceCategory: string | null; // the FreshBooks category string, verbatim
  clientTag: string | null;   // FreshBooks "Client"/"Project" (property hint)
};
export type FreshbooksParseResult =
  | { ok: true; rows: LedgerRow[]; totalRows: number; skipped: number; columns: string[] }
  | { ok: false; reason: "not_csv" | "no_header" | "missing_columns" | "no_rows"; columns?: string[] };
export function parseFreshbooksCsv(content: string): FreshbooksParseResult;
```

Requirements:
- **Header-driven column mapping, case-insensitive, alias-tolerant.** FreshBooks report exports differ (Expenses export vs P&L detail vs General Ledger). Detect columns by header name against an alias map: date ← {`Date`,`Transaction Date`,`Issue Date`}; amount ← {`Amount`,`Total`,`Grand Total`}; description ← {`Description`,`Notes`,`Vendor`,`Merchant`,`Client Name`}; category ← {`Category`,`Expense Category`,`Account`}; client/property ← {`Client`,`Project`,`Property`}. Require at minimum date + amount + category; if amount+category+date are not all locatable → `{ ok:false, reason:"missing_columns", columns }` so the UI can tell the operator which headers it saw.
- **Sign / direction:** FreshBooks amounts may be positive with a separate type, or signed. Derive `direction` from the sign (negative → the export's convention) OR a `Type`/`Debit`/`Credit` column if present; store `amountCents` as the absolute integer cents. Document the exact rule you implement in a comment. Expenses default to `debit`; income/payments to `credit`.
- Parse currency-formatted amounts robustly (`$1,234.56`, parentheses-negatives, trailing `CR`). Round to integer cents.
- Skip blank/summary/total rows (no parseable date+amount); count them in `skipped`.
- Proper CSV handling (quoted fields, embedded commas/newlines). Do not hand-split on commas.
- QuickBooks/Wave are **out of scope** for this ticket — note the module is structured so a second parser can be added later behind the same `LedgerRow` shape.

### 2b. Pure matcher — `lib/accounting-import/match.ts`
Match each `LedgerRow` to at most one existing `bank_transactions` row.

```ts
export type MatchableBankTxn = {
  id: string;
  amountCents: number;
  postedOn: string;           // ISO
  direction: "debit" | "credit";
  merchant: string | null;
  description: string | null;
  triageStatus: string;       // pending|assigned|ignored|rent|excluded
};
export type MatchOutcome =
  | { rowNo: number; kind: "matched"; transactionId: string; alreadyReconciled: boolean }
  | { rowNo: number; kind: "ambiguous"; candidateIds: string[] }
  | { rowNo: number; kind: "unmatched" };
export function matchLedgerRows(
  rows: LedgerRow[],
  txns: MatchableBankTxn[],
  opts?: { dayWindow?: number }, // default ±4 calendar days
): MatchOutcome[];
```

Rules:
- A candidate requires **exact `amountCents` equality** AND same `direction` AND `|postedOn − row.date| ≤ dayWindow`.
- Rank candidates by (date proximity ASC, then description token overlap via `normalizeMerchant` from `lib/categorization-rules.ts` — reuse it, do not re-implement). One clearly-best candidate → `matched`; two-or-more comparably-good (tie on date & no description signal to separate) → `ambiguous`.
- **Each bank txn is claimed by at most one row per batch** (greedy: assign best global pairs first) so two ledger rows never both match one transaction.
- Set `alreadyReconciled = triageStatus !== 'pending'` on a match (the operator should not re-file an already-categorized txn; the UI defaults it to skip).
- No mutation. Pure. Fully unit-testable.

### 2c. Pure category mapping — `lib/accounting-import/category-map.ts`
Map a source category string to a Vacantless disposition.

```ts
export type MappedDisposition =
  | { kind: "expense"; category: ExpenseCategory }
  | { kind: "rent" }        // income → rent
  | { kind: "excluded" }    // personal / non-rental → exclude, never file
  | { kind: "unknown" };    // operator must pick
export function mapSourceCategory(sourceCategory: string | null, direction: "debit"|"credit"): MappedDisposition;
```

- Reuse the keyword approach of `categoryFromRawHint`; add FreshBooks-flavored keys: `property tax(es)`→property_tax, `maintenance`/`repairs`→maintenance, `mortgage`→mortgage, `insurance`→insurance, `utilit`/`hydro`/`gas`/`water`→utilities, `condo`/`hoa`→condo_fees, `bank`/`interest`/`service charge`→interest, `advertis`/`marketing`→advertising, `legal`/`account`/`professional`→professional, `management`→management, `supplies`/`office`→supplies.
- **Personal / non-rental → `excluded`** (this is the safety spine): `government`/`benefit`/`canada essentials`/`fed-prov`/`transfer`/`paypal`/`refund`/`personal`/`owner draw`/`owner contribution`. This is what keeps government benefits, transfers, and refunds OUT of the rental books automatically.
- **Income → `rent`**: `rental income`/`rent` on a `credit`.
- Everything else → `unknown` (operator picks in the preview). Mapping is advisory; the operator can override any row.

### 2d. Pure plan builder — `lib/accounting-import/index.ts`
Combine parse + match + map into a `PlannedRow[]` (still pure, no DB), each with a `plannedAction`:

```ts
export type PlannedAction =
  | "rule_seed"       // matched debit, known category + resolvable property → derive a rule (preferred for recurring payees)
  | "direct_expense"  // matched debit, known category, one-off (no recurring pattern) → file the expense directly
  | "rent_link"       // matched credit mapped rent → link/record to a tenancy (rail-dedupe per Feature C)
  | "exclude"         // mapped excluded/personal → set triage_status='excluded'
  | "needs_review";   // unmatched | ambiguous | unknown category | unresolved property → reported, never auto-applied
```
- Prefer `rule_seed` when a normalized (merchant+category+property) group has ≥2 matched rows (recurring payee — one rule files the group AND all future); else `direct_expense`. Both are acceptable; document the threshold.
- Property resolution from `clientTag`: fuzzy-match the tag against the org's properties (name/address, normalized). Unambiguous single match → set `plannedPropertyId`; else leave null and downgrade the row to `needs_review` for scoped filing (a rule/expense with no scope still may pre-fill but must not mis-file — mirror the existing "merchant-only rule pre-fills, scoped rule auto-files" distinction).
- `needs_review` rows are surfaced with the reason; they are NEVER written on commit.

### 2e. Migration `0166_categorization_import_batches.sql` (additive only)
Two org-scoped staging tables (RLS + grants mirroring `bank_transactions` in 0058/0163; `create table if not exists`, idempotent):

- `categorization_import_batches(id uuid pk, organization_id uuid not null, source text not null default 'freshbooks', filename text, row_count int not null default 0, status text not null default 'staged' check (status in ('staged','committed','discarded')), created_by uuid, created_at timestamptz default now(), committed_at timestamptz)`.
- `categorization_import_rows(id uuid pk, organization_id uuid not null, batch_id uuid not null references categorization_import_batches(id) on delete cascade, row_no int, txn_date date, amount_cents int, direction text check (direction in ('debit','credit')), description text, source_category text, client_tag text, matched_transaction_id uuid, planned_action text, planned_category text, planned_property_id uuid, planned_building_key text, status text not null default 'pending' check (status in ('pending','applied','skipped')), applied_ref text, created_at timestamptz default now())`.
- Org-scoped RLS policies (select/insert/update/delete for `authenticated` where `organization_id` is in the caller's orgs — copy the exact policy shape used by `bank_transactions`) + `grant` to `authenticated` and `service_role`. Indexes on `(organization_id, batch_id)` and `(organization_id, status)`.
- **No changes to any existing table.** Because these are brand-new tables not read by `getCurrentOrg()`, there is no dashboard-wide deploy-vs-migration race (unlike 0165) — but the new page will error until 0166 is applied, so it is still applied promptly.

### 2f. Server actions — `app/dashboard/money/import-history/actions.ts` (`"use server"`)
Gate every action: `requireCapability("manage_work_orders", ...)` (+ `manage_tenancies` for rent rows) AND `accounting` entitlement (mirror `requireAccountingOrg` from the reconcile actions). Org-scope every query.

- `stageCategorizationImport(formData)` — read the uploaded file (≤ 8 MB, `.csv`), `parseFreshbooksCsv`; load the org's `pending`-and-recent `bank_transactions` + properties; run `matchLedgerRows` + the plan builder; INSERT a `categorization_import_batches` row + its `categorization_import_rows`. Redirect to the preview for that batch. **No filing yet.**
- `commitCategorizationImport(formData)` — for the confirmed batch, iterate its rows whose `status='pending'` and whose (operator-confirmed) `planned_action` is one of the applying actions, and apply:
  - `rule_seed` → build a rule via `draftRuleFromAssignment`/`validateRuleInput`, insert into `categorization_rules` (skip if an equivalent rule already exists), then call `autoApplyRules(org.id)` ONCE after inserting the batch's rules.
  - `direct_expense` → `insertExpenseAndAssign(...)` (claims-first; reuse from `triage-core`).
  - `rent_link` → resolve the tenancy; **rail dedupe (Feature C):** if a matching `rent_payments` row already exists (rail source, same tenancy/period/amount), set its `bank_transaction_id` (link) instead of inserting; else insert a `source='bank'` rent_payment and set `triage_status='rent'`. Never double-record.
  - `exclude` → set `triage_status='excluded'` (claims-first `eq('triage_status','pending')`).
  - Mark each row `applied` (with `applied_ref`) or `skipped`; set batch `status='committed'`, `committed_at`. **Idempotent:** a row already `applied` is skipped; committing a committed batch is a no-op; the claims-first guards prevent any double-file if run twice.
- `discardCategorizationImportBatch(formData)` — set batch `status='discarded'` (rows untouched / no writes to the ledger).
- `updatePlannedRow(formData)` — let the operator override a single row's `planned_action` / `planned_category` / `planned_property_id` before commit (re-validate against the whitelist + org ownership). Optional but recommended so `unknown`/`needs_review` rows are resolvable without re-uploading.

### 2g. UI — `app/dashboard/money/import-history/page.tsx` (server component, `accounting`-gated)
- Locked upsell if not entitled (mirror the reconcile page's locked state — never a half-rendered module).
- Upload card (CSV, with a one-line "export your transactions from FreshBooks → upload here").
- **Preview** of the latest `staged` batch: summary counts (`N will seed rules`, `M file directly`, `K excluded as personal`, `J link as rent`, `U need review`), then a per-row table (date, amount, description, source category → mapped disposition, matched txn, action) with inline override + a prominent **"Apply N rows"** confirm button and a **Discard** button. Show the `needs_review` rows clearly with their reason; they are excluded from the apply count.
- Add a link to this page from `app/dashboard/money/page.tsx` (next to Reconcile). No nav change elsewhere.

### 2h. Tests — `scripts/test-accounting-import.ts` (pure, `npx tsx`)
Cover: parser (header alias mapping; `$1,234.56`/parentheses/`CR`; debit vs credit sign; blank/total-row skipping; missing-column failure); matcher (exact-amount + date-window match; ambiguous; unmatched; greedy one-txn-one-row; `alreadyReconciled` flag); category-map (each known expense key; personal→excluded incl. `canada essentials`/`transfer`/`paypal`/`refund`; income→rent; unknown); plan builder (rule_seed vs direct_expense threshold; needs_review downgrade when property unresolved). Follow the existing `scripts/test-*.ts` assert-harness style (`test-categorization-rules.ts`, `test-reconciliation.ts`).

---

## 3. Invariants (do not violate)
- **Premium `accounting` gate + capability check on every action and the page.** An ungated org sees a locked upsell, never a half-module. **No new gate key.**
- **No new external vendor.** No aggregator, no network calls. Reads only the org's own already-staged `bank_transactions`.
- **No Growth takeaway.** This is net-new Premium surface. Do not move or gate any existing Growth surface.
- **Never an unattended write to financial records.** Parse → stage → PREVIEW → operator confirm → commit. No auto-commit.
- **Feature A does not create `bank_transactions`.** Unmatched rows are reported only. No phantom transactions.
- **Single-source, no double-count.** File via the existing `expenses` / `rent_payments` links (`bank_transaction_id`); `lib/statements.ts` is UNTOUCHED. Rail deposits LINK, never double-record (Feature C rule).
- **Personal / non-rental rows are `excluded`, never filed** as rent or expense.
- **Idempotent + re-run-safe.** Claims-first on `bank_transactions`; equivalent-rule dedupe; committed batch is a no-op on re-commit.
- **Pure parser + matcher + map + plan builder** in `lib/accounting-import/*`, all unit-tested via `npx tsx`. Server actions hold the I/O.
- **Do NOT touch:** `lib/statements.ts`, `lib/reminders.ts`, the OFX importer behavior (`lib/bank-import/*`, `import-actions.ts`), the reconcile Slice-A action behavior, billing gate keys, `vercel.json`, `.github/workflows/*`.

---

## 4. Process
1. Deliver the §1 review note.
2. Build §2a–2h.
3. `npx tsx scripts/test-accounting-import.ts` (green); `npx tsc --noEmit`; `npm run lint`; `npm run build`; `git diff --check` — all green.
4. Write migration `0166` as a file but **DO NOT apply it** to any database (Noam applies to prod separately). Enable the feature on NO org beyond the normal `accounting` gate.
5. Commit + push to `main`; reply with the commit SHA, a file-by-file diffstat, and the review note.

---

## 5. Verification (Cowork, after push)
- Pull/clone `main` (or clone the PUBLIC repo `vacantless/vacantless-app` into the cloud if the device bridge is down); `git diff --check` clean; confirm file scope matches this ticket.
- Read migration `0166`: additive only, RLS org-scoped + grants, idempotent, no existing-table change.
- Logic/security audit: `accounting` gate + capability on every action/page; every query org-scoped; idempotent claims-first; no double-count; rail dedupe correct; personal→excluded; no phantom `bank_transactions`; `statements.ts` untouched.
- Independent cloud `npx tsx scripts/test-accounting-import.ts`; confirm Codex's tsc/lint/build green.
- Apply `0166` via Supabase MCP **on Noam's go, promptly** (the new page 500s until applied). Confirm Vercel deploy READY on the pushed SHA. Smoke: the import-history page renders locked for a Growth org and the upload/preview for a Premium org; no ledger write occurs until commit.
