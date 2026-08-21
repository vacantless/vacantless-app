# CODEX PROMPT — Landlord campaign: guarded single-recipient test-send (S606)

**Status: SPEC for review — do NOT build until Noam signs off. Campaign stays DARK. This adds a
test-only send path; it must be impossible for it to fan out to real landlords.**

## Why
Noam needs to see the real step-0 `rent_increase_confirm` email in his own inbox before any flip. The
email is "sent only by the dark campaign cron" — there is no preview/test send today, and flipping the
flag would email the four real landlords. This adds a tightly-guarded test send that delivers exactly ONE
real email to ONE explicitly-named address, using a real org's render path, with zero stamps and zero
effect on any other org.

## The change — `app/api/cron/landlord-campaign/route.ts`
Add a `test` mode alongside the existing `dry` mode (same `CRON_SECRET` auth via `authorized()`):
- Parse `const testTo = req.nextUrl.searchParams.get("test_to");` and
  `const testOrg = req.nextUrl.searchParams.get("test_org");`. Test mode is active only when **both** are
  present and non-empty.
- **Hard guards (all required, else 400 and send nothing):**
  - `test_to` must be a syntactically valid single email (no comma/semicolon/whitespace-separated lists —
    reject anything that could address more than one recipient).
  - `test_org` must resolve to exactly one existing organization.
  - Test mode **bypasses only the dark-master early-exit** for scanning that one org (like `dry`); it does
    **not** require or change `LANDLORD_CAMPAIGN_ENABLED`.
- **Behavior:** load `test_org`'s real tenancies/properties, build the step-0 `rent_increase_confirm`
  payload through the **exact same path a real run uses** — including the S606 `isWithinFirstYear` filter
  and `buildAnniversaryRentConfirmPlan` — then call `sendLandlordRentConfirmEmail({ ...payload, to_email:
  testTo })`. Send **exactly one** email, to `testTo` only.
- **Never:** send to the org's `landlord_campaign_email`, send to any other org, write
  `landlord_campaign_step_sent` / `landlord_campaign_last_sent_at`, or write any other DB row. If the
  filtered unit list is empty (all first-year/confirmed), return `{ ok:true, test:true, sent:0,
  reason:"no_eligible_units" }` and send nothing.
- Return `{ ok:true, test:true, sent:1, to:testTo, org:test_org, units:<n>, hero:<id|null> }`.

## Invariants — same lockdown as the gate ticket
- **No copy changes** (no reveal subject/body/CTA/`messages` edits). Reuse the existing renderers verbatim.
- **No routing change** to the real path; `resolveLandlordCampaignRecipient` and the real send/stamp code
  are untouched. Test mode is an additive, mutually-exclusive branch.
- **Cannot fan out:** exactly one `to`, one org, one email, no stamps. Reject any multi-address `test_to`.
- **No migration / column / schedule / other-reveal change.** Real `dry` and real runs behave identically
  to today when `test_to`/`test_org` are absent.

## Tests (`scripts/test-landlord-campaign.ts`, extend)
- Test mode with a valid `test_to` + `test_org` → exactly **1** email call to `test_to`, **0** stamps, **0**
  writes, and it never reads/uses `landlord_campaign_email`.
- Multi-address `test_to` (comma/space) → rejected, **0** sends.
- Missing `test_org` or unknown org → rejected, **0** sends.
- First-year-only test org → **0** sends, `reason:"no_eligible_units"`.
- A normal run and a `?dry=1` run are unchanged when the test params are absent.

## You must run (Cowork runs tsc only on the device VM — KI967)
`npx tsc --noEmit` · `npm run lint` · `npx tsx scripts/test-landlord-campaign.ts` · `next build`.

## Acceptance
- With `test_to`+`test_org` (auth'd), exactly one real step-0 email lands at `test_to`, nothing is stamped,
  no other org is touched, and the flag stays dark. Absent the params, behavior is byte-identical to
  df1d4f5. Commit **by name** (KI971), push `main`, report sha. **Do NOT flip
  `LANDLORD_CAMPAIGN_ENABLED`.**

## After it ships (Cowork)
Cowork seeds a QA test org (Noam-owned, one mature tenancy + confirm token) as the `test_org` render
source — so the pills in Noam's copy are safe test tokens, not a real landlord's — then fires
`?test_to=<Noam>&test_org=<qa>` and confirms the email + a clickable walk of `/confirm-rent`.
