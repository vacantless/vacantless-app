# Codex QA handoff — S474 (P1 fold) + S474b (concierge "Publish for me" queue)

Please review as one unit. Both are LIVE + Vercel READY (`app.vacantless.com` = `7fa4b36`).

## Commits / range
- **S474** `29f1da5` — folds YOUR S471 P1 (agent-only `showing_instructions` reachable via the anon booking-extras RPC).
- **S474b** `7fa4b36` — concierge "Publish for me" queue (the one-click Publish Run delta).
- **Full range:** `53b4976 (S473) .. 7fa4b36` on main.
- **Migrations applied to prod (`nvhvdyxpyogvadpjlvij`) via MCP + verified:** `0138`, `0139`.

## S474 — what shipped
Your S471 P1: `get_booking_confirmation_extras` is SECURITY DEFINER + granted to `anon`, and still
returned `showing_instructions` (an agent-only LOCKBOX note) after S473 stopped RENDERING it — so a
renter with a public property id could call the RPC directly and read it.
- **0138** — `get_booking_confirmation_extras` now returns ONLY `leasing_phone` + `plan` (no
  `showing_instructions`). Verified in prod: def no longer contains the field; anon/authenticated
  execute grants preserved; live RPC output = `{plan, leasing_phone}`.
- `app/r/[propertyId]/actions.ts` — stopped reading `e.showing_instructions` + passing it to
  `sendBookingConfirmation` (dead after S473).
- `app/api/cron/reminders/route.ts` — dropped the dead property select + read + `sendShowingReminder` param.
- `lib/email.ts` — removed the dead `showing_instructions` fields from `BookingPayload`/`ReminderPayload`.

### S474 review focus
1. **Completeness of the P1 fix.** Confirm NO renter surface (RPC, email, page, token route) still
   exposes `showing_instructions`; it should live only on the operator dashboard + `/agent/[token]`.
2. **No regression:** the anon booking path still resolves `leasing_phone` (arrival phone) + `plan`
   (renter-SMS gate); grants unchanged; renters keep arrival phone + map + photo-ID.
3. **Dead-field removal** doesn't break any other caller of those payload types.

## S474b — what shipped
Operators on a paid plan can hand a human-action publish channel (Kijiji/FB/broker/custom in a
`needs_*` state) to the Vacantless publishing desk: the run item flips to `mode='concierge'` +
`publish_status='queued'`; a superadmin claims it, posts it, and marks it live (which produces the
tracked `listing_posts` row). Each concierge request is one countable done-for-you unit (the row is
the billing meter; no price/quota wired yet).

### Files
- `supabase/migrations/0139_distribution_concierge_queue.sql` — adds `concierge_requested_at/by`,
  `concierge_claimed_by/at` to `distribution_run_items` (mode/publish_status already allow
  `concierge`/`queued` from 0137, so NO constraint change). Applied + verified.
- `lib/distribution-publish.ts` — `canRequestConcierge(status, mode)`, `CONCIERGE_ELIGIBLE_STATUSES`,
  `CONCIERGE_OPEN_STATUSES`, `CONCIERGE_*_AUDIT` consts (all pure).
- `scripts/test-distribution-concierge.ts` — eligibility truth table (60/0).
- `app/dashboard/properties/actions.ts` — `requestConciergePublish()` operator action.
- `app/dashboard/properties/[id]/launch-run-panel.tsx` + `page.tsx` — "Publish for me" button on
  eligible items; `canConcierge` computed with the `listing_marketing` entitlement.
- `app/dashboard/admin/concierge/page.tsx` + `concierge-actions.ts` — superadmin desk
  (claim / mark-live-with-URL→listing_post / reject); linked from `/dashboard/admin`.

### S474b review focus (priority order)
1. **[HIGHEST] Staff-desk authZ.** `concierge-actions.ts` uses the SERVICE-ROLE admin client (bypasses
   RLS, works across orgs). Confirm EVERY mutation (`claim`/`complete`/`reject`) rechecks
   `isAdminEmail(user.email, adminEmails())` server-side BEFORE the admin client, and that
   `/dashboard/admin/concierge` 404s for non-admins (mirrors the S465 guideline console).
2. **Cross-org integrity in `completeConciergeItem`.** `organization_id`/`property_id` for the
   `listing_posts` write are derived from the RUN (via admin read), never from client input — confirm
   no cross-org listing_post cross-link (same invariant as `updateRunItem`).
3. **Operator action IDOR.** `requestConciergePublish` gates on `requireCapability("manage_properties")`
   + `hasEntitlement(plan, "listing_marketing")`, reads the item via the RLS-scoped user client, and
   derives the property from the run (not the form). Confirm an operator can only flip their own org's
   items, and that `canRequestConcierge` is re-checked server-side (not just in the UI).
4. **Eligibility rule.** `canRequestConcierge` — only `needs_operator/needs_login/needs_payment`, never
   `automatic` or already-`concierge`. Correct? Any status that should/shouldn't be handoff-able?
5. **Entitlement choice.** Concierge is gated on the existing `listing_marketing` entitlement (Growth/
   Premium yes, Free no) rather than a new `concierge_publish` key — deliberately, to avoid churning
   the billing matrix. Flag if you'd want a dedicated entitlement + quota BEFORE billing is wired.
6. **Billing-meter semantics.** Re-requesting concierge resets `concierge_claimed_by/at` and re-stamps
   `concierge_requested_at`. Confirm that's sane for a "count of done-for-you units" meter (no double
   count intended per request; a re-request is a new work item).
7. **Run completion parity.** `completeConciergeItem` re-derives `allResolved` via
   `isResolvedPublishStatus(normalizePublishStatus(...))`; confirm parity with `updateRunItem`'s
   `publishItemResolved`.
8. **Known limitation (confirm acceptable, not a bug):** the tracked `listing_posts` row (and thus the
   `?p=` link) is created at MARK-LIVE, so a concierge-posted ad only carries the tracked link if staff
   include it when posting. Per-ad attribution starts at go-live. Worth a pre-post tracked-link step?

## Gates (green on device, S474 + S474b)
- `tsc --noEmit` clean; `next lint` clean (touched files); `next build` clean (both deploys).
- `scripts/test-distribution-concierge.ts` 60/0.

## Out of scope
- N-form / N4 library (`N-FORM-LIBRARY-DESIGN-2026-07-12.md`) — DESIGN ONLY, no code this batch.
- The S472 publish-run core (`lib/distribution-publish.ts` adapter model, migration 0137) is your own
  accepted work — only re-touch if S474b surfaces a shared-helper issue.
