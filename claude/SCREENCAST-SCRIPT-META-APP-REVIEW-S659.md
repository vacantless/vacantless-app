# Screencast script, Meta App Review (S659, rewritten S673 2026-08-31, REBUILT S695 2026-09-10)

**STATUS 2026-09-10 (S695): REBUILT AGAINST THE CURRENT BUILD (`abaec37`). The submitted 2026-09-02 tape is still under review and cannot be edited. This rebuild exists so that IF the verdict is another Policy 1.6 rejection, the re-record starts from a shot list that matches the product as it stands today. Do not re-record before the verdict. Do not treat this as evidence the submitted tape is wrong.**

Supersedes the S673 revision of 2026-08-31 (kept as `SCREENCAST-SCRIPT-META-APP-REVIEW-S659.md.bak-pre-s695`).

---

## 0. Read this first: the product moved under the submitted tape

Between filming (2026-09-01/02) and today, two sessions changed the landlord-facing syndication surface while the review was in flight. **The Meta authorization flow itself is untouched.** What moved is copy and navigation.

| Submitted tape shows | The build says today | Changed by |
|---|---|---|
| Authorize auto-post | **Allow us to post** | `64ca23f` (S694d) |
| Publish everywhere (CTA) | **Post everywhere** | `9c4d34a` (S694c) |
| Publish everywhere (modal confirm) | **Post everywhere** | `9c4d34a` |
| Approve & publish | **Approve and post** | `9c4d34a` |
| Approve prepared post (paid) | **Approve the post** | `9c4d34a` |
| Get online opens on the channel cards | Opens on the simple view; cards are behind **Advanced tools** | `abaec37` (S695) |
| Turn off auto-post | unchanged | |
| Connect Facebook Page | unchanged | |
| Connected: {Page name} | unchanged | |
| Disconnect | unchanged | |

The S673 version of this script said in section 9: "Do not rename Authorize auto-post or Turn off auto-post. Those labels are already in the App Review material." That instruction was not carried into the S694 word-contract sweep. **Section 9 below is rewritten to today's labels and the freeze is restated in stronger terms.**

**The navigation change in detail.** `distribute-tab.tsx:508` now passes `orgDefaultMode="simple"` unconditionally. Both Growth Test and Agile carry `organizations.distribution_view_mode = 'advanced'` [verified 2026-09-10 via SQL], so before `abaec37` the Get online tab in those orgs opened straight onto the channel cards. It no longer reads that column. `get-online-view.tsx` also remembers the last mode in `localStorage`, so a browser that has been in advanced mode before will still open there. **A fresh browser profile lands on the simple view.**

**The consequence for the shot list: connect and authorize now live in two different views.** Connect Facebook Page, Connected, and Disconnect are in the channel cards (advanced). Allow us to post, Turn off auto-post, and Post everywhere are on the simple Publish Everywhere surface. The take has to toggle between them, on camera, once in each direction. Shots 3, 6 and 7 below carry that.

## 1. What Meta said on 2026-08-26 (unchanged, still the standard to hit)

Submission `1580903356951595`, app `1570549797986951`. `public_profile` approved. Six rejected: `instagram_content_publish`, `instagram_basic`, `pages_manage_posts`, `pages_show_list`, `business_management`, `pages_read_engagement`. All six carry the identical rejection, headed **"Screencast Not Aligned with Use Case Details"**, Developer Policy 1.6:

> We have determined that your apps' use case is allowed, however, the submitted screencast fails to demonstrate the end-to-end experience of the use case described in the submission notes, hence the requested permission/feature is rejected.
>
> Please resolve this issue by sharing a new screencast that contains the end-to-end experience of the use case when you re-submit for App Review, including:
> - The complete Meta login flow;
> - A user granting app access to the permission/feature;
> - The end-to-end experience of the use case for the requested permission/feature;
> - Follow the best practices shared in the Screen Recording Guide, including: use English as the app UI language, provide captions and tool-tips, and explain the meaning of buttons and other UI elements; and
> - If your app is a server-to-server app OR your app is using system user token to access Meta API, please indicate it in your next submission so that we're aware that frontend Meta login authentication flow is not visible.

**The product is not the problem and the submission notes are not the problem.** Only the recording was rejected. Keep the six per-permission justifications.

## 2. Why the Aug 16 take failed (kept, because the trap is easy to fall back into)

It opened already signed in to Vacantless, presented the connection as a state that already existed, and contained no Vacantless login, no Facebook login and no Meta consent screen in 81 seconds. The only thing it called "authorize" was Vacantless's own internal toggle. Six Meta permissions were requested and the video contained zero Meta authorization surface, so all six died on one boilerplate and `public_profile`, which needs no demonstration, lived.

**Do not film from a signed-in state. That single decision is what cost the August submission.**

## 3. The token declaration is still NOT available

Meta's fifth bullet is an escape hatch for apps whose Meta authentication happens off-screen. It does not apply here and claiming it would be a false statement to Meta. Vacantless uses Facebook Login for Business: `GET /api/integrations/facebook/connect` sends the operator to Meta's own OAuth dialog and `app/api/integrations/facebook/callback/route.ts` exchanges the code for a user access token, then a long-lived Page token. There is a frontend Meta login flow. Film it.

## 4. Why one Connect click still covers all six permissions

From `lib/facebook-page-oauth.ts`:

```
FACEBOOK_PAGE_BASE_SCOPES = [pages_show_list, pages_read_engagement, pages_manage_posts, business_management]
INSTAGRAM_GRAPH_SCOPES    = [instagram_basic, instagram_content_publish]
facebookPageScopes()      = BASE + INSTAGRAM when Instagram is enabled for the org
```

One **Connect Facebook Page** click, with Instagram enabled for the org, puts all six rejected scopes on a single Meta consent screen.

`disconnectFacebookPage` is bound to the Disconnect control on **both** the Facebook and the Instagram rows (`distribute-tab.tsx:1001` and `:1034`) and clears the authorization too, so one disconnect resets everything and one reconnect restores everything. Verified still true on `abaec37`.

**The 10 minute window.** `exp: Date.now() + 10 * 60 * 1000` on the `fb_oauth_pages` cookie in `callback/route.ts:263`. It exists only if the Vacantless Page picker renders, which happens only when the account manages more than one Page (`callback/route.ts:242`: `candidates.length === 1` finalizes immediately).

- **More than one Page:** Meta's consent screen, then Vacantless's own picker, 10 minutes to choose. Do not deliberate inside it.
- **Exactly one Page:** no Vacantless picker, no cookie, no window. `pages_show_list` is then justified entirely by Meta's own Page selector on the consent screen, which is what bullet 2 asks to see anyway.

Check which case you are in during pre-flight.

## 5. Pre-flight, all gates must pass before you hit record

0. **Instagram must be live for the recording org.** The Instagram row renders only when `instagramAccount?.enabled` (`distribute-tab.tsx`, the `channel.key === "instagram"` block). **It is now behind Advanced tools**, so check it there, not on the landing view. If the row is absent, `IG_CHANNEL_ENABLED` or `IG_CHANNEL_ORG_ALLOWLIST` did not survive a rebuild (Vercel env bakes at build time), the consent screen will carry only four scopes, and the two Instagram permissions will be rejected again. **Stop and fix the env before recording.** Do not widen the allowlist to any org other than the one you are filming.
1. **Org: Growth Test `8ea1da48`.** Not Agile. Agile is a live org with real renters.
2. **Property: 833 Pillette Rd Unit 3, Windsor ON,** 18 photos. `publishProperty` accepts `off_market` directly, so Set Live works from where it sits.
3. **Count the Pages the filming Facebook account manages** and decide which case in section 4 you are in.
4. **Sign out of Vacantless, and sign out of Facebook, before recording.** Use a fresh browser profile if that is easier.
5. **NEW (S695): use a browser profile with no Vacantless `localStorage`.** `get-online-view.tsx` remembers the last view mode. A profile that has been in advanced mode opens there and the "click Advanced tools" beat in shot 3 will not happen on camera. A fresh profile lands on the simple view, which is what shot 3 assumes.
6. **English UI, captions on, no other language anywhere in frame.**
7. **Record audio, or caption every single step.** The Aug 16 file had no audio track at all, so its scripted narration was never heard.
8. **Accept that this publishes a real post** to `@getvacantless` and the Vacantless Page. Noam's call.
9. **Close anything with renter or tenant data in it.**
10. **NEW (S695): re-read section 0 and confirm every label below still matches the build you are about to film.** Two sweeps have renamed controls under this script already. Grep before you record.

## 6. The shot list, rebuilt for `abaec37`

Filmed in one continuous take. Do not cut inside it.

**Shot 1. Cold start, signed out.** Land on `app.vacantless.com`. Show the sign-in screen and sign in to Vacantless.

> "This is Vacantless, rental listing software for landlords and property managers. I'm signing in as the operator who owns this rental."

**Shot 2. The listing.** Open 833 Pillette Rd Unit 3 and hold on the address, beds, baths and monthly rent.

> "This is the rental I'm going to publish. The reviewer should remember this address, these bedroom and bathroom counts and this rent, because they will appear again in the finished post."

**Shot 3. Get online, then into the account settings. CHANGED IN S695.** Open the Get online tab. It lands on the simple view, which lists the rental sites. Hold there for a beat, then click **Advanced tools** at the bottom right. The channel cards open. Expand the Facebook Page row and the Instagram row. Both must read as not connected, showing **Connect Facebook Page**.

> "This is where the listing goes out. The account connections live one level in, under Advanced tools. Nothing is connected yet: Vacantless has no access to any Facebook Page or Instagram account at this point."

**Shot 4. The complete Meta login flow. Bullet 1, and the shot the August take was missing.** Click **Connect Facebook Page**. You land on Facebook. **Film the actual Facebook login:** the email and password screen, and any two-factor step. Do not skip it and do not cut it.

> "Connecting sends me to Facebook's own login. Vacantless never sees my Facebook password. This happens entirely on Facebook."

**Shot 5. The permission grant. Bullet 2, and the other shot the August take was missing.** Stay on Meta's consent screen. **Pause on the Page selector** so the reviewer sees the operator choosing which of their own Pages to connect. Then **pause again on the permissions list** and read the scopes out loud as they appear. Do not rush this screen. It is the entire justification for four of the six permissions.

> "Facebook is asking which of my own Pages to connect. Choosing from my own Pages is what pages_show_list is for. Reading the Instagram Business account linked to that Page is what business_management and instagram_basic are for. I'm granting Vacantless permission to list my Pages, read the connected Page's name and health, publish a post to that Page, and publish one image to the linked Instagram Business account. Nothing else."

**Shot 6. Back in Vacantless.** If the Vacantless Page picker renders, choose the Page on camera and say why. If it does not render because there is only one Page, say so out loud. You land back on the channel cards, because the view mode you chose in shot 3 is remembered. Hold on **Connected: {Page name}** and **Connected: {IG username} via {Page name}**.

> "Vacantless now shows which Page and which Instagram account are connected, by name. Reading that Page name back to confirm the connection is healthy is what pages_read_engagement is for."

**Shot 7. Connection is not authorization. The most important frame in the recording. CHANGED IN S695.** The authorization controls are on the simple view, not on the channel cards. Click **Simple view** at the top right to go back. Hold on the site rows while the accounts are connected but not yet authorized, showing the amber helper text: "Allow us to post this listing to this account. You approve every site before anything goes out."

> "I am back on the main view. Connecting the account did not authorize any posting. Vacantless will not publish anything to this Page or this Instagram account until I take a second, separate action, and that action is here."

**Shot 8. Authorize. RENAMED IN S694.** Click **Allow us to post** on the Facebook Page row, then on the Instagram row.

> "This is that second action. Vacantless records this authorization against my user ID with a timestamp. It applies to this one channel, and I can revoke it at any time."

**Shot 9. Revocability. Label unchanged.** Hold on **Turn off auto-post** and its helper, "We can post to this account. Turn that off and stay signed in." Do not click it.

> "Revoking here stops all further posting immediately, and it leaves the account connected."

**Shot 10. Still nothing posted.**

> "Authorization alone posts nothing. Publishing this listing takes a further, deliberate action."

**Shot 11. Publish and confirm. RENAMED IN S694.** Click **Post everywhere** (`publish-everywhere.tsx:647`). A confirm modal opens (`ConfirmModal`, defined at `:1213`, opened at `:824`). Hold on it long enough to read every destination it names, with Instagram and the Facebook Page both visible. Then click the modal's own **Post everywhere** button (`:1383`) to commit.

> Label check: the CTA and the modal's confirm button read the **same words**, "Post everywhere". **"Approve and post" is a different control** on the per-channel approval rail (`:1073`, `:1190`), and the paid variant of it reads **"Approve the post"** (`:1190`). Do not narrate "approve and post" over the Post-everywhere modal. Say "confirm" and let the caption name the button as it actually reads.

> "The confirmation names every destination this post will reach. Nothing is sent until I confirm it. Publishing one listing creates one post per authorized channel. There is no scheduled posting and no bulk posting."

**Shot 12. The Instagram result. `instagram_content_publish`, the scope with the most to prove.** Go to `instagram.com/getvacantless`, open the new post, and hold on the caption. The reviewer must be able to match the address, beds, baths, rent and the tracked link against shot 2.

> "One post on the operator's own Instagram Business account: the listing's cover photo, with a caption carrying the property address, bedrooms, bathrooms, monthly rent and a tracked link back to the public listing page."

**Shot 13. The Facebook result. `pages_manage_posts`.** Go to the Vacantless Page and hold on the same post.

> "The same listing on the operator's own Facebook Page."

**Shot 14. Close.**

> "Every post is the direct result of an operator connecting their own account, separately authorizing that channel, and then publishing a specific listing and approving a confirmation that names every destination. No scheduled posting, no bulk posting, and no tenant or renter personal information is ever sent to Meta."

## 7. Length, format, and the submission note

- **Three to five minutes.** The Aug 16 take was 81 seconds and too thin to carry six permissions. Meta rejected it for missing content, not for length.
- **Do not speed up, and do not cut**, anywhere between shot 4 and shot 11. The login, the grant, the authorization and the publish must read as one continuous unedited sequence. The two view toggles in shots 3 and 7 happen inside that sequence, on camera.
- **Audio or captions on every step.**
- **English only.**
- Attach the same recording to all six permissions.

Submission note, with real timestamps filled in:

> This resubmission replaces the screencast only. No product or permission usage has changed. The new recording is a single unedited take and contains: the complete Meta login flow, filmed from a signed-out browser (from 0:xx); the Meta consent screen with the Page selector and the full permission grant (from 0:xx); and the end-to-end experience of the use case through to the live post on both the operator's Facebook Page and their linked Instagram Business account (from 0:xx). Vacantless is not a server-to-server app and does not use a system user token; it uses Facebook Login for Business, and the frontend authentication flow is visible in the recording.

## 8. After filming

1. Watch it back start to finish and tick off Meta's three content bullets literally, one at a time. If you cannot point at a timestamp for each, it is not ready.
2. Confirm the file has an audio track if you narrated, and that captions are legible at Meta's player size.
3. Confirm no renter or tenant data appears in any frame.
4. Replace the video on all six permissions and paste the section 7 note.
5. Resubmit, and write the resubmission date into `00-NEXT-SESSION.md` with the expected decision window. Two weekly Meta checks have died silently before; the second lapse cost about fourteen hours on a live rejection, and the 2026-09-10 daily check missed because Chrome was closed. **Confirm the check actually fires.**

## 9. Do not

- **Do not rename any control named in this script while a submission is open.** This is the instruction that failed. The S673 version named two labels and the S694 word-contract sweep renamed them anyway, eight days into a twenty day review. The protected set today is: **Connect Facebook Page**, **Connected:**, **Disconnect**, **Allow us to post**, **Turn off auto-post**, **Post everywhere**, **Approve and post**, **Approve the post**. If the plain-language gate wants one of these words, the gate waits for the verdict.
- **Do not change which view the Get online tab lands on**, or move the connect controls between the simple and advanced views, while a submission is open. That is shot 3 and shot 7.
- Do not film from a signed-in state, or from a browser profile that already has a saved view mode.
- Do not declare a system user token or a server-to-server architecture. It is not true.
- Do not film in the Agile org.
- Do not widen `IG_CHANNEL_ORG_ALLOWLIST` beyond the org you are filming.
- Do not re-record before the verdict. The submitted tape cannot be edited, and a second recording made now would be filmed against a build that may change again before it is needed.
