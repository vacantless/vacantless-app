# DESIGN — Applicant-Pays Tenant Screening (drop the SingleKey $5k dependency)

**Owner:** Noam · **Author:** Cowork · **Date:** 2026-07-19 (S517) · **Status:** design-first (not ticketed; build on Noam's go)
**Entitlement:** `applications` (Growth+) — already exists; no new plan flag.

---

## Problem

The current `lib/rental-screening/singlekey.ts` adapter is DARK and blocked on SingleKey's **~$5k connection fee at test→prod**. Noam's directive (S517): screening is an important feature, but Vacantless must **not hinge on an exorbitant upfront platform fee** (same principle that rejected Flinks' ~$6k/yr for the bank feed). Build our own path.

## The insight: applicant-pays hosted handoff = $0 to Vacantless, $0 to the landlord

We do **not** need a bureau API contract to offer screening. The market already runs on an applicant-pays model:

- **FrontLobby** — pay-per-report, **no monthly platform fee**; its **applicant-pay option is free for the landlord**, the applicant pays ~CA$19.99 (credit) / ~CA$39.99 (full bundle); pulls **Equifax + TransUnion** (+ Landlord Credit Bureau). [verified 2026-07-19 via frontlobby.com/landlord-pricing-canada]
- **SingleKey** itself has an applicant-pay tenant-report link that does **not** require the $5k API contract — usable as a fallback provider.
- Going **direct to Equifax/TransUnion** is the wrong move: reseller agreements, PIPEDA-grade secure handling of raw reports, and volume minimums. The hosted applicant-pays handoff sidesteps all of it.

So: **the applicant completes and pays for their own report on the provider's hosted page; the landlord receives the result.** Vacantless never touches the bureau API, never stores the raw report, never fronts a fee.

## This fits the seam we already have

`lib/rental-screening/index.ts` already defines the right shape: *"Open a hosted screening invite; returns the applicant handoff + report handle"* and *"the provider to use for a NEW screening invite, or null when not entitled."* The applicant-pays handoff is exactly a **hosted invite** — we just add a provider that returns the provider's hosted applicant-pays URL instead of calling SingleKey's paid API. No seam redesign.

---

## Build in two tiers (ship Tier 1; Tier 2 only if volume justifies)

### Tier 1 — Referral / deep-link handoff (fastest, zero integration fee, no bureau API)
- New provider behind the existing `ScreeningProvider` seam: `getReferralScreeningProvider()` (e.g. FrontLobby), returns a **hosted applicant-pays URL** for a screening request. No API key, no per-report billing to Vacantless.
- Flow, reusing the existing application object:
  1. Landlord clicks **"Request screening"** on a lead/application (gated on `applications`, Growth+).
  2. Vacantless records a `screening_request` (status `sent`) and emails the applicant a link to the provider's applicant-pays hosted flow (prefilled where the provider supports URL params; otherwise a plain link + instructions).
  3. Applicant completes identity + consent + **pays** on the provider's page.
  4. Landlord receives the report **from the provider** (provider emails it / posts to their dashboard). Vacantless shows status `sent → completed` (set manually by the landlord one-tap, or via Tier 2 webhook) and lets the landlord **attach the returned PDF/link** to the applicant record.
- **Store status + a link/attachment only — never the raw report contents / PII.** (Mirrors the existing PII-free `NormalizedScreeningReport` discipline.)
- Migration: a small `screening_requests` table (org-scoped RLS) OR reuse the application record with a `screening_status` + `screening_provider` + `screening_report_url` — prefer extending the application to avoid a new table if the columns fit.

### Tier 2 — API status sync (later, only with a no-big-fee provider)
- If a chosen provider exposes a **free/low-fee API** (status webhook + report handle), wire `completed` auto-sync + the normalized PII-free summary into the existing `normalizeSingleKeyReport`-style mapper. Gate the provider addition on the same **"no exorbitant upfront fee"** eligibility rule. Do NOT pay a 4–5 figure connection fee for this.

---

## Bonus feature we already own: Plaid income / ID verification

We are already integrated with **Plaid** (pay-as-you-go, live). Plaid can verify **income and identity** from a bank connection at near-zero marginal cost — reuse it as a **complementary screening signal**, especially for **thin-credit or newcomer applicants** who fail a pure credit pull (a real, underserved segment: newcomers using open banking to qualify). This is a differentiated screening feature built on infrastructure we already pay for, and it pairs with the credit report rather than replacing it.

## Adjacent low-fee upside (note for roadmap, not this build)
- **Rent reporting / tenant credit-building:** the same applicant-pays providers (FrontLobby / Landlord Credit Bureau) let landlords report on-time rent to build good tenants' credit — a tenant-pays retention + marketing hook that rides the same integration.

---

## Guardrails
- **Applicant-initiated + applicant-pays = clean consent.** The applicant authorizes and pays on the provider's page; Vacantless is the referrer, not the data controller of the report.
- **No raw report / PII stored in Vacantless** — status, provider, and a link/attachment only.
- **Be upfront in copy** (per the shared-context `VACANTLESS-FEATURES.md` rule): market this as "request tenant screening (applicant-pays credit + background via Equifax/TransUnion)", not "we screen tenants." Until Tier 1 ships, the pricing page lists applications/applicant tracking as live and screening as coming.
- Provider seam so FrontLobby ↔ SingleKey-applicant-pay ↔ future are swappable; **eligibility rule = no exorbitant upfront fee** (same bar as the SMS registry and the Flinks park).

## Open decisions for Noam
1. Primary provider for Tier 1: **FrontLobby** (Equifax + TransUnion + LCB, applicant-pay free-to-landlord) vs SingleKey applicant-pay link vs offer both.
2. Extend the application record vs a new `screening_requests` table (recommend: extend if columns fit).
3. Whether to bundle the **Plaid income-verify** signal into v1 or fast-follow.
4. Confirm each provider's applicant-pays hosted URL supports prefill params (affects how seamless the handoff is).

## Standing rules
Design-first; ticket + hand to Codex on Noam's go. Codex builds; Cowork verifies the diff via `device_bash git`; **Noam pushes**; migrations via Supabase MCP. Never store raw screening PII.

Sources: FrontLobby landlord pricing (frontlobby.com/landlord-pricing-canada), SingleKey "Who pays for the report" (singlekey.com KB), money.ca open-banking-to-qualify-renters.
