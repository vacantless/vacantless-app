# Rent-Increase Loop: Gaps + Decisions (S425)

Date: 2026-07-06. Captured so the decisions persist; build is QUEUED behind Lease-OCR Slice 1.

## What already works (verified in code S425)
- `lib/rent-increase.ts` computes the full picture: Ontario guideline %, earliest legal effective date, serve-by date, new rent (`deriveRentIncrease`).
- Ontario Form N1 renders pre-filled and print-ready (`app/dashboard/tenancies/[id]/n1/route.ts` + `lib/n1-render.ts`).
- Reminder sweep nudges ahead of eligibility (`lib/rent-increase-sweep.ts`); 12-month rule enforced; `last_rent_increase_date` tracked so the cycle repeats year over year automatically.
- The tenancy's recorded rent can be updated to the new amount (a `new_rent` form field sets `rent_cents`).
- A full e-signature rail exists (`lib/lease-signing.ts`: landlord/tenant/guarantor roles, typed/drawn signatures, audit certificate, fully-executed detection) but is wired to LEASES, not the N1.

## The two gaps to close (Noam, S425)

### Gap A: in-app SERVE the N1 with proof of service
Noam: an Ontario N1 does not legally require the tenant to sign, but the landlord needs PROOF the notice was sent so a tenant cannot claim non-receipt. Build a certificate of service: the landlord serves the N1 through the system, it records the delivery method (email / hand / mail), the served-on date, and generates a timestamped certificate the landlord can rely on. Reuse the lease e-sign audit-certificate machinery pointed at the N1. No tenant signature required.

### Gap B: push the increased amount onto the payment rail (Stripe)
Today updating `rent_cents` changes the recorded number but nothing auto-updates collection. Build the parked Stripe rate-change slice (`SPEC-STRIPE-RENT-RATE-CHANGE-2026-07-05.md`): push a recorded increase to the Stripe subscription via a Subscription Schedule phase date-gated to the effective date. Honest caveats: no live Stripe-rail tenancy exists yet (Stripe is TEST; Rotessa is the CA default, reopening ~August), so this ships DARK and proves on QA in Stripe test mode. Rotessa has the same gap; if Rotessa becomes the main rail, build the equivalent there.

## Reminder-timing decision (Noam, S425)
Re-anchor reminders on the SERVE-BY deadline, not the increase date (a reminder counted from the increase date lands on or after the last legal serve day and cannot prevent lateness). Cadence chosen: **45 days before serve-by (prep nudge) + 14 days before serve-by (last-chance nudge)**, labeled "Serve by [date]". Change `lib/rent-increase.ts` reminder lead logic accordingly (currently `REMINDER_LEAD_DAYS = 120` anchored on eligibility).

## Why queued behind Lease-OCR
Lease-OCR feeds the `start_date` + `rent_cents` the rent-increase engine runs on, so it is the natural first build; these two gaps follow.
