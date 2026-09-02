# FINDINGS S675: the stale-ad defect is four gates deep, and the obvious fix changes nothing

Date: 2026-09-02 (Session 675)
Baseline: PROD `82776e6` [Vercel `dpl_EPZj62eUfYjMhcr4qLfhiWpPjkiC`, READY, production, aliased].
`vacantless-app` local HEAD `82776e6` on `main`, clean but for the seven known uncommitted `claude/`
docs. Schema `0223`. **No code shipped by this session.**

## Why this was picked up

S674 recorded "the CA$1,275 Marketplace ad advertises an `off_market` unit" as a second live instance
of `archiveProperty`-never-takes-the-ad-down, after Unit D, and left it as Noam's call. S675 measured
the syndication lanes and found Facebook is Agile's #2 demand source (26 referred leads in 30 days
against 84 from the renter page), which makes a stale Facebook ad a lead-destroying defect and not a
cosmetic one. This doc establishes what actually happens in code before anyone proposes a fix.

## The live data, not the anecdote

`listing_posts` joined to `properties` for Agile [verified 2026-09-02 via Supabase]:

| Property | status | archived | portal | post status | url |
|---|---|---|---|---|---|
| 1551 Assumption Unit D | `off_market` | yes | `facebook` | **live** | `marketplace/item/1915331599118623` |
| 833 Pillette Unit 30 | `off_market` | yes | `facebook` | `expired` | `marketplace/item/4330161737257937` |
| 833 Pillette Unit 22 | `off_market` | yes | `kijiji` | `draft` | none |
| 833 Pillette Unit 20 / 3 / 33 | `available` | no | `facebook` | `live` | three live Marketplace items |

**Exactly ONE row is both off-market and `status='live'`: Unit D.** Unit 27 has no `listing_posts` row
at all. Unit 22 has only a Kijiji draft.

**So the CA$1,275 ad Noam is looking at is almost certainly Unit 30's `4330161737257937`, which this
table already calls `expired`.** That is a SECOND and different defect from the Unit D one: a post
marked `expired` in our table is still serving on Facebook. It is the same class as the known rule
that a portal row's `live` is an operator assertion with no expiry - the inverse case. **Nothing in
the product probes Facebook, so neither `live` nor `expired` is evidence about the world.**

## The four gates between `archiveProperty` and an ad coming down

Read at `82776e6`:

1. **`archiveProperty` does not call the lifecycle at all.** `app/dashboard/properties/actions.ts:1466-1497`
   reads `status`, computes `archivePropertyStatusUpdate`, writes `properties`, revalidates, redirects.
   That is the whole function. `handleLeaseupAdLifecycle` is imported in that file (`:163`) and called
   in exactly one place, `:1007`, on the save path.

2. **The lifecycle early-returns on anything but `leased`.**
   `lib/leaseup-takedown.ts:273`: `if (!property || property.status !== "leased") return;`
   And its only two call sites are both guarded by `priorStatus !== "leased" && effectiveStatus === "leased"`
   (`properties/actions.ts:1006`, `tenancies/actions.ts:324`).
   `archivePropertyStatusUpdate` (`lib/property-archive.ts:29-42`) writes `off_market`, never `leased`.

3. **The decision function cannot express an off-market takedown.**
   `lib/leaseup-decision.ts`: `propertyStatus` is typed as the literal `"leased"`. Widening it is a
   type change, not a config change.

4. **The whole thing is behind `LEASEUP_TAKEDOWN_ENABLED`** (`leaseup-takedown.ts:49`), a Vercel env
   that bakes at build. **Its production value is NOT readable** - the Vercel MCP `get_project`
   returns no env values [verified 2026-09-02]. Treat it as unknown until proven in the UI, the same
   trap as `IG_CHANNEL_ORG_ALLOWLIST`.

## THE POINT: wiring archive into the lifecycle would change nothing for these units

Even with gates 1 to 4 all removed, `decideLeaseupAdLifecycle` runs this ladder:

```
isPaid                     -> skip_paid
siblingAvailableCount > 0  -> steer_to_pool      <-- fires here
waitlistEnabled            -> repoint_to_waitlist
otherwise                  -> takedown
```

`siblingAvailableCount` counts same-`beds`, same-`unit_type` siblings that are `available` and not
archived. **Agile has three available units at 833 Pillette right now (20, 3, 33), all 1-bed.** So an
off-market Pillette 1-bed would decide **`steer_to_pool`** and deliberately leave the ad up to catch
demand for its siblings.

**That is arguably correct product behaviour, and it is exactly the behaviour Noam is complaining
about.** The ad stays up pointing at a unit that does not exist, and the renter who clicks it gets a
referral page rather than the unit advertised. The disagreement is not a bug in the ladder; it is that
`steer_to_pool` was designed for a tracked link that can be repointed, and a **Facebook Marketplace ad
cannot be repointed** - its price, address and photos are baked into Facebook's own copy.

**So "wire `archiveProperty` into `handleLeaseupAdLifecycle`" is the wrong fix. It is a one-line change
that would produce a `steer_to_pool` log row and no behaviour change.** Anyone proposing it has not
read the ladder.

## Automation is not available for these ads, and never will be through this path

`automatedDelete` requires `post.portal === FB_PAGE_FEED` (`"facebook_feed"`) plus an authorized,
connected channel account (`leaseup-takedown.ts:339-342`). **Every stale row above is portal
`facebook`, which is Marketplace, not the Page feed.** Marketplace listings are not Graph-deletable
Page posts, and Agile has no `facebook_feed` or `instagram` channel account row at all [verified
2026-09-02]. The automated deletion path is `npm run takedown:leaseup` in the worker keyed by
`TAKEDOWN_ITEM_ID` (comment at `leaseup-takedown.ts:11-13`) and it acts on Page posts.

**Therefore the only honest output for a stale Marketplace ad is an operator task, not automation.**
This is the same conclusion the syndication lane reached generally: it is an escalation business.

## The shippable slice, and what to keep out of it

**Ship: an off-market stale-ad operator notification. No migration, no automation, no status writes.**

When a property transitions out of `available`/`paused` - archive, or an off-market save - and it has
`listing_posts` rows with `status = 'live'`, send the operator one notification per property naming
each live post URL and asking them to take it down or repoint it by hand. Reuse
`sendLeaseupTakedownNeededNotification`'s shape (`leaseup-takedown.ts:100+`) and
`leaseupTakedownDashboardUrl`. Behind its own flag, dark by default.

**Keep out of v1, deliberately:**
- **Do not touch `decideLeaseupAdLifecycle`'s ladder or its `"leased"` literal.** The leased path is
  shipped behaviour with a passing test (`scripts/test-leaseup-takedown-confirm.ts`).
- **Do not write `listing_posts.status`.** We cannot prove an ad came down, and Unit 30 is the standing
  proof that our `expired` and Facebook's reality disagree. Writing a status we cannot verify is how
  the `live`-is-an-assertion problem got created.
- **Do not delete or edit any live ad.** Irreversible, and it is Noam's call with Narayan.
- **Do not reuse the `takedown` run-item transport.** That transport is claimed by the worker and
  implies a Graph delete that cannot happen for Marketplace.

## The measurement that should follow it

Unit 30 proves the table can say `expired` while the ad serves. A notification fixes the archive
moment; it does nothing for the ads already stale. **A one-off reconciliation of the five Agile
`facebook` rows against what is actually live on Marketplace is a separate, manual, Chrome-driven
task**, and it is the thing that would tell us how big this really is. It is not a code change.

See also `FINDINGS-S674-ALREADY-LIVE-IS-THE-S642-CONTRACT.md` for the same lesson in the other
direction: before "fixing" a status, find the contract that writes it.
