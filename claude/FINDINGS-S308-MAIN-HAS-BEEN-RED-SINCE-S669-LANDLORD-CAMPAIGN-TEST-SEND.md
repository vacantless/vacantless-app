# S308: production main has been red for ten days, and nobody was watching

_Found 2026-08-30 while verifying an unrelated change. Read-only diagnosis. The fix is written and verified but NOT applied._

## The claim, and how it was proven

`scripts/test-landlord-campaign.ts` fails on a clean clone of production main `b3b9b97`, on one assertion: **"test send does not select landlord_campaign_email"** (80 passed, 1 failed of 81).

Bisected by checking out each commit and running the test:

| commit | date | result |
|---|---|---|
| `7f8e19d` (`039a955^`) | 2026-08-20 | **81 passed, 0 failed** |
| `039a955` "S669 renter reply routing" | 2026-08-20 | **80 passed, 1 failed** |
| `b3b9b97` (PROD today) | 2026-08-27 | **80 passed, 1 failed** |

**`039a955` is the commit.** It widened the test-send org select in `app/api/cron/landlord-campaign/route.ts:551` from

```
"id, name, brand_color, logo_url, reply_to_email, public_contact_email, booking_timezone, plan"
```

to the full campaign-org column list, adding `mail_alias`, `created_at`, the three campaign watermark columns **and `landlord_campaign_email`**. Its stat shows it touched that route file and nothing else in this area, so the test was never updated to match. Main has been red since 2026-08-20.

## What the assertion protects, and whether anything actually leaked

**Nothing leaked.** The assertion is defense in depth, not the routing control.

The real safety property is the assertion immediately above it, **"test send routes only to test_to"**, and it still passes. Inside the `testMode` branch the only recipient used is `to_email: normalizedTestTo!`; `org.landlord_campaign_email` is **selected and never read** there. The landlord address is only consumed on the real path, at `:808` via `resolveLandlordCampaignRecipient(org.landlord_campaign_email)`.

So the guard being violated is "do not even fetch the landlord's address on a test send". That is worth keeping. A test send exists precisely so someone can exercise a landlord-facing campaign without a landlord receiving anything, and the cheapest way to keep that true is for the address never to be in scope in that branch.

## The fix, verified but NOT applied

Drop `landlord_campaign_email` from the **test-send select only** (`route.ts:551`). Leave the real path's select at `:664` untouched. The field is declared optional on `CampaignOrg` (`:86` `landlord_campaign_email?: string | null`), so removing it from that one select is type-safe.

Verified in the cloud container against a clean clone of `b3b9b97` plus this one edit:

- `scripts/test-landlord-campaign.ts` **81 passed, 0 failed**
- `npx tsc --noEmit` clean
- **full suite: 233 of 233 pass, zero failures**

That last line is the point. With this one edit the repository is fully green for the first time since 2026-08-20.

## Why it was not applied

The working tree already carries the S308 Kijiji catalog change awaiting its own commit, and `COMMIT-S308.sh` gates on nothing else being modified. Mixing an unrelated route change into that commit would defeat the gate. Apply this separately, with `APPLY-S308B-LANDLORD-CAMPAIGN-TEST-SEND-SELECT.sh` at the project root, after the S308 commit lands.

## Two things worth saying out loud

**A widened `select` is a behaviour change, not a refactor.** `039a955` was a renter-reply-routing commit; the landlord campaign was collateral. Growing a column list is the kind of edit that reads as harmless and is not.

**Nothing told anyone.** Ten days, seven production deploys, and a red suite the whole time. There is no gate that runs these 233 scripts on push, which is why S308 only found this by cloning production main and running them by hand.
