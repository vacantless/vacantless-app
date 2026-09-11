# STATUS S696c: syndication lists only what it has actually done, and the first version of the rule was wrong on real data

Date: 2026-09-11 (Session 696). Implements `PROPOSAL-S696-SYNDICATION-SHOW-ONLY-WHAT-WORKS.md` and corrects one of its headline numbers.

**Not committed. Built dark** behind `SHOW_ONLY_PROVEN_CHANNELS`, unset in every environment. With the flag off the publish surface renders exactly as it does today. **No migration. No production data written. The Meta Connect and Disconnect controls are byte-for-byte unchanged.**

## What it is

| File | What it is |
|---|---|
| `lib/channel-provenness.ts` | Pure. Decides `proven`, `assisted` or `unproven` per channel from the posting record. |
| `scripts/test-channel-provenness.ts` | 57 assertions. |
| `app/dashboard/properties/[id]/provenness-load.ts` | Reads the record across the product, returns the channel keys a landlord may see. |
| `publish-everywhere.tsx`, `distribute-tab.tsx`, `page.tsx` | The filter, the pass-through, and the flag. |

## The defect the real rows found, which is the point of this doc

The module was written, tested to 38 green assertions, and was **wrong**.

Run against 2,476 real verification rows and 18 live posts it returned **Kijiji: proven, "Posted and checked by us."** Kijiji's three machine checks all happened inside **Growth Test**, an organization we run ourselves. The module excluded test organizations from live posts and forgot them on verifications, so our own QA work was promoted into a sales claim about a channel that has never once been machine-confirmed for a customer.

**The fixture is what hid it.** It put those three checks in a customer org, because that is where I assumed they were. The suite proved the code did what the fixture described, not what production contains. This is the twenty-first entry in the broken-proof family and the first where the fixture, rather than the gate, was the thing that could not fail.

Two fixes, both structural:

1. **One predicate, both inputs.** `isProductionOrg` is applied to live posts and to verifications, so the exclusion cannot be applied to one and forgotten on the other.
2. **The list is explicit, not guessed.** The first draft matched organization names against `%test%`. That catches "Growth Test" and misses **"North Star Rentals QA"**, which is also ours and holds four of the Vacantless page checks. `NON_PRODUCTION_ORGANIZATION_IDS` names both by id.

The fixture now places every row in the organization that really holds it, and section H tests the gate in both directions: our own rows do not promote a channel, the identical rows in a customer org do.

## What the real record says [verified 2026-09-11 via the module over PROD rows]

Same code, same rows, only the list of organizations we call ours changes:

| excluded | shown to a landlord |
|---|---|
| nothing | vacantless, rentals_ca, kijiji, zumper, facebook_feed, instagram |
| Growth Test | vacantless, rentals_ca, zumper, kijiji (assisted) |
| Growth Test and North Star QA | **vacantless, rentals_ca, zumper** |

The bottom row is the honest one.

- **Your Vacantless page**, proven, 8 machine checks in two customer organizations.
- **Rentals.ca**, proven, 4 machine checks, 3 ads live now.
- **Zumper**, assisted, 4 confirmations by a person, 6 ads live across three organizations.

Hidden: Kijiji, Facebook Marketplace, Facebook Page feed, Instagram, org feed.

## The correction to the proposal

**The proposal said four channels and counted Facebook Page feed at 2 of 2. That was Growth Test, so it was not a win.** The proposal's own rule, applied properly, removes it. Three channels, not four.

**Kijiji is the uncomfortable one.** Two paid ads are live for Agile right now and 1,032 enquiries have reached Aaliyah over two years, so the channel plainly works. What has never happened is a confirmation outside an account we run. The surface says so: "Only ever confirmed live in an account we run ourselves, which proves the mechanism and not the channel." **Do not read that as "Kijiji does not work." Read it as "we cannot yet prove we do it."**

## Two design decisions worth keeping

**The filter is display only, and sits on the publish surface rather than at the source.** `distributeChannelCards` is untouched, so posting, connecting, the proof grid and the launch run all still cover every channel. A landlord who has connected a site can still post to it. **Connecting is how a channel earns evidence in the first place**, so hiding the connect path would make an unproven channel permanently unprovable.

**The measurement is cross-organization, and therefore uses the admin client.** "Rentals.ca works" is a claim about the product, and the evidence lives in other customers' rows. An RLS-scoped read would show every new landlord an empty list on day one. The read is aggregate only: channel, result, type, date, transport, organization id. No address, no rent, no ad content. **It degrades closed**: no service key or a failed read returns null and the surface renders unfiltered, so a missing environment variable can never silently empty a landlord's screen.

## Why it is dark

Turning the flag on removes Facebook rows from a landlord-facing surface, and the Meta App Review verdict is outstanding until 2026-09-22. The freeze is honoured exactly: `distribute-tab.tsx` gained three lines of pass-through near line 300 and the Connect and Disconnect block **diffs identical against HEAD**.

## Verification

- `tsc --noEmit` clean. `eslint` clean on all six files.
- `test-channel-provenness` **57/57**.
- Full suite **243 scripts, 3 failures**: `test-listing-state`, `test-rental-readiness`, `test-reports`, the same three that fail at HEAD.
- Plain-language gate **248/248, 0 failed**. Offenders 679, baseline 679, new or worse 0.
- No em dashes in any new file.
- The freeze check in the commit script was **proved able to fail**: it aborts when a control inside the block is renamed, and aborts rather than passing silently when its anchor comment is deleted.

**A verification mistake worth recording.** I first reported the gate's one failure as pre-existing, having "checked at HEAD" with `git stash`. **`git stash` does not stash untracked files**, so the new loader was still on disk during that check and the failure was mine: the gate had flagged it as an ungated file with landlord copy. It is now registered in `OUT_OF_SCOPE` with its reason (a server loader whose only strings are SQL column names), and the gate passes clean. Checking "does this fail at HEAD too" requires moving untracked files aside as well, not `git stash` alone.

## Follow-ups, ranked

1. **Turn the flag on after the Meta verdict**, and decide then whether Instagram and the Page feed have earned a customer confirmation.
2. **Get Kijiji one machine confirmation in a customer organization.** That single row moves it from hidden to proven and is the cheapest reputation gain on the list.
3. **The internal evidence view**, showing every channel with its record and verdict, so nothing is lost and a future session can see why something is hidden. The library already returns it; only the page is missing.
4. **`submitted` still counts as a win elsewhere.** This module never counts it. Other surfaces have not been swept.
5. **Freshness is 90 days and not yet ruled on.** A channel that has placed nothing in a quarter drops off by itself.
