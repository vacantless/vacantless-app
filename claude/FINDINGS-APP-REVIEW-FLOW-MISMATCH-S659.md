# Two of three publish paths posted to Meta with no confirm (S659, 2026-08-16)

**STATUS: RESOLVED AND LIVE.** Fixed by `b64eb36` (the gate) and `3084501` (the copy), both
deployed and proven on production. Nothing was ever published. **This doc is now the record of the
finding plus the paste-ready submission text - it is no longer a blocker.**

> **Revision note 1.** An earlier version claimed there was *no* confirmation step anywhere. That
> was wrong: it was derived from server-action call sites without checking the client component
> wrapping them. Corrected after driving the live product -> KI1083, standing rule 76.
>
> **Revision note 2 (post-fix).** The replacement text below has been updated for the SHIPPED UI.
> Before the fix it described the confirm as reached only via "Publish everywhere"; both publish
> paths now confirm, so the wording no longer singles one out.

---

## What was wrong

`publishProperty` fires `publishAuthorizedInstantChannelsAfterPageLive` (`actions.ts:1168`), which
posts to the operator's Instagram and Facebook Page for every channel with
`account_status='connected'` and `automation_authorized=true`. **Three** form actions were bound to
it and only one confirmed first:

| # | Location | Control | Confirm (before) | Confirm (now) |
|---|---|---|---|---|
| 1 | `publish-everywhere.tsx:1165` | "Publish everywhere" (Get online) | yes, preflight modal | yes, unchanged |
| 2 | `page.tsx:2499` | **"Set Live"**, page header | **NO**, bare form | **yes** |
| 3 | `distribute-tab.tsx:1410` | "Publish everywhere" non-modal variant | **NO**, bare form | **yes** |

`publish-everywhere.tsx:27-32` declares its own invariant, *"nothing posts before the confirm modal
(KI999) ... (Meta App Review commitment)"*. Paths 2 and 3 broke it.

**Why it mattered.** S658's proof run used **Set Live**, so the flow this project recorded as "the
real customer flow" was the ungated one. And `app/privacy/page.tsx:89-92` publicly promises:

> "A post is created only after you review the prepared listing and approve it."

On path 2 that sentence was false. Filming a screencast of the gated path while an ungated path
existed unmentioned would have been worse than not filming at all.

## What shipped

- **`b64eb36`** (S659 `51034c3`) - new `confirm-publish-button.tsx`; paths 2 and 3 rewired through
  it; shared predicate `authorizedInstantPublishDestinations` (`lib/auto-distribution.ts:82`)
  consumed by BOTH `autoDistributionChannels` (`:128`) and the UI (`page.tsx:1400`) so the modal and
  the autofire cannot drift. Deploy READY **2026-08-16 14:11:51 UTC**.
- **`3084501`** (S659b `44b5671`) - five strings that still promised posting "automatically without
  another click" rewritten. `git grep "without another click" main -- app lib` returns nothing.
  Deploy READY **2026-08-16 15:26:21 UTC**.

**Proven live on prod without publishing:** the header Set Live control reads `button
type="button"` in the accessibility tree (was `type="submit"` inside a form), which structurally
cannot submit, so the click was provably safe. It opened **"Approve connected account posts"**
listing **Instagram / INSTANT** with **"Approve & publish"** + Cancel - and listed Instagram ONLY,
because `facebook_feed` is connected but `automation_authorized=false`. Cancelled; property still
`off_market`, 0 live posts.

---

# PASTE-READY SUBMISSION TEXT (updated for the shipped UI)

Replaces the corresponding sections of `claude/META-APP-REVIEW-PACKAGE-VACANTLESS-S628.md`, which
describe a **"Review & post"** button that has never existed.

### App description (replaces section 1)

Vacantless is rental-listing software for landlords and property managers ("operators"). An
operator connects their own Facebook Page and its linked Instagram Business account to Vacantless.
Connecting a channel does not by itself authorize any posting. To let Vacantless post to a channel,
the operator must take a separate, explicit action: clicking "Authorize auto-post" on that specific
channel. We record that authorization against the operator's user ID with a timestamp, and the
operator can revoke it at any time from the same screen, which immediately stops all further
posting. To publish an individual listing, the operator publishes that listing and is shown a
confirmation naming every destination the post will reach, including Instagram and the Facebook
Page, which they must approve. Only then does Vacantless create one post per authorized channel.
For Instagram this is the listing's cover photo with a caption carrying the property address, beds,
baths, monthly rent, and a tracked link back to the public listing page. There is no scheduled or
bulk posting, and no tenant or renter personal data is ever sent to Meta.

### `instagram_content_publish` (replaces that entry in section 2)

Vacantless uses `instagram_content_publish` solely to publish one image post per rental listing to
the operator's own linked Instagram Business account: the listing's cover photo, with a caption
containing the property address, beds, baths, monthly rent, and a tracked link as plain text.

Three explicit operator actions gate every post. First, the operator connects their own account.
Second, the operator authorizes the Instagram channel by clicking "Authorize auto-post"; we store
the authorizing user's ID and the timestamp, and connecting alone does not authorize posting.
Third, the operator publishes a specific listing and approves a confirmation that names Instagram
as a destination for that post.

Publishing one listing creates one Instagram post. The authorization is revocable at any time from
the same screen, which stops all further posting immediately. There are no Stories, Reels or
carousels, no scheduled or bulk posting, and no tenant or renter personal data is sent to Instagram.

### `pages_manage_posts` (replaces that entry in section 2)

Vacantless uses `pages_manage_posts` solely to create one feed post on the operator's own Facebook
Page: the rental listing they are publishing, carrying the address, beds, baths, monthly rent, and
a tracked link back to the public listing page. The same three-step consent model applies, and the
confirmation shown before publishing names the Facebook Page as a destination. One listing
published creates one post, the authorization is revocable at any time, and Vacantless never edits
or deletes other Page content or sends tenant or renter personal data to the Page.

### Data-handling answer (replaces the relevant line in section 4)

Posting requires explicit operator actions: a one-time, per-channel authorization that we record
with the operator's user ID and timestamp and that the operator can revoke at any time, and then
the operator publishing a specific listing and approving a confirmation that names every connected
account the post will reach. There is no scheduled or bulk posting, and no tenant or renter
personal data is sent to Meta.

---

## Still open

- **Three names for one action.** The older modal says "Publish everywhere"; the privacy policy and
  the new confirm say "Approve & publish"; S628 says "Review & post", which exists nowhere. Settle
  on one across product, policy and submission - **not mid-review**. Do NOT rename "Authorize
  auto-post" / "Turn off auto-post"; those labels are already in the App Review material.
- **Access Verification** (submitted 2026-08-14, In review) contains the stale "taps 'Review and
  post'" wording. Its substantive claims are accurate and the gate makes them true going forward.
  **Do not proactively reopen it**; correct only if Meta bounces. Check
  `trig_01NkARdwoKjFD7evxNXCdUrc`, 2026-08-20 14:00 UTC.

## Notes for whoever films

- `publishProperty` accepts `off_market` directly (`actions.ts:1126-1129`), so the S658 handoff's
  "set it to Draft first" step is unnecessary.
- **Either publish path now confirms**, so Set Live is filmable again. The script
  (`claude/SCREENCAST-SCRIPT-META-APP-REVIEW-S659.md`) still favours Publish everywhere because
  that surface shows more channels.
