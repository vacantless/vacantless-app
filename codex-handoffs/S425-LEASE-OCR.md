# Codex handoff - S425 Lease-OCR (Slices 1 / 1a / 1b)

Range: `14c997a..08acb6c` (3 commits) + migration `0111_lease_ocr_usage.sql` (already applied to prod + verified live).
Status: SHIPPED DARK behind env `LEASE_OCR_ENABLED` (unset in prod). The model call also needs `ANTHROPIC_API_KEY`.

## What it does
Upload a signed lease PDF on the New-Tenancy page -> pre-fill the (unchanged) `createTenancy` form for the operator to review and submit. Nothing auto-writes; extraction only pre-fills.

## Files to review
- `lib/lease-extract.ts` (PURE): LeaseDraft schema, prompt, normalizer, and the **3-layer PII redaction guard** (`redactPII` + `normalizeLeaseDraft`). This is the security-critical file. Tests: `scripts/test-lease-extract.ts` (80/0).
- `lib/lease-extract-vision.ts` (IMPURE): Anthropic Messages call; text + single-image + multi-image sources; never-throws typed `{ok:false,reason}` union; ASCII-key guard (KI555); 8-image cap; 40k-char input cap.
- `lib/lease-locator.ts` (PURE): classify pages by OREA/RTA form number + title, window on the lease. Priority Standard Lease > Agreement to Lease > custom > null. Tests: `scripts/test-lease-locator.ts` (25/0).
- `app/dashboard/tenancies/actions.ts`: `extractLease` server action - the ONE guarded entry point. Enforces `requireCapability("manage_tenancies")` -> `canUseLeaseOcr(org.plan)` (Growth+) -> monthly cap via `claim_lease_ocr_scan` RPC (claimed once) -> image path then text fallback.
- `app/dashboard/tenancies/new/lease-upload-prefill.tsx`: client island (on-device pdfjs read, locate, rasterize located window to JPEGs, single `extractLease` call, DOM prefill). Locked-upsell branch when not entitled.
- `app/dashboard/tenancies/new/page.tsx`: renders the island only when `LEASE_OCR_ENABLED=1`; passes `entitled`.
- `lib/billing.ts`: new `lease_ocr` entitlement + `canUseLeaseOcr` + `leaseOcrMonthlyCap` (Growth 25 / Premium 100). Tests: `scripts/test-billing.ts` (246/0).
- `supabase/migrations/0111_lease_ocr_usage.sql`: `lease_ocr_usage` counter + SECURITY DEFINER `claim_lease_ocr_scan(p_org, p_period, p_cap)` (membership-guarded; revoked from anon; granted to authenticated; counter has NO insert/update/delete RLS policy so it is writable only through the function).

## Specific things to check (highest value first)
1. **PII guard completeness** (`redactPII` in `lib/lease-extract.ts`): can any tenant identifier (SIN/SSN, DL, bank/transit/void-cheque, card, DOB, passport) survive into a returned field? The guard nulls a whole field on any match and runs on every string in `normalizeLeaseDraft` regardless of the prompt. Phone is intentionally allowed (10/11-digit shape only). Look for a bypass.
3. **Cap atomicity + single-claim** (`extractLease` + `claim_lease_ocr_scan`): is the monthly credit claimed exactly once per user action (the image->text fallback must not double-claim)? Is the claim race-safe (row `FOR UPDATE`)? Can a member bypass the cap by writing `lease_ocr_usage` directly (should be impossible - no write RLS policy)?
4. **Entitlement gate**: server-side enforced in `extractLease` (not just the UI). Free/legacy return `locked`.
5. **Org scoping**: `claim_lease_ocr_scan` membership check ties the claim to `auth.uid()`; the action passes `org.id` from `getCurrentOrg`.
6. **No PII in a URL / no storage**: the draft is returned from a server action (not redirected with query params); lease bytes are transient (not persisted).
7. **Locator correctness**: form-number-wins ordering; Form 372/324/RECO never classified as the lease.

## Verified this session
tsc clean; eslint clean on changed files; no new em dashes. Tests: lease-extract 80/0, lease-locator 25/0, billing 246/0. Locator verified against a real 28-page bundle (pinned the Agreement to Lease at page 19). Migration 0111 applied + grants verified live (authenticated=true, anon=false). NOT live-smoked end to end (the model call can't run from the build sandbox; that is the post-review QA step on North Star with a SYNTHETIC lease).
