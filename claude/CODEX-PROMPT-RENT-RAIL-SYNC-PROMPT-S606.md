# CODEX PROMPT — Prominent one-tap "update the rent on autopay" prompt after a served increase (S606)

**Status: SPEC for review — do NOT build until Noam signs off.**

## Why (the product call, decided)
Today, after a landlord serves an N1 and records the increase, pushing the new amount onto the tenant's
Stripe rent subscription is a **buried, easy-to-miss button** (`updateStripeRentAmount`, surfaced at
`app/dashboard/tenancies/[id]/page.tsx:1888`). So a landlord reasonably expects "I put the increase
through → the tenant gets billed more," but nothing bills the new amount until they find and click that
button. Decision: **keep the human gate** (never auto-bill a tenant more without an explicit action —
too risky to walk back), but make the step **obvious and one tap**, shown exactly when it's needed.

## The change — display/prompt only, reuse the existing action + guard
On the tenancy detail page (`app/dashboard/tenancies/[id]/page.tsx`), add a prominent prompt (a
success/attention banner at the top of the Stripe rent-collection section, above the existing button) that
appears **only when the rail is out of sync with a served increase**, i.e. when the existing pure guard
`validateStripeRentUpdate(...)` (`lib/stripe-connect.ts:670`) would succeed for the tenancy's current
served-N1 snapshot — same inputs the action already uses (`stripe_subscription_id`,
`stripe_subscription_status`, served `n1_snapshot.newRentCents`, `stripe_rent_amount_synced_cents`,
`n1_snapshot.effectiveDate`, `last_rent_increase_date`, today). Because the guard is idempotent on
`stripe_rent_amount_synced_cents`, the prompt **auto-disappears once synced**.

Prompt content (honest about timing — it bills on the effective date, not now):
> **[Tenant] is still on the old rent on autopay.** Your served increase to **{{new_rent}}** takes effect
> **{{effective_date}}** — update autopay now so they're billed the new amount automatically on that date.
> **[ Update the rent on autopay → ]**

The button wires to the **existing** `updateStripeRentAmount` form action (unchanged). No new server
action, no auto-fire, no charge triggered by rendering — the landlord still clicks.

### Optional follow-up (NOT in this ticket)
A matching nudge on the dashboard "needs you" lane so the landlord doesn't have to open each tenancy.
Leave out of v1; note it for a later increment.

## Invariants
- **Display-only + reuse.** No change to `updateStripeRentAmount`, `validateStripeRentUpdate`, the schedule
  orchestration, or any charge logic. The prompt only makes the existing manual action prominent.
- **Human gate preserved.** Rendering the prompt never charges anyone; the tenant is billed the new amount
  only after the landlord clicks, and only on the legal effective date (phase-2 schedule, unchanged).
- **Honest copy.** State the effective date; never imply an immediate charge. EN + FR together if any
  new string is added to `messages/*.json` (or keep it inline like the section's existing copy).
- **No migration / schema / routing / gate change.** One page + reuse of the existing pure guard.

## Tests
- Reuse/extend the `validateStripeRentUpdate` unit tests (`scripts/test-stripe-rent-update.ts`) if the
  show/hide predicate is extracted as a pure helper (preferred): prompt shows when an update is available,
  hides when already synced / no served snapshot / tenant not on the rail / subscription inactive.
- If the predicate stays inline in the page, add a small pure helper `shouldPromptRentRailSync(...)` so it
  is unit-testable, and test the same cases.

## You must run (Cowork runs tsc only on the device VM — KI967)
`npx tsc --noEmit` · `npm run lint` · focused `tsx` (`scripts/test-stripe-rent-update.ts`) · `next build`.

## Acceptance
- On a tenancy with an active Stripe rent subscription and a served increase not yet synced, the prompt
  shows at the top of the rent section with the new amount + effective date and a one-tap "Update the rent
  on autopay →" that runs the existing action; it disappears once synced. Nothing charges on render; the
  human gate is intact. No schema/action/charge change. Commit **by name** (KI971), push `main`, report sha.
- Post-deploy mobile shot (S605 lane) of the tenancy page's rent section at 390×844 + 430×932.
