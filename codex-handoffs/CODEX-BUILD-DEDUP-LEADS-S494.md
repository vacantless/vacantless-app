# CODEX BUILD — De-duplicate `/r` lead capture (+ optional reply-to hardening) — S494

**Owner:** Cowork-authored, Codex to build on the Mac. **App HEAD at authoring:** 1f9b03e. **No migration expected for Part 1; Part 3 is a small pure-fn change.**
**Origin:** Live incident 2026-07-15. Renter **Larry Lalonde** (Agile org `921f7c08`, 833 Pillette Unit 20) produced **3 lead rows + 3 "New inquiry" operator emails** from what should have been one submission, all within a 4-second window:

| lead_id | created (local) | status | showing? |
|---|---|---|---|
| b1e662ab… | 10:59:15 | booked | yes (Jul 16 5:30pm) |
| e6259ee0… | 10:59:18 | new | no |
| c1318c79… | 10:59:19 | new | no |

Same renter email (`lawrencealalonde@gmail.com`) on all three. The booked one is the real lead; the two "new" rows are junk dupes that (a) clutter the pipeline, (b) inflate lead counts, and (c) fired duplicate `new_lead` operator alerts to rentals@/Peter/noam.

---

## Ground truth (verify before building)
- Public submit path: `app/r/[propertyId]/actions.ts` → `submitLead` (~line 592) → `supabase.rpc("submit_public_lead", …)` (~line 641). Each invocation inserts a NEW lead; there is **no dedup by (org, property, renter contact)** and the booking path reuses that same `lead_id` (so one submit = one lead; three leads ⇒ three submit invocations).
- Operator alert: `notifyOperatorsOfNewLead(payload, …)` fires once per submit invocation (~line 678), so duplicate submits ⇒ duplicate alerts.
- Reply-to plumbing (context for Part 3): `lib/email.ts` `replyToOf(replyToEmail, orgName)` returns `{ email: replyToEmail || DEFAULT_SENDER_EMAIL }` where `DEFAULT_SENDER_EMAIL = "leads@vacantless.com"`. When an org's `reply_to_email` is null, renter replies fall back to the shared platform inbox instead of the org's leasing inbox.

## Root cause (to confirm)
A double/triple submit of the `/r` form. Two contributing gaps, either or both:
1. **Client:** the submit control is likely not disabled on click / lacks a pending guard, so a fast double-tap or a network retry re-invokes the server action.
2. **Server:** `submit_public_lead` has no idempotency — it inserts unconditionally rather than reusing a recent open lead for the same `(organization_id, property_id, lower(email))`.

## Part 1 — Server-side dedup (primary)
In `submit_public_lead` (find the latest migration defining it; add a new idempotent migration — do not edit an applied one): before inserting, look for an existing **open** lead for the same `(organization_id, property_id, lower(trim(email)))` created within a short window (suggest **10 minutes**). If found, **reuse that lead** (return its id) instead of inserting a new row. Booking-with-slot must still win: if the incoming submit carries a slot and the reused lead has no showing yet, proceed to book against the reused lead. Null/blank email ⇒ keep current insert behavior (don't collapse anonymous inquiries). This makes the whole submit path idempotent regardless of client behavior.

## Part 2 — Client double-submit guard (defense in depth)
In the `/r` submit form component, disable the submit button and show a pending state on first click (e.g. `useTransition` / `formStatus.pending`) so the action can't be fired 2–3× in a burst. Keep it a guard, not the only fix — Part 1 is the durable one.

## Part 3 — OPTIONAL reply-to hardening (prevents the sibling bug from the same incident)
Same Larry incident: his replies to the auto-reply + booking-confirmation emails went to `leads@vacantless.com` (→ platform inbox) instead of the org's `rentals@agileonline.ca`, because `reply_to_email` resolved empty at send time. The value is set now, so this is fixed going forward — but to make it structurally safe, change `replyToOf` (and/or the payload sources) to fall back to the org's `public_contact_email` **before** `DEFAULT_SENDER_EMAIL`. i.e. `reply_to_email || public_contact_email || DEFAULT_SENDER_EMAIL`. That guarantees a renter reply reaches the org even if an operator never sets `reply_to_email`. Requires threading `public_contact_email` into the auto-reply + booking payloads where it isn't already. Pure-fn + payload change; add a `test-email`/`replyToOf` unit test covering the three-tier fallback. **Only build if Noam greenlights** (he scoped Part 1 as the ask).

## Gates
`tsc --noEmit` clean; `npm run lint` clean; add/extend unit tests: (a) `submit_public_lead` dedup (same email within window reuses; different email inserts; slot-carrying submit books the reused lead; null email still inserts), (b) Part 3 `replyToOf` three-tier fallback if built. Idempotent migration for Part 1 applied to prod via the Supabase MCP after review. Verify the diff via `device_bash git` in the MAIN Cowork context (subagents can't call device_bash).

## Explicitly out of scope
Retroactive cleanup of the two existing Larry dupe rows (Cowork will retire those separately). No change to the booking/attemptBooking success path. No change to notification recipients.
