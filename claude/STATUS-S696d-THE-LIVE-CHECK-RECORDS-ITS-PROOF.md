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

## THE DRY RUN, and it settles both open questions [measured 2026-09-11, Actions run #5, `ca627da`, mode=dry, nothing written]

```
scanned 11   live 8   challenge 3   removed 0   errors 0
```

| portal | rows | verdict | reason |
|---|---|---|---|
| Zumper | 6 of 6 | **live** | `zumper_inquiry_cta_present` |
| Kijiji | 2 of 2 | **live** | `kijiji_ad_page_200` |
| Rentals.ca | 3 of 3 | challenge | `bot_wall_page` |

**Zumper self-confirms from Vercel's own egress, all six rows.** The doubt recorded above was that Zumper stores the login-walled `/manage/` URL and that the live marker might be injected by JavaScript and absent from server-rendered HTML. Neither happened. The derived `/listings/<id>` URL returns the inquiry CTA to a plain fetch. **Zumper moves from assisted to proven on the first armed run, alongside Kijiji.**

**`removed: 0`, which retires the one real risk in arming the flag.** The removal write has never run in production and it is the half that changes landlord-visible rows. Today nothing classifies as removed, so an armed run flips no row at all: its only effect is 8 proof inserts. The scoped `portal=` input built in S696e is therefore belt-and-braces rather than necessary, and is worth keeping for the next time this is not true.

**Rentals.ca stays behind a Cloudflare bot wall** and will not self-confirm. It is already `proven` from 4 machine `external_url` checks written by another route, so this changes nothing for it. If those decay past the freshness window, Rentals.ca drops to unproven with no way to re-earn proof by this path. **That is the next real gap.**

## Follow-ups

1. **Set `LISTING_POST_LIVE_CHECK_ENABLED=true` in Vercel and redeploy** (env bakes at build), then run the workflow unscoped. Expect `proved: 8`, `wrote: 0`.
2. Confirm in SQL that Kijiji and Zumper both carry fresh machine proof, and that `channelEvidence` returns both as `proven`.
3. **Rentals.ca has no self-confirming path.** Cloudflare answers the Vercel fetch with a bot wall, so its proof has to keep coming from the route that produced its existing four checks, or the channel decays to unproven on its own in 90 days.
