# S420 - Codex review: homepage view-layer commits (app/page.tsx)

> **CODEX-ACCEPTED 2026-07-05 (S420).** No P1/P2. All three commits (`62f9cf8`,
> `a72031b`, `962c33e`) touch only `app/page.tsx` - no lib/billing/entitlement/
> Stripe/Rotessa/migration/server-action/dashboard change. Confirmed: Free/Growth/
> Premium stay $0/$99/$249; Free does not advertise rent collection; payment
> guardrails hold; the rent-increase line stays accurate against the pre-filled /
> review / print N1 route; "your signing tool stays yours" stays consistent; no em
> dashes. QA: git diff --check + eslint --no-cache app/page.tsx + tsc --noEmit +
> browser smoke at 1280x720 and 390x844 (no horizontal overflow before/after the
> cost details, all six cost rows render, 0 console warnings/errors). Loop CLOSED -
> no active code-review queue for the session.

**Why this note:** the S419 cancel-fix review covered only the `62f9cf8..8b52dd7`
delta, so the homepage commits underneath were never reviewed separately. This
note scopes that pass. All three commits are marketing view-layer only.

## Review target (diff limited to `app/page.tsx`)

- **`62f9cf8`** (S419) - rent-first homepage reposition.
- **`a72031b`** (S419) - REBALANCE: lead with the whole product instead of five
  rent sections in a row; hero broadened to "Everything it takes to run your
  rentals" (Fill the unit / Collect the rent / Track the money); the 8-group
  product depth "The whole rental, from empty to earning" moved up right after
  the hero; the three rent sections consolidated into ONE; the per-unit cost
  table demoted behind a `<details>` ("See the cost per unit"); CTA "Talk to
  Noam" -> "Talk to our team". Order: Hero -> ProductDepth -> TrustLine ->
  RentSection -> Pricing -> FounderBand -> ClosingCta.
- **`962c33e`** (S420) - one line in PRODUCT_GROUPS group 8: "Rent-increase
  reminders and important dates" -> "Rent-increase notices prepared for you to
  review and send, with reminders for the key dates".

## What to confirm

1. **View-layer only:** no lib / billing / entitlement / Stripe / Rotessa /
   migration / server-action / dashboard change across the three commits.
2. **Pricing intact:** Free / Growth / Premium at $0 / $99 / $249; no fourth
   card; no rent-only tier; Free never advertises automatic rent collection.
3. **Money / payment guardrails held:** language stays coordinates / tracks /
   organizes / works-alongside; no claim to replace FreshBooks / QuickBooks /
   DocuSign / Rotessa / Stripe / lawyers / official Ontario forms; payment
   footnote (after tenant authorization; never holds funds; never stores tenant
   bank numbers; no cut of rent) preserved.
4. **No overclaim on the new rent-increase line specifically:** the app renders a
   PRE-FILLED Ontario Form N1 that the operator reviews, HAND-signs, and sends
   (app/dashboard/tenancies/[id]/n1/route.ts) - it does NOT e-sign or file it.
   "Notices prepared for you to review and send" should be accurate against that;
   flag if it implies e-signing or auto-filing. The section footer still reads
   "your signing tool stays yours", which must remain consistent (no e-sign claim
   was added anywhere).
5. **No em dashes** in the new copy.
6. **No a11y / layout regression:** the S415 CTA aria-label fix intact; no
   horizontal overflow at 1280 or 390; the cost `<details>` opens cleanly.

## Verification already run (this side)

tsc clean; `eslint --no-cache app/page.tsx` clean; no em dashes; deployed live to
vacantless.com (prod head includes `962c33e`); desktop 1280 + mobile 390 smoked
on the S419 rebalance.
