# PROPOSAL S696: syndication shows only what it has actually done, and nothing else

Date: 2026-09-11 (Session 696). Noam: "For syndication I also want to only show what we can do successfully and not what we can't. Once Vacantless is showing what is working only we can start to sell it."

All figures [verified 2026-09-11 via SQL against PROD].

## The rule

**A channel earns its place on the landlord's screen by its own posting record, not by being in the capability catalog.** The catalog says what we intend. `distribution_run_items` and `listing_posts` say what happened. Today the screen is driven by intent, which is why it offers channels that have never once produced a live ad.

## What the record actually says

| Channel | Attempts | Live | Stuck | How the wins happened | Posts live now | Posts dead |
|---|---|---|---|---|---|---|
| Your Vacantless page | 16 | **16** | 0 | automatic | n/a | n/a |
| Zumper | 4 | **4** | 0 | concierge | 6 | 0 |
| Rentals.ca | 5 | **4** | 1 | concierge | 3 | 1 |
| Facebook Page feed | 2 | **2** | 0 | automatic | 2 | 0 |
| Instagram | 3 | 1 | 1 | automatic | 1 | 1 |
| Kijiji | 23 | 4 | **18** | browser co-pilot | 2 | 6 |
| Facebook Marketplace | 11 | 1 | **9** | browser co-pilot | 4 | 3 |
| Org feed | 14 | 0 | 1 | submitted, never confirmed live | n/a | n/a |
| RentFaster | 2 | **0** | 2 | never succeeded | 0 | 0 |
| Viewit | 1 | **0** | 1 | never succeeded | 0 | 0 |
| LinkedIn | 1 | **0** | 1 | never succeeded | 0 | 0 |

**The finding that matters most, and it is uncomfortable.** Every Kijiji win and the single Facebook Marketplace win came through `browser_copilot`, **the self-guided path S695 deleted**. By the route those two channels have today, which is concierge, Kijiji is 0 for 7 and Facebook Marketplace is 0 for 2. So the two channels the product talks about most have **no successful post by any route that still exists.**

Second finding: **org_feed has 13 rows at `submitted` and zero at `live`.** Submitted is not live. If any surface counts submitted as a win, it is overstating.

## What the screen shows, in three states, all derived

**Proven.** Has produced a live, verified public URL by a route that still exists, within the freshness window. Shown with its record. Sellable.

**Assisted.** Only ever succeeded with a person doing it. Shown, but described as what it is: we post it for you. Never promised as automatic, and priced as service rather than software.

**Unproven.** No successful post by a surviving route, or none recently. **Not shown to the landlord at all.** No logo, no greyed-out tile, no "coming soon". It lives in an internal list only. A disabled tile is still showing what we cannot do.

On today's data the landlord would see **four**:

- **Your Vacantless page**, proven, automatic, 16 of 16
- **Facebook Page feed**, proven, automatic, 2 of 2
- **Zumper**, assisted, 4 of 4, 6 ads live right now
- **Rentals.ca**, assisted, 4 of 5, capped at one listing per account

And would see nothing at all for RentFaster, Viewit, LinkedIn and org_feed. Kijiji, Facebook Marketplace and Instagram are the hard cases, below.

## The three hard cases

**Kijiji** genuinely produces renters: 1,032 enquiries reached Aaliyah's inbox over two years, and two paid ads are live now. But the product has never successfully posted one by a surviving route. The honest presentation is **assisted, with the record shown as "posted by hand"**, not as a button that implies the product does it. Do not hide it, because the channel works; do not claim it, because we do not.

**Facebook Marketplace** is the same shape with a worse record and an extra problem: leads land in a personal Messenger nobody can delegate. Assisted at best, and its copy is frozen until the Meta verdict on or before 2026-09-22 anyway.

**Instagram** is 1 of 3 and sits behind Meta approval. Until the verdict it is unproven by this rule. Leave it out and revisit on 09-22.

## The mechanism

One pure function, `channelProvenness(runItems, listingPosts, asOf)`, returning `proven | assisted | unproven` per channel with the counts behind it. Three properties matter:

1. **It reads history, never the catalog.** The catalog can still declare a channel; declaring it does not display it.
2. **A route that no longer exists does not count.** A win by `browser_copilot` cannot make a channel proven today. This is the rule that demotes Kijiji and Facebook Marketplace honestly.
3. **Proven decays.** No live post within the freshness window and the channel drops to unproven and disappears on its own. Without decay the screen drifts back to aspiration within a month, which is how it got this way.

Capacity has to ride along with it: Rentals.ca is one listing per account, so "proven" must not promise a fifth placement on an account that holds four. Proven means proven **and** placeable.

## Why this is the precondition for selling

The $199 syndication tier cannot be described honestly today, because the list of what it does is a list of intentions. After this change it is describable in one sentence with numbers attached: **these four, here is our record on each, here is what is done by machine and what by hand.** That is a sellable claim, it is checkable, and it is the first version of the offer that will not generate a refund conversation.

It also shrinks the product, which is the right direction. Four channels that work beat eleven that mostly do not.

## Scope

Small, and none of it touches the Meta path.

1. `lib/channel-provenness.ts`, pure, with tests. Takes run items, listing posts, the surviving-route list and `asOf`.
2. The distribute surface and the catalog filter through it. Unproven channels are not rendered.
3. An internal-only view that shows all channels with their records, so nothing is lost and the next session can see why something is hidden.
4. `submitted` stops counting as a win anywhere.

**Held until the Meta verdict:** anything that renames or removes a control named in the App Review material. The channel cards stay where they are until 09-22; this proposal changes what is listed, not the Meta connect path.

## One thing to decide

Freshness window for decay. Ninety days is the obvious default for a leasing product, since a channel that has placed nothing in a quarter is not a channel you should be selling. **Not set here. Your call.**
