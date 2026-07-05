# S414 - Rotessa rent CSV export: default a start_date

> **CODEX ACCEPTED 2026-07-05 — P1: none, P2: none.** Reviewed `a493531..499352a`;
> gate + server-side key + generic redirect intact, default `startDate` applies only
> when `?from` is missing/invalid. 1000-row pagination stays a follow-up. `499352a`
> stands as prod head; no re-deploy. See `QA-NOTE-S414-CODEX-ACCEPTED.md`.


## What / why
Dogfooding a real landlord org (506 Manning on live Rotessa) surfaced that the
**"Rotessa rent CSV" export failed**: clicking it redirected to
`/dashboard/settings?rotessa=exportfail`. Root cause: Rotessa's
`GET /v1/transaction_report` **requires a `start_date`** (every documented
example includes one; called without it the API errors). The plain export link
(`/dashboard/rent/export` with no query params) passed `startDate: null`, so the
call was rejected.

Confirmed live: fetching the same route WITH a range
(`?from=2015-01-01&to=2027-12-31`) returned the real report (310 transactions,
all reconciling to the org's tenancies), proving the only defect was the missing
default start.

## Change (single file)
`app/dashboard/rent/export/route.ts`:
- When `?from` is absent/invalid, default `startDate` to
  `${currentYear - 15}-01-01` (a rolling window well before any Rotessa account
  could exist). An explicit `?from` still overrides; `?to`/`?status` unchanged.
- No change to `lib/rotessa.ts` (`buildReportQuery` already sends the params as a
  query string, which the live Rotessa API accepts), billing, entitlements,
  Stripe, or the report parser/CSV.

## Known limitation (NOT addressed here - intentional, narrow fix)
Rotessa's transaction_report is paginated at 1000 rows/page and this pulls page 1
only. A portfolio exceeding 1000 report rows in the window would truncate;
pagination is a follow-up, noted so it isn't mistaken for a regression.

## Verification
- `tsc --noEmit`: clean.
- `eslint app/dashboard/rent/export/route.ts`: clean.
- Live-proven: authed fetch of the export with a date range returned the real
  Rotessa report for the Manning Ave Rentals org; the $7,396 June rent + the
  per-tenant amounts ($2,620 / $3,352 / $1,424) matched the hand-keyed tenancies.

## Review focus
- The default-window choice (15y rolling) and that explicit `?from`/`?to` still
  override it.
- No secret/PII exposure: route reads status only; the report carries no bank
  fields; the API key stays server-side (decrypted per request, never returned).
