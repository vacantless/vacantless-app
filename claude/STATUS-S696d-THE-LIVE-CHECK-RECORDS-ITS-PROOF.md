# STATUS S696d: the live check confirms ads every day and never wrote it down

Date: 2026-09-11 (Session 696). Follows `STATUS-S696c-CHANNEL-PROVENNESS-BUILT-DARK.md`, whose top follow-up was "get Kijiji one machine confirmation in a customer organization."

**Not committed at time of writing.** Three files plus this doc. **No migration.** One new production write, described below, gated on an existing flag that is currently OFF.

## The finding

S696c hid Kijiji from the landlord's screen because it had no machine confirmation in a customer account, despite two paid ads being live for Agile right now. The obvious reading was "go and check one."

**The check already runs.** `app/api/cron/listing-post-live-check/route.ts` has fetched every live Kijiji, Zumper and Rentals.ca ad daily since S693, from Vercel, and classifies each one. **It only ever wrote when a portal said an ad was GONE.** `liveCheckRowPatch` returns null for anything but a `removed` verdict, so a machine confirming a live ad produced no row, no record, nothing.

So the strongest evidence this product generates has been thrown away once a day for four days. Kijiji was not unproven for want of a check. It was unproven for want of a pen.

## What changed

**`lib/listing-post-live-check.ts`** gains `liveCheckProof`, pure and tested: given the row, the outcome, the URL actually fetched and the last machine proof on file, it returns what to record, or null.

- **Only a `live` verdict is proof.** A challenge page, a login wall, an unreachable host and an `unknown` shape return null. A recorded proof has `checked_by` null, which is what MACHINE means to `lib/channel-provenness`, so recording anything weaker would manufacture the exact false claim that module exists to refuse. Every one of those verdicts has its own assertion.
- **One proof per listing post per 7 days** (`LIVE_CHECK_PROOF_INTERVAL_DAYS`). The check runs daily; a row per ad per day would turn "confirmed live 4 times" into "confirmed live 87 times", and that count is shown to a landlord. Volume is not evidence.
- A last-proof timestamp in the future does not open the window, and an unparseable one records rather than blocking.

**The route** reads the latest machine proof per post in ONE query before the loop, then on a live verdict inserts a `distribution_verifications` row: `checked_by` null, `verification_type` external_url, `result` verified_live, the URL fetched, the listing post, the org. Summary gains `proved`; each detail gains `proved`.

**The write is gated on `LISTING_POST_LIVE_CHECK_ENABLED`, the same flag as the removal write**, so a dry run still writes nothing and nothing changes until that flag is set.

## Verified, not assumed

Both ads were read in a browser on 2026-09-11 and both render: ad `1742970091` ($1,250, Main Floor) and ad `1742946283` ($1,225, 3rd Floor), each "Listed By Agile Real Estate Group", each carrying the tracked `?p=` link whose id matches its own `listing_posts` row (`287d07ad...` and `a1fa2a4c...`). **The ad-to-row binding is confirmed rather than inferred.**

**That browser read is NOT the evidence.** It is preflight. The verification row must be written by the production machine fetching from Vercel's egress, or it is a person's word wearing a machine's label.

The verdict change was **predicted against real production rows before shipping**: the live `channelEvidence` over 2,476 real verifications and 18 live posts, plus exactly the two rows the route would insert.

```
BEFORE  kijiji: unproven  machine=0 liveNow=2
        "Only ever confirmed live in an account we run ourselves."
        SHOWN: vacantless, rentals_ca, zumper

AFTER   kijiji: proven    machine=2 liveNow=2
        "Confirmed live 2 times by re-reading the ad, most recently 2026-09-11."
        SHOWN: vacantless, rentals_ca, kijiji, zumper
```

## What Noam has to decide, because it is not only about Kijiji

`LISTING_POST_LIVE_CHECK_ENABLED` is OFF and has been since S693 on purpose. Setting it arms **both** writes:

1. **The new proof write.** Additive, insert-only, no existing row changes.
2. **The removal write, which has never run in production.** A row the check reads as `removed` is flipped `live -> removed` with a dated note. That is a landlord-visible change to real listing rows.

The removal side is the one that deserves the care. Its signals were measured on 2026-09-07 and it refuses to write on `challenge`, `needs_login`, `unreachable` or `unknown`, but it has never once written for real. **The safe order is a dry run first**, read the verdicts, then enable.

## Verification

- `tsc --noEmit` clean. `eslint` clean on all three files.
- `test-listing-post-live-check` **132/132** (was 111). 21 new assertions, most of them about what is refused.
- Plain-language gate unchanged. Full suite: the same 3 known reds.
- No em dashes.

## Follow-ups

1. **Dry-run the check from production and read the verdicts** before enabling the flag.
2. Then enable, let one run write, and confirm Kijiji flips to proven.
3. **Zumper is the bigger prize, and this is a prediction, not a result.** It is `assisted` today because only people have ever confirmed it, and it is a `LIVE_CHECK_PORTALS` member with 6 live ads across three organizations. If those rows read `live` from Vercel, the same run earns Zumper machine proof and moves it to proven. **Not measured. The dry run in follow-up 1 is what settles it**, and Zumper rows store the login-walled `/manage/` URL, so a `needs_login` verdict is a real possibility.
4. Rentals.ca answered `challenge` (Cloudflare) from Vercel in S693 and may never self-confirm; its existing machine checks came another way.
