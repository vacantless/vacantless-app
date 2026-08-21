# CODEX PROMPT: restore per-channel lead attribution (S654)

Repo: vacantless-app (branch off prod main, currently 090efe4 / merge 8c8a21b)
Migration: one CREATE OR REPLACE of an existing RPC (Slice A). No schema change, no destructive DDL.
Flags: LEAD_ATTRIBUTION_REFERRER_ENABLED (Slice A), LEAD_ATTRIBUTION_TRACKED_COPY_ENABLED (Slice B). Both ship dark.
House style: no em dashes.

---

## THE PROBLEM (verified 2026-08-14 via Supabase + the live repo)

Agile's lead flow is healthy and completely unattributed.

- 61 leads in the last 30 days (34 on 833 Pillette Unit 22, 27 on Unit 20), 47 showings, most recent today.
- Every one of those 61 rows is `source='website'`, `source_detail=NULL`, `listing_post_id=NULL`.
- Platform-wide, 8 of 144 leads have ever carried a `listing_post_id`.
- Attribution demonstrably WORKS when a tracked link is actually in circulation: Agile's Facebook Marketplace post carried a `?p=` link from 2026-07-01 to 2026-07-15 and produced 7 correctly attributed leads (`source='Facebook Marketplace'`, `source_detail` = the FB item URL). It went to zero the moment that link stopped circulating.

So the machinery is not broken. The tracked link simply is not reaching most channels.

## ROOT CAUSE

`submit_public_lead` defaults `v_source := 'website'` and only overrides it when a valid `p_listing_post_id` arrives. That id can only arrive if the renter clicked a `?p=<listing_post_id>` link.

Three paths already emit the tracked link correctly:
- `app/dashboard/properties/distribution-actions.ts:1005` and `:1349` (`publicUrl: trackedUrl`)
- `app/api/extension/kit/route.ts` via `lib/extension-kit.ts:124` (`publicUrl: trackedLink`)

Two paths emit the BARE url, and they are the paths an operator actually copies and pastes:
- `app/dashboard/properties/[id]/page.tsx:1034` -> `buildAllListingCopy({ ..., publicUrl: linkIsLive ? publicUrl : null })` (the per-portal ad copy body; the CTA link is appended in `lib/listing-copy.ts:379`)
- `app/dashboard/properties/[id]/page.tsx:1183` -> `buildAllFillSheets({ ..., publicUrl: linkIsLive ? publicUrl : null })` (the per-portal fill sheet)

Both builders are already per-portal (`buildAllListingCopy` maps over `COPY_PORTAL_KEYS`), but they are handed one property-level url, so they cannot attribute. Every time the operator re-posts from the copy card, the tracked link falls out of circulation permanently. That is exactly what happened on 2026-07-15.

## WHY TWO SLICES

Slice B only pays off on the NEXT post. Agile's ads are live and circulating right now, so Slice A is what starts producing data tomorrow without re-posting anything. Slice A also covers the channels where the renter TYPES the link rather than clicking it (Facebook Marketplace breaks tappable links, which is why `lib/listing-copy.ts` has `linkOnOwnLine`), where appending a 36 character uuid would be actively hostile.

Ship A first. B can follow in the same PR or the next one.

---

## SLICE A: referrer and UTM fallback attribution
Flag: `LEAD_ATTRIBUTION_REFERRER_ENABLED=1`

Goal: when a lead arrives with no `?p=`, still record where it came from, using signals the browser gives us for free.

1. **Client signal.** In `app/r/[propertyId]/inquiry-form.tsx`, alongside the existing hidden inputs (line 276 onward), add a hidden input `name="ref_host"` whose value is set in a `useEffect` from `document.referrer` (host only, lowercased, no path, no query). Empty string when there is no referrer. Do the same in the second form at `app/r/[propertyId]/page.tsx:556` / `:631` if it also submits leads.

2. **Server signal.** In `app/r/[propertyId]/page.tsx`, widen `searchParams` to accept `utm_source` and thread it through the same way `src` is threaded (`listingHrefParams`, and a hidden `utm_source` input). Preserve it in `withTracking` in `app/r/[propertyId]/actions.ts:50` so it survives the error and submitted redirects.

3. **Action.** In `submitLead` (`app/r/[propertyId]/actions.ts:602`), read `ref_host` and `utm_source`, normalize defensively (strip protocol, strip `www.`, lowercase, max 120 chars, reject anything with whitespace or a slash), and pass as `p_referrer_host` and `p_utm_source`. Do the same in the second submit action at line ~798.

4. **RPC.** `CREATE OR REPLACE FUNCTION public.submit_public_lead(...)` adding two params with `DEFAULT NULL` at the END of the signature so every existing caller keeps working: `p_referrer_host text DEFAULT NULL`, `p_utm_source text DEFAULT NULL`. Logic, applied ONLY when `p_listing_post_id` did not resolve to a valid post for this property (the `?p=` path always wins):
   - `utm_source` present -> `v_source_det := 'utm:' || p_utm_source`, and if it maps to a known portal, set `v_source` to that portal's label.
   - else `referrer_host` present -> `v_source_det := 'ref:' || p_referrer_host`, and map the host to a source label:
     - `facebook.com`, `m.facebook.com`, `l.facebook.com`, `lm.facebook.com` -> `Facebook Marketplace`
     - `kijiji.ca`, `www.kijiji.ca` -> `Kijiji`
     - `zumper.com` -> `Zumper`
     - `rentals.ca` -> `Rentals.ca`
     - `viewit.ca` -> `Viewit`
     - `rentfaster.ca` -> `RentFaster`
     - `instagram.com` -> `Instagram`
     - `google.`, `bing.`, `duckduckgo.` prefix -> `Search`
     - anything else -> leave `v_source = 'website'` but KEEP the `ref:` detail so the raw host is still recoverable
   - no signal at all -> unchanged, `'website'` with null detail (a true direct visit).
   - Behind the flag: gate in the ACTION layer (do not send the params when the flag is off), so the RPC stays additive and safe.

   Use the exact label strings that `sourceLabelForPost` in `lib/listing-distribution.ts` produces, so the two layers agree and the existing per-source rollups do not fragment.

5. **Do NOT** add a "how did you hear about us" question to the form. That is a friction add and it contradicts the S638 flow-friction cuts and the S636 curtain principle. Flagged for Noam as a separate decision, not part of this build.

## SLICE B: per-portal tracked link in the copy card and fill sheets
Flag: `LEAD_ATTRIBUTION_TRACKED_COPY_ENABLED=1`

1. Extend `ListingCopyInput` (`lib/listing-copy.ts`) and the fill sheet input with an OPTIONAL `trackedUrlByPortal?: Partial<Record<PortalKey, string>>`. In `buildListingCopy(input, portal)`, resolve the CTA url as `input.trackedUrlByPortal?.[portal] ?? input.publicUrl`. Same in the fill sheet builder. Absent map means today's exact behaviour.

2. At `app/dashboard/properties/[id]/page.tsx:1034` and `:1183`, build that map from the already-loaded `postRows`:
   ```
   const trackedUrlByPortal = linkIsLive
     ? Object.fromEntries(
         COPY_PORTAL_KEYS.flatMap((portal) => {
           const id = reservableTrackerId(postRows, portal);
           return id ? [[portal, buildTrackedLink(publicUrl, id)]] : [];
         }),
       )
     : {};
   ```
   `reservableTrackerId` (`lib/listing-distribution.ts`) already exists and is already used this way in `app/dashboard/properties/actions.ts:2110` and `app/api/extension/kit/route.ts:153`. Reuse it, do not write a second selector.

3. **Exclude `facebook`** from the map for now. Marketplace forces the renter to read and retype the link, and a uuid makes that unusable. Facebook is covered by Slice A's referrer path. Leave a comment saying so, and see the follow-on below.

4. A portal with no existing tracker row falls back to the bare url. Do NOT create listing_posts rows inside a server component render.

## FOLLOW-ON (spec only, do NOT build in this PR)
Short tracked codes (`/r/<propertyId>?p=<8 char code>` or `/l/<code>`) so the typed-link channels including Facebook can carry exact attribution. Needs a code column plus a lookup and a migration. Decide after Slice A shows how much the referrer path already recovers.

---

## ACCEPTANCE CRITERIA

Gate green: `tsc` 0, lint clean, build passes, existing suites green including `scripts/test-listing-seo.ts`, `scripts/test-listing-distribution.ts`, and any `submit_public_lead` test.

New tests:
- `leadSourceHintFromParam` behaviour unchanged (it stays the narrow `network` hint; do not widen it).
- Host normalizer: `https://www.Facebook.com/marketplace/item/1` -> `facebook.com`; rejects whitespace, slashes, and over-length input.
- Host to label mapping table, including the unknown-host case keeping `source='website'` with a populated `source_detail`.
- `buildListingCopy` uses `trackedUrlByPortal[portal]` when present, falls back to `publicUrl` when absent, and never emits a tracked link for `facebook`.

Live verification, in this order, on Agile org `921f7c08-98af-428f-a238-36f4a781b0de`:
1. With the flag OFF, submit a test lead. Expect the current behaviour exactly: `source='website'`, both details null.
2. Flag ON, load `/r/<propertyId>?utm_source=kijiji`, submit. Expect `source='Kijiji'`, `source_detail='utm:kijiji'`.
3. Flag ON, no utm, arrive with a facebook.com referrer, submit. Expect `source='Facebook Marketplace'`, `source_detail='ref:facebook.com'`.
4. Flag ON, direct visit, no referrer, submit. Expect `source='website'`, both details null. This case must not regress.
5. A real `?p=<listing_post_id>` link still wins over both signals.

Then the standing check, which is the whole point of this build:
```sql
select source, coalesce(source_detail,'(none)') as detail, count(*)
from leads
where organization_id='921f7c08-98af-428f-a238-36f4a781b0de'
  and created_at > now() - interval '7 days'
group by 1,2 order by 3 desc;
```
Success at 7 days post-flip is: materially fewer than 100 percent of new Agile leads sitting in unattributed `website` with a null detail.

## WHAT THIS UNBLOCKS
- `claude/OPEN-ITEM-SYNDICATION-CHANNEL-REORDER-S642.md`, which has been parked since S642 waiting on a per-channel importance ranking that nobody could produce because the data did not exist.
- The Slice 4 paid autofire decision (Viewit $54.95, RentFaster $116.96). Neither channel has ever produced an attributed lead. Do not automate that spend until this measurement layer has run long enough to show whether those channels pay back.
