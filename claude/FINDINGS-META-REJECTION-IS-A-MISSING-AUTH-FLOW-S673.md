# The Meta rejection is a missing auth flow, not a thin screencast (S673, 2026-08-31)

**STATUS: the real reviewer feedback is now on the record. The project had been working from an inference.**

## What the project believed

Three files (`SESSION_LOG.md`, `PROJECT_CONTEXT.md`, `00-NEXT-SESSION.md`) carried one sentence: rejected
2026-08-26, six of seven permissions, "the stated cause is the SCREENCAST, not the product", plus Meta's line
"we have determined that your apps' use case is allowed". **No per-permission feedback had ever been recorded**,
and the resubmission was framed as a choice between re-recording with the login visible and declaring the token
model in the notes.

## What Meta actually wrote

Read 2026-08-31 from the App Review feedback page, submission `1580903356951595`, app `1570549797986951`.
Request placed **2026-08-16 20:00 EDT**, decided 2026-08-26. `public_profile` approved; the other six rejected
with **identical** text headed **"Screencast Not Aligned with Use Case Details"**, Developer Policy 1.6.
It is a three-part content checklist:

1. The complete Meta login flow;
2. A user granting app access to the permission/feature;
3. The end-to-end experience of the use case;

plus the Screen Recording Guide best practices (English UI, captions, explain the UI), plus an escape hatch:
declare it if the app is server-to-server or uses a system user token so Meta knows the frontend Meta login is
not visible.

The full text is quoted in `SCREENCAST-SCRIPT-META-APP-REVIEW-S659.md` section 1.

## What the tape actually contains

`vacantless-meta-app-review.mp4`: 81.04s, 1530x968, 25fps, **no audio stream**, 20 burned-in captions.
Frames sampled every 4s into `S673-screencast-contact-sheet.jpg` (project folder root).

- Opens at step 1 **already signed in to Vacantless**, on the Get online tab.
- Caption 2: "The Facebook Page is authorized. Instagram is connected but NOT authorized." The connection is a
  pre-existing state.
- **No Vacantless login, no Facebook login, and no Meta consent screen anywhere in the recording.** No Page
  picker, no permission grant dialog, nothing on a `facebook.com` OAuth surface.
- The only thing called "authorize" on camera is Vacantless's own green **Authorize auto-post** button, which is
  an internal toggle, not a Meta grant.
- Steps 8 to 11 (confirm modal naming destinations) and 15 to 20 (the live post on `@getvacantless` and the
  Vacantless Page) are good and are worth re-shooting the same way.

## The correction

**The take missed bullets 1 AND 2, not just bullet 1.** From the reviewer's seat, six Meta permissions were
requested and the video contained **zero Meta authorization surface**. That is why all six died with one
boilerplate and `public_profile`, which needs no demonstration, survived. Reading it as "the screencast was too
thin" would have produced a longer video with the same hole in it.

Traceable to two lines in the 2026-08-16 script: **"Do not film a login"**, and the Take A / Take B fork that
made the OAuth Page picker optional. Take A was the one that put the Page picker on camera. Take B was filmed.

## The escape hatch is not available

Meta's fifth bullet does not apply and claiming it would be a false statement. Vacantless is not a
server-to-server app and uses no system user token. `GET /api/integrations/facebook/connect` sends the operator
to Meta's OAuth dialog in their own browser and `app/api/integrations/facebook/callback/route.ts` exchanges the
code for a user token then a long-lived Page token. There is a frontend Meta login flow; it was not filmed.
**Reading the actual feedback removed the second option.** The resubmission approach is not a judgement call.

## Two facts that de-risk the re-record

Both read from code at PROD `82776e6`.

**One Connect click covers all six scopes.** `lib/facebook-page-oauth.ts:13-27`: `FACEBOOK_PAGE_BASE_SCOPES` is
`pages_show_list, pages_read_engagement, pages_manage_posts, business_management`; `INSTAGRAM_GRAPH_SCOPES` is
`instagram_basic, instagram_content_publish`; `facebookPageScopes()` returns both when Instagram is enabled for
the org. So one **Connect Facebook Page** click puts **all six rejected scopes on a single Meta consent screen**.
The Take A / Take B fork is obsolete. `disconnectFacebookPage` is bound to the Disconnect control on both the
Facebook and Instagram rows and clears authorization too, so **one disconnect resets everything**.

**The "10 minute window" is conditional and often absent.** It is `exp: Date.now() + 10 * 60 * 1000` on the
`fb_oauth_pages` cookie (`callback/route.ts:263`) and it exists only if the Vacantless Page picker renders. At
`callback/route.ts:242`, `candidates.length === 1` finalizes the connection immediately and redirects back as
`connected`, **skipping the picker entirely**. With exactly one Page on the account there is no picker, no cookie
and no window, and `pages_show_list` is justified by Meta's own Page selector on the consent screen instead.

## The gate that would silently sink the re-record

`igChannelEnabledForOrg` (`facebook-page-oauth.ts:92-100`) gates the two Instagram scopes on `IG_CHANNEL_ENABLED`
plus `IG_CHANNEL_ORG_ALLOWLIST`. **Vercel env bakes at build time** and prod has rebuilt three times since the
Aug 16 recording (`8bc5a9f`, `8057256`, `82776e6`). If the flag or the allowlist did not survive, the consent
screen carries **four** scopes, the recording looks correct, and the two Instagram permissions are rejected
again for a reason nothing on camera would reveal. This is now pre-flight gate 0 in the script: confirm an
Instagram channel row renders on the test property's Get online tab **before** hitting record.

## Also settled

- **The reviewer test login was not the cause.** All six rejections are the identical screencast checklist and
  none mentions being unable to access or sign in to the app. The standing "if Meta rejects, check the reviewer
  test login first" note from S660/S661 can be retired as the working hypothesis. It says nothing about whether
  the login was ever used, only that it is not what the rejection is about.
- **The submission notes are good and were read.** All six per-permission justifications already describe the
  three-step consent model (connect, then "Authorize auto-post" recorded against user ID and timestamp, then
  publish and approve a confirmation naming every destination). **Keep them. Change the recording only.**
- The submission list page shows "Submitted on August 26, 2026 at 23:56 EDT" while the feedback page shows
  "Your request results for August 16, 2026 at 20:00 EDT". The Aug 16 timestamp is the request; the Aug 26 one
  tracks the decision. **Do not read the list page date as the submission date.**
