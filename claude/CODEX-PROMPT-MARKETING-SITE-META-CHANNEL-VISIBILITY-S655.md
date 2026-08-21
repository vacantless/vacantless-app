# CODEX PROMPT - name Facebook Page + Instagram on the public marketing site (S655, 2026-08-14)

## WHY THIS EXISTS (read before touching anything)

Meta Access Verification for the Vacantless business portfolio was submitted 2026-08-14 and is **In review**. The service URL given to Meta is `https://www.vacantless.com`, and the submission describes publishing rental listings to a customer's own Facebook Page and linked Instagram Business account.

**The marketing site currently does not mention Facebook, Instagram, or Meta anywhere** [verified 2026-08-14 via WebFetch]. Meta's form asked for "a complete website showing the service you described." `/privacy` on the same domain does describe it in full, which is a partial save, but a reviewer landing on the homepage sees nothing about social publishing. This is the single most likely reason for the verification to bounce.

This is a **copy-only** change to close that gap. It is not a redesign and not a funnel experiment.

## SCOPE - exactly two edits, one file

**File:** `app/page.tsx` (repo `vacantless-app`, branch off `main` @ `ede4486`)

### EDIT 1 - `PRODUCT_GROUPS`, group `n: "1"` ("Advertise the rental")

Current items:
```
"A branded rental page for each unit",
"Listing copy to post with",
"A listing hub that prepares your listing for more rental sites",
```

This group already makes a distribution claim without naming a single channel. Add one item naming the Meta channels. Suggested:
```
"Post straight to your own Facebook Page, and to Instagram once connected",
```
Keep the existing three items unchanged. Do not reorder them.

### EDIT 2 - `LeasingProof` section head body (around line 375)

Current:
```
Renters find your page, book their own viewing time, and land in one
list. Here is how that plays out across our own rentals.
```

Add a clause naming where the listing goes. Suggested:
```
You publish the listing to your own Facebook Page and Instagram, renters
find your page, book their own viewing time, and land in one list. Here is
how that plays out across our own rentals.
```

Keep the sentence in the existing voice (plain, second person, no marketing hype). Do not change `SectionHead title`.

## THE ONE JUDGMENT CALL - flag to Noam, do not decide silently

**Facebook Page posting is LIVE in the app. Instagram is BUILT BUT DARK** (`IG_CHANNEL_ENABLED` is unset and must stay unset until Meta approves `instagram_content_publish`).

So wording that presents Instagram as available *today* would be an overclaim, and Meta may well check it. The suggested copy above handles this with **"and to Instagram once connected"** / listing both under a publish action, which mirrors the conditional framing already used and accepted on `/privacy` ("If you connect a Facebook Business Page and its linked Instagram Business account...").

If Noam prefers, the safe alternative is to name Facebook Page only in EDIT 1 and leave Instagram to `/privacy`. That still removes the zero-mention problem. **Do not** write "coming soon" or "beta" copy; it reads as vapour to a reviewer and weakens the submission.

## HARD NO-GO LIST

- Do NOT touch the hero, `Pricing`, `RentSection`, `FounderBand`, `ClosingCta`, or `SiteHeader`/`SiteFooter`.
- Do NOT restructure sections, change layout, classes, or the `LEASING_STATS` numbers.
- Do NOT change `export const metadata` title or description.
- Do NOT flip `IG_CHANNEL_ENABLED` or any other env var. This change is copy only, no flag, no migration.
- Do NOT claim guaranteed results, customer-wide outcomes, or anything the app cannot do today. The existing page is carefully honest (see the comment block above `LeasingProof` about never making customer-wide or guaranteed claims); keep it that way.
- Do NOT add logos or Meta brand marks. Plain text names only, which avoids Meta brand-permission questions entirely.

## ACCEPTANCE CRITERIA

1. `app/page.tsx` is the only changed file.
2. `npx tsc --noEmit` clean; lint clean; `next build` succeeds.
3. Rendered homepage contains the literal strings `Facebook` and `Instagram` at least once each, in the two sections named above.
4. No layout shift: the "Advertise the rental" card gains one list item and nothing else moves.
5. No new env var, no migration, no flag.
6. `git diff --stat` shows a single file with a small line count (expect under 10 changed lines).

## AFTER MERGE

Redeploy prod and confirm `https://www.vacantless.com` serves the new copy, then re-check `https://developers.facebook.com/1740040597244950/access-verification/` for status. Status check is already scheduled (`trig_01NkARdwoKjFD7evxNXCdUrc`, 2026-08-20 14:00 UTC).

If Meta has already **rejected** the verification by the time this lands, do not resubmit blind: read Meta's stated reason first, since it may be something other than the website.

## CONTEXT DOCS
- `claude/FINDINGS-META-ACCESS-VERIFICATION-BLOCKER-S655.md` - the audit, what was submitted, and the full open-risk note.
- `claude/META-APP-REVIEW-PACKAGE-VACANTLESS-S628.md` - paste-ready App Review material, sections 1 to 4 still current.
