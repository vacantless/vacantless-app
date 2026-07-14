# Codex handoff - S426 Lease-OCR P2 fixes + live QA

> ✅ ACCEPTED by Codex 2026-07-06: no P1/P2 on S426 or S426b; verified test-lease-extract 89/0, test-lease-locator 25/0, test-billing 246/0, tsc clean. Lease-OCR P2 lane CLOSED. (Homepage commit d152adb was not in scope for this review.)


Range: `08acb6c..3d48a73` (1 commit). No migration.
Status: SHIPPED DARK (env `LEASE_OCR_ENABLED` removed from prod again after QA; model call still needs `ANTHROPIC_API_KEY`).
Context: you reviewed the original lease-OCR (`14c997a..08acb6c`) and flagged 2 P2s, no P1s. This commit folds BOTH. This note asks you to review the FIX.

## The two P2s and how they were fixed

### P2a - PII guard missed DOB/ID variants + truncated before detecting (`lib/lease-extract.ts`)
Your repro: `normalizeLeaseDraft({ notes: "Tenant birthdate 1991-05-12" })` returned the note unchanged; also `born <date>`, bare `DL`, `licence #` slipped through.
Fix:
- `PII_PATTERNS` restructured into three regexes:
  1. whole-word label list, now including DOB aliases `date of birth | birth date | birthdate | born | d.o.b`, plus `driver's licence`, `void cheque`, `pre-authorized debit`, `bank account`, `passport`, `social insurance`, `ssn`.
  2. label + number-ish qualifier `(sin|ssn|licen[cs]e|dl|account|transit|institution)\s*(no|number|#|:)` - deliberately carries NO trailing `\b` (a `\b` does not hold after `#`, which is why "Licence #" was missed).
  3. bare `\bdl\b` for the "DL A1234-56789" abbreviation.
- `redactPII` now collapses whitespace and runs ALL patterns on the FULL string BEFORE truncating to `maxLen` (previously it sliced first, so a near-boundary identifier could be cut past the guard and leave a truncated-but-sensitive fragment).

### P2b - `LEASE_OCR_ENABLED` only enforced in the page render, not the action (`app/dashboard/tenancies/actions.ts`)
`extractLease` now returns `{ok:false,reason:"unconfigured"}` unless `process.env.LEASE_OCR_ENABLED === "1"`, checked as the FIRST statement - before `requireCapability`, before the `claim_lease_ocr_scan` credit claim, and before any Anthropic call. Matters because `ANTHROPIC_API_KEY` is already present in prod for other OCR, so a crafted POST could otherwise have reached the model while the feature was dark.

## Files to review
- `lib/lease-extract.ts` - the `PII_PATTERNS` restructure + `redactPII` detect-before-truncate. Security-critical.
- `app/dashboard/tenancies/actions.ts` - the env gate at the top of `extractLease`.
- `scripts/test-lease-extract.ts` - added cases: `birthdate`, `birth date`, `born <date>`, `DL`, `licence #`, and a near-boundary identifier pushed past the length ceiling.

## Specific things to check (highest value first)
1. **No regression**: does the restructured 3-regex set still null every identifier the old single-regex set did? (SIN dashed/spaced/in-a-name, SSN, card, bank-account run, 7-digit run, and all the label hits.)
2. **New variants**: `birthdate` / `birth date` / `born <date>` / bare `DL` / `licence #` all null the field.
3. **Over-match risk**: bare `\bborn\b` and `\bdl\b` will null a benign note that happens to contain those tokens. Acceptable per the module's stated posture (losing a note beats persisting an identifier), but confirm you agree and that no COMMON lease-clause word trips them.
4. **Detect-before-truncate**: confirm there is no ordering where a field is truncated before the PII scan.
5. **Env gate placement**: `unconfigured` is returned before any capability check, credit claim, or model spend.

## Verified this session
tsc `--noEmit` clean; no em dashes. Tests: lease-extract **86/0** (was 80/0), lease-locator 25/0, billing 246/0 (unchanged).

LIVE QA on North Star Rentals QA (`b733a191`, Growth) with `LEASE_OCR_ENABLED=1` temporarily set, using a REAL signed 28-page bundle (208 Macpherson - source PDF confirmed to contain social-insurance, date-of-birth, and driver's-licence fields):
- Locator pinned the Standard Lease at page 7 (dug past the RECO guide + Form 320/401/410).
- Prefill correct: rent $5,500, start 2025-11-13, primary tenant name + email, full clause summary in notes; unit unmatched (expected - not a North Star unit).
- Created the tenancy, then scanned the persisted `tenancies` (notes/payment_notes/move_in_notes), `tenants` (name/email/phone), and `persons` (full_name/email/phone/notes) rows: pii_label_hit=false, nine_digit_run_hit=false, sin_format_hit=false, licence_format_hit=false across all three. Only name + email persisted.
- Test rows wiped (tenancy/tenants/person = 0), unit restored to `available`, `LEASE_OCR_ENABLED` removed from Vercel + redeployed dark.

## S426b follow-up (your re-review P2 - licence slash/dot forms)

You flagged that `D/L`, `D.L.`, and `D/L #` slipped through (the new patterns caught bare `DL` and `licence #` but not separator forms). Fixed in `lib/lease-extract.ts`: the bare-abbreviation pattern is now `/\bd[./]?l\b/i` (was `/\bdl\b/i`), which matches `DL`, `D/L`, and `D.L.` with or without the trailing separator; the `#`/number qualifier is handled by the existing label+qualifier pattern, so `D/L # A1234-56789` is covered by the `\bd[./]?l\b` hit on `D/L`. Added tests for `D/L A1234-56789`, `D.L. A1234-56789`, and `D/L # A1234-56789`. Suite now `89/0`; tsc clean. `normalizeLeaseDraft({ notes: "Tenant D/L A1234-56789" })` now returns null. No new over-match vs the prior `\bdl\b` (same word-boundary behaviour, one optional separator).
