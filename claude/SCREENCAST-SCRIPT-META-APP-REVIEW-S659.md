> **[S675 2026-09-02 - THE TAKE IS SHOT. Read this before anything below.]**
> **`vacantless-meta-app-review-2026-09-02.mp4` exists**, 2:35, 21 captioned steps, in the project
> folder root. Addendum with real timestamps: `claude/META-RESUBMISSION-ADDENDUM-S675.md`.
> **COWORK BUILT IT** - the Aug 16 file was never a screen recording either, it is an ffmpeg
> slideshow (SKILL N+65), proven by its own `Lavf60`/`libx264` encoder tags. Delete on sight any
> note saying filming is blocked on Noam.
>
> **FOUR CORRECTIONS TO WHAT IS WRITTEN BELOW:**
>
> 1. **GATE 0 AS WRITTEN DOES NOT BITE.** "Confirm an Instagram channel row renders" passes even on a
>    non-allowlisted org - the row comes from the static `DISTRIBUTION_CHANNELS` catalog.
>    **The gate that bites: hit `/api/integrations/facebook/connect?propertyId=<id>` as the filming
>    org, wait ~2s, and read the `scope` parameter off the resulting facebook.com URL.** On
>    2026-09-02 it returned all six scopes for Growth Test. Also do NOT read "Turn off auto-post" as
>    proof the gated block rendered - that is `publish-everywhere.tsx:221`, a different control.
> 2. **THE CONNECT CONTROL IS FIVE LEVELS DEEP**, and until PROD `fa4a808` it did not render at all:
>    `PUBLISH_SIMPLE_DEFAULT_ENABLED` dropped `advancedTools` AND the toggle back to it. Path now:
>    Get online -> **Advanced performance tools ->** -> **Live ad links / Manage links** -> the
>    Facebook Page feed row -> **Posting tools** -> **Connect Facebook Page**.
> 3. **ON AN ALREADY-LIVE LISTING THE PUBLISH CTA READS "Sync updates / re-publish"**, not "Publish
>    everywhere". It calls the same `openConfirm`, and the modal's commit button is still literally
>    **Publish everywhere** beside Cancel. **And it is a NO-OP when both Meta posts are already
>    `live`** - S675 clicked it and got zero attempt rows, zero new `listing_posts`. To film a real
>    publish you need a listing that is NOT already live on those channels.
> 4. **SECTION 4'S OPEN QUESTION IS ANSWERED: Noam manages TWO Pages** - Vacantless
>    (1237906646071726) and Neely Davis + Noam Muscovitch, Royal Lepage (101850869113192). So
>    `candidates.length > 1`, the Vacantless picker DOES render, and the 10-minute `fb_oauth_pages`
>    window IS real. The OAuth **state token also expires in 10 minutes** - S675 burned one during
>    the login detour and had to re-mint it.
>
> **FACEBOOK'S RETURNING-USER SHORT CIRCUIT, and the two things that defeat it.** Signed in with the
> app already linked, Facebook shows "Continue as <name>? You've previously linked..." with
> **[Edit settings] [Continue]**. `Continue` grants silently with **no login screen and no permission
> list** - the exact August failure. **Click `Edit settings`**, which opens the Page -> Business ->
> Instagram selectors and then Meta's own permission review. **Removing the Business Integration is
> NOT needed** - keep it in reserve for a second rejection. And logging out is not enough on its own:
> Facebook offers a saved-profile one-tap Continue with no password field. The gear ->
> **"Remove profiles from this browser"** yields a real email+password form.
>
> **THE PROPERTY IS `available`, NOT `off_market`** as section 5 claims. 833 Pillette Rd Unit 3,
> Growth Test, `5a1e0c7d-9b64-4f21-8c3a-1d7e2f6b4a90`, 1 bed 1 bath 550 sqft $1,250/mo.

# Screencast script, Meta App Review resubmission (S659, rewritten S673 2026-08-31)

**STATUS 2026-08-31: REWRITTEN AFTER THE 2026-08-26 REJECTION. The Aug 16 take is dead. Do not re-cut it, re-record from scratch.**

Supersedes the S659 revision of 2026-08-16 (kept as `SCREENCAST-SCRIPT-META-APP-REVIEW-S659.md.bak-pre-s673`) and
section 3 of `claude/META-APP-REVIEW-PACKAGE-VACANTLESS-S628.md`, which scripts a "Review & post" button that does not exist.

---

## 1. What Meta actually said

Read live from the App Review feedback page on 2026-08-31 (submission `1580903356951595`, app `1570549797986951`).
Request placed **2026-08-16 20:00 EDT**, decided **2026-08-26**. `public_profile` approved.
Six rejected: `instagram_content_publish`, `instagram_basic`, `pages_manage_posts`, `pages_show_list`,
`business_management`, `pages_read_engagement`.

All six carry the **identical** rejection, headed **"Screencast Not Aligned with Use Case Details"**,
Developer Policy 1.6, verbatim:

> We have determined that your apps' use case is allowed, however, the submitted screencast fails to demonstrate the
> end-to-end experience of the use case described in the submission notes, hence the requested permission/feature is
> rejected.
>
> Please resolve this issue by sharing a new screencast that contains the end-to-end experience of the use case when
> you re-submit for App Review, including:
> - The complete Meta login flow;
> - A user granting app access to the permission/feature;
> - The end-to-end experience of the use case for the requested permission/feature;
> - Follow the best practices shared in the Screen Recording Guide, including: use English as the app UI language,
>   provide captions and tool-tips, and explain the meaning of buttons and other UI elements; and
> - If your app is a server-to-server app OR your app is using system user token to access Meta API, please indicate
>   it in your next submission so that we're aware that frontend Meta login authentication flow is not visible.

**The product is not the problem and the submission notes are not the problem.** The six per-permission
justifications on the submission are good and were read; keep them. Only the recording is being rejected.

## 2. Why the Aug 16 take failed, from the tape

`vacantless-meta-app-review.mp4`, 81.04s, 1530x968, 25fps, **no audio stream at all**, 20 burned-in captions.
Frames sampled every 4s into `S673-screencast-contact-sheet.jpg` in the project folder. What it contains:

- It **opens at step 1 of 20 already signed in to Vacantless**, on the Get online tab of 833 Pillette Rd Unit 3.
- Caption 2 reads "The Facebook Page is authorized. Instagram is connected but NOT authorized." The connection is
  presented as a **state that already exists**.
- There is **no Vacantless login, no Facebook login, and no Meta consent screen anywhere in the 81 seconds.**
  No Page picker. No permission grant dialog. Nothing on a `facebook.com` OAuth surface.
- The only thing called "authorize" in the recording is **Vacantless's own green "Authorize auto-post" button**,
  which is an internal toggle, not a Meta grant.
- Steps 8 to 11 do show the confirm modal naming every destination, and steps 15 to 20 do show the real live post on
  `@getvacantless` and on the Vacantless Page. That part is fine and is worth re-shooting the same way.

So the take missed **bullet 1 and bullet 2**, not just bullet 1. From the reviewer's seat, six Meta permissions were
requested and the video contained **zero Meta authorization surface**. That is why all six died with one boilerplate
and `public_profile`, which needs no demonstration, lived.

The cause is traceable to two lines in the old script: "Do not film a login", and the Take A / Take B choice that
made the OAuth Page picker optional. Both are deleted below.

## 3. The decision: re-record with the full Meta auth flow. The token declaration is NOT available.

Meta's fifth bullet is an escape hatch for apps whose Meta authentication happens off-screen. **It does not apply
here and claiming it would be a false statement to Meta.** Vacantless is not a server-to-server app and does not use
a system user token. It uses Facebook Login for Business: `GET /api/integrations/facebook/connect` sends the operator
to Meta's own OAuth dialog in their browser and `app/api/integrations/facebook/callback/route.ts` exchanges the code
for a user access token, then a long-lived Page token. There is a frontend Meta login flow. It was simply not filmed.

**So the only honest path is to film it.** This is not a judgement call between two options; reading the actual
feedback removed the second option.

The one genuinely optional thing is a note in the submission covering where each bullet appears in the new video.
Add it (section 7), but it supplements the recording, it does not substitute for it.

## 4. Why one Connect click covers all six permissions

From `lib/facebook-page-oauth.ts` at PROD `82776e6`:

```
FACEBOOK_PAGE_BASE_SCOPES = [pages_show_list, pages_read_engagement, pages_manage_posts, business_management]
INSTAGRAM_GRAPH_SCOPES    = [instagram_basic, instagram_content_publish]
facebookPageScopes()      = BASE + INSTAGRAM when Instagram is enabled for the org
```

One `Connect Facebook Page` click, with Instagram enabled for the org, puts **all six rejected scopes on a single
Meta consent screen**. There is no need to split the recording, and the old Take A / Take B fork is obsolete.

`disconnectFacebookPage` is bound to the Disconnect control on **both** the Facebook and the Instagram rows and
clears the authorization too, so **one disconnect resets everything and one reconnect restores everything.**

**About the "10 minute window" the old script warned about.** It is `exp: Date.now() + 10 * 60 * 1000` on the
`fb_oauth_pages` cookie in `callback/route.ts:263`, and it only ever exists **if the Vacantless Page picker renders
at all**. It renders only when the account manages more than one Page: at `callback/route.ts:242`,
`candidates.length === 1` finalizes the connection immediately and redirects straight back as `connected`. So:

- **More than one Page on the account:** Meta's consent screen, then Vacantless's own picker, and you have 10 minutes
  to choose. Do not deliberate inside it.
- **Exactly one Page:** no Vacantless picker, no cookie, no window. `pages_show_list` is then justified entirely by
  **Meta's own Page selector on the consent screen**, which is what Meta's bullet 2 is asking to see anyway.

Check which case you are in during pre-flight so the shot list does not surprise you on camera.

## 5. Pre-flight, all gates must pass before you hit record

0. **Instagram must be live for the recording org.** Open the Get online tab on the test property and confirm an
   **Instagram** channel row is rendered. If it is absent, `IG_CHANNEL_ENABLED` or `IG_CHANNEL_ORG_ALLOWLIST` did not
   survive a rebuild (Vercel env bakes at build time), the consent screen will carry only four scopes, and the two
   Instagram permissions will be rejected again. **Stop and fix the env before recording.** Do not widen the
   allowlist to any org other than the one you are filming.
1. **Org: Growth Test `8ea1da48`.** Not Agile. Agile is a live org with real renters.
2. **Property: 833 Pillette Rd Unit 3, Windsor ON, `5a1e0c7d-9b64-4f21-8c3a-1d7e2f6b4a90`,** 18 photos.
   `publishProperty` accepts `off_market` directly (`actions.ts:1104`, `:1133-1137`), so Set Live works from where it sits.
3. **Count the Pages the filming Facebook account manages** and decide which case in section 4 you are in.
4. **Sign out of Vacantless, and sign out of Facebook, before recording.** The old take's whole defect was starting
   from a signed-in state. Use a fresh browser profile if that is easier than signing out of Facebook.
5. **English UI, captions on, no other language anywhere in frame.** Meta names this explicitly.
6. **Record audio this time, or caption every single step.** The Aug 16 file has no audio track, so the spoken lines
   the old script wrote were never heard. Narration is the cheapest way to satisfy "explain the meaning of buttons
   and other UI elements". If you would rather stay silent, every spoken line below has to become an on-screen
   caption instead.
7. **Accept that this publishes a real post.** A second live listing post lands on `@getvacantless` and the
   Vacantless Page. That is Vacantless's own account, so it is fine, but it is a real side effect. Noam's call.
8. **Close anything with renter or tenant data in it.** Nothing personal may appear in frame.

## 6. The shot list

Filmed in one continuous take. Meta wants to see the sequence unbroken, so do not cut inside it.

**Shot 1. Cold start, signed out.** Land on `app.vacantless.com`. Show the sign-in screen and sign in to Vacantless.

> "This is Vacantless, rental listing software for landlords and property managers. I'm signing in as the operator
> who owns this rental."

**Shot 2. The listing.** Open 833 Pillette Rd Unit 3 and hold on the address, beds, baths and monthly rent.

> "This is the rental I'm going to publish. The reviewer should remember this address, these bedroom and bathroom
> counts and this rent, because they will appear again in the finished post."

**Shot 3. Disconnected state.** Open the Get online tab, expand the Facebook Page row and the Instagram row.
Both must read as not connected, showing the **Connect Facebook Page** control.

> "Nothing is connected yet. Vacantless has no access to any Facebook Page or Instagram account at this point."

**Shot 4. The complete Meta login flow. This is bullet 1 and it is the shot the last take was missing.**
Click **Connect Facebook Page**. You land on Facebook. **Film the actual Facebook login**: the email and password
screen, and any two-factor step. Do not skip it and do not cut it.

> "Connecting sends me to Facebook's own login. Vacantless never sees my Facebook password. This happens entirely on
> Facebook."

**Shot 5. The permission grant. This is bullet 2 and it is the other shot the last take was missing.**
Stay on Meta's consent screen. **Pause on the Page selector** so the reviewer sees the operator choosing which of
their own Pages to connect. Then **pause again on the permissions list** and read the scopes out loud as they appear.
Do not rush this screen. It is the entire justification for four of the six permissions.

> "Facebook is asking which of my own Pages to connect. Choosing from my own Pages is what pages_show_list is for.
> Reading the Instagram Business account linked to that Page is what business_management and instagram_basic are for.
> I'm granting Vacantless permission to list my Pages, read the connected Page's name and health, publish a post to
> that Page, and publish one image to the linked Instagram Business account. Nothing else."

**Shot 6. Back in Vacantless.** If the Vacantless Page picker renders, choose the Page on camera and say why.
If it does not render because there is only one Page, say so out loud so the reviewer is not confused by the jump.
Land back on the Get online tab and hold on the **Connected: [Page name]** and **Connected: [IG username] via
[Page name]** labels.

> "Vacantless now shows which Page and which Instagram account are connected, by name. Reading that Page name back
> to confirm the connection is healthy is what pages_read_engagement is for."

**Shot 7. The most important frame in the recording. Connection is not authorization.**
Hold on the channel rows while both are connected but not yet authorized.

> "Connecting the account does not authorize any posting. Vacantless will not publish anything to this Page or this
> Instagram account until I take a second, separate action."

**Shot 8. Authorize.** Click **Authorize auto-post** on the Facebook Page row, then on the Instagram row.

> "This is that second action. Vacantless records this authorization against my user ID with a timestamp. It applies
> to this one channel, and I can revoke it at any time."

**Shot 9. Revocability.** Hold on **Turn off auto-post** without clicking it.

> "Revoking here stops all further posting immediately."

**Shot 10. Still nothing posted.**

> "Authorization alone posts nothing. Publishing this listing takes a further, deliberate action."

**Shot 11. Publish and confirm.** Click **Publish everywhere**. A confirm modal opens. Hold on it long enough to
read every destination it names, with Instagram and the Facebook Page both visible. Then click the modal's own
**Publish everywhere** button to commit.

> Label check, and get this right because the last submission's reviewer instructions had to be corrected for it:
> the `ConfirmModal` confirm button is labelled **Publish everywhere**, the same words as the CTA that opened it
> (`publish-everywhere.tsx:588` opens the modal, `:1311` commits inside it, beside a Cancel).
> **"Approve & publish" is a different control** on the per-channel approval rail (`ApprovalModal`,
> `publish-everywhere.tsx:1118`), and **"Approve & publish" is also the Set Live path's confirm**
> (`confirm-publish-button.tsx:159`). Do not narrate the words "Approve and publish" over the Publish-everywhere
> modal; say "confirm" and let the caption name the button as it actually reads.

> "The confirmation names every destination this post will reach. Nothing is sent until I confirm it. Publishing one
> listing creates one post per authorized channel. There is no scheduled posting and no bulk posting."

**Shot 12. The Instagram result. This is `instagram_content_publish` and it is the scope with the most to prove.**
Go to `instagram.com/getvacantless`, open the new post, and hold on the caption. The reviewer must be able to match
the address, beds, baths, rent and the tracked link against shot 2.

> "One post on the operator's own Instagram Business account: the listing's cover photo, with a caption carrying the
> property address, bedrooms, bathrooms, monthly rent and a tracked link back to the public listing page."

**Shot 13. The Facebook result. This is `pages_manage_posts`.** Go to the Vacantless Page and hold on the same post.

> "The same listing on the operator's own Facebook Page."

**Shot 14. Close.**

> "Every post is the direct result of an operator connecting their own account, separately authorizing that channel,
> and then publishing a specific listing and approving a confirmation that names every destination. No scheduled
> posting, no bulk posting, and no tenant or renter personal information is ever sent to Meta."

## 7. Length, format, and the submission note

- **Three to five minutes.** The Aug 16 take was 81 seconds and it was too thin to carry six permissions. Do not
  optimise for brevity here. Meta rejected it for missing content, not for length.
- **Do not speed up, and do not cut**, anywhere between shot 4 and shot 11. The reviewer needs to see that the login,
  the grant, the authorization and the publish are one continuous unedited sequence.
- **Audio or captions on every step**, per pre-flight gate 6.
- **English only.**
- Attach the same recording to all six permissions.

Add this to the submission notes, and change nothing else in them:

> This resubmission replaces the screencast only. No product or permission usage has changed. The new recording is a
> single unedited take and contains: the complete Meta login flow, filmed from a signed-out browser (from 0:xx); the
> Meta consent screen with the Page selector and the full permission grant (from 0:xx); and the end-to-end use case
> through to the live post on both the operator's Facebook Page and their linked Instagram Business account (from
> 0:xx). Vacantless is not a server-to-server app and does not use a system user token; it uses Facebook Login for
> Business, and the frontend authentication flow is visible in the recording.

Fill in the real timestamps once the file exists.

## 8. After filming

1. Watch it back start to finish and tick off Meta's three content bullets literally, one at a time.
   If you cannot point at a timestamp for each, it is not ready.
2. Confirm the file has an audio track if you narrated, and that captions are legible at Meta's player size.
3. Confirm no renter or tenant data appears in any frame.
4. Replace the video on all six permissions and paste the section 7 note.
5. Resubmit, and **write the resubmission date into `00-NEXT-SESSION.md` with the expected decision window**.
   The last two weekly Meta checks died silently and the second lapse cost about fourteen hours on a live rejection.
   Do not arm a third weekly check without confirming it actually fires.

## 9. Do not

- Do not film from a signed-in state. That is the whole reason this is being redone.
- Do not declare a system user token or a server-to-server architecture. It is not true.
- Do not rename "Authorize auto-post" or "Turn off auto-post". Those labels are already in the App Review material.
- Do not settle the "Publish everywhere" versus "Approve & publish" versus "Review & post" naming inconsistency
  mid-review. It is real and it is tracked in `FINDINGS-APP-REVIEW-FLOW-MISMATCH-S659.md`, but renaming a control
  between a rejection and a resubmission invites a mismatch with the notes.
- Do not film in the Agile org.
- Do not widen `IG_CHANNEL_ORG_ALLOWLIST` beyond the org you are filming.
