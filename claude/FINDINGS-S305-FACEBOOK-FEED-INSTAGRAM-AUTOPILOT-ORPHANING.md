# FINDINGS S305: facebook_feed and instagram are orphaned from the autopilot sweep, and the reason is not written down

Written 2026-08-28 (S305). Derived from worker `origin/main` at `8efb93b`, which is the
sha the box is running. [verified 2026-08-28 via BOX-READONLY-DIAGNOSTIC.sh]

## The shape

`src/autopilot-channels.ts` registers seven channels in `AUTOPILOT_CHANNEL_SCRIPT`.
`DEFAULT_AUTOPILOT_CHANNELS` is kijiji, rentals_ca, zumper.
`PAID_STOP_AUTOPILOT_CHANNELS` is viewit, rentfaster.

`facebook_feed` and `instagram` are in the script map and in NEITHER list, so they are
reachable only by setting `POLL_CHANNELS` explicitly.

S304 recorded this as looking unintentional. S305 does not agree, and the reason is
worth writing down.

## Why it is probably deliberate

The file documents the OTHER exclusion in an inline comment: paid channels "are
intentionally absent from DEFAULT_AUTOPILOT_CHANNELS." It is silent on facebook_feed and
instagram. An author who excluded two channels by accident does not usually write a
comment justifying a different exclusion three lines above.

The likely reason is that these two are the Meta surfaces and the Meta App Review was
submitted 2026-08-17 and is still in review. Sweeping Page-feed posts on a timer while an
app review is open is a risk nobody would take on purpose. **This is inference, not
evidence. Nothing in either repo states it.**

## The double-post theory, checked and ruled out

The obvious worry is that the app already publishes these two automatically, so a worker
sweep would double-post. It cannot, and the reason is precise:

- `lib/channel-publish-autofire.ts:57` selects items with `item.mode === "automatic"`.
- `claimApprovedJob` in `worker/src/claim.ts` selects items with `mode === "concierge"`
  and `publish_status === "needs_operator"`.

Different item modes. The two paths cannot contend for the same row. [verified 2026-08-28
via source on both repos]

## What the runners actually are

`src/phase-b-submit-facebook.ts` is Graph-backed, not a browser runner. Its own header
says so: it reads the Page token from `distribution_channel_sessions` and posts one
tracked `/r` link through the Graph API, recording Live only from the returned post id
and permalink. Same for instagram. So these two are `api_post` in the app's coverage
factory AND have a worker runner, which is not a contradiction: the worker runner is
simply a second caller of the same API.

Both `submit:fb:live` / `submit:fb:dark` and `submit:ig:live` / `submit:ig:dark` exist in
worker `package.json`. The registry does not point at missing scripts.

## Blast radius if they were swept today

Growth Test has `facebook_feed` and `instagram` account rows, both `connected` and both
`automation_authorized = true`. Agile has neither row. So a sweep would act on Growth Test
only. Neither runner has ever executed: zero rows in `distribution_publish_attempts` for
either channel, ever. [verified 2026-08-28 via Supabase]

## Recommendation

1. **Do not add them to `DEFAULT_AUTOPILOT_CHANNELS` while the Meta App Review is open.**
   The upside is two channels that have never been proven; the downside is Meta-facing
   automated posting during a review.
2. **Write the reason into the file either way.** A one-line comment next to the paid-stop
   comment. The cost of this omission was a full S304 finding and an S305 re-investigation.
3. **Add a coverage test that asserts the intended membership** of both lists, so a future
   change to either has to state its intent rather than drift.
4. Revisit once the App Review closes. At that point the question is a real product
   choice, not a defect.

## Status

Findings only. No change made to either list.
