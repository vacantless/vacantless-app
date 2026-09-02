# Meta App Review resubmission, section 7 addendum (S675, 2026-09-02)

Paste the block below into the submission notes. It supplements the recording; it does not
substitute for it. Keep all six per-permission justifications from the rejected submission
**unchanged** - Meta approved the use case and rejected only the artifact.

Video: `vacantless-meta-app-review-2026-09-02.mp4`, 2 min 35 s, 1600x1090, 21 captioned steps,
English throughout, no audio track (every step carries an on-screen caption, per the Screen
Recording Guide's captions option).

---

## PASTE FROM HERE

This screencast replaces the one submitted on 2026-08-16. That recording opened on an
already-connected state and contained no Meta authorization surface. This one shows the complete
flow from signed out.

**Where each item in your feedback appears:**

| Your requirement | Timestamp | What is on screen |
|---|---|---|
| The complete Meta login flow | **0:42 - 0:50** | Clicking Connect Facebook Page leaves our app for facebook.com. The address bar is visible. The operator enters their Facebook email and password on Facebook's own login form. Our application never receives the password. |
| A user granting app access | **0:50 - 1:31** | Facebook confirms the account (0:50), then the operator opens the full permission flow and grants each asset explicitly: Pages (0:57), Businesses (1:05), the Instagram Business account (1:12), and finally Meta's own review screen listing every permission being granted (1:19 - 1:31). |
| ...specifically all six permissions | **1:19 - 1:31** | Meta's review screen reads: Manage your business; Access profile and posts from the selected Instagram account; Upload media and create posts for the Instagram account; Create and manage content on your Page; Read content posted on the Page; Show a list of the Pages you manage. These are business_management, instagram_basic, instagram_content_publish, pages_manage_posts, pages_read_engagement and pages_show_list respectively. |
| End-to-end experience of the use case | **0:22 - 2:35** | The listing's address, bedrooms, bathrooms and rent are shown at 0:22 before anything is connected. The finished posts at 2:15 - 2:35 carry the same address, bedroom and bathroom counts, rent and a tracked inquiry link, so the whole path is verifiable against one listing. |
| English UI, captions, explained controls | throughout | English only. Every one of the 21 steps carries a caption naming the control and what it does. |
| Server-to-server / system user token | **not applicable** | Vacantless is not a server-to-server application and does not use a system user token. Authentication is Facebook Login for Business, initiated from our web app in the operator's own browser, and it is visible on camera at 0:42. |

**Two points about our consent model that the recording makes explicit, because they are the basis
of several of the per-permission justifications:**

1. **Connecting an account authorizes no posting.** At 1:41 both channels are connected to Meta and
   both read "Needs authorization". The product will not publish to either account until the
   operator takes a second, separate action, shown at 1:51. That authorization is recorded against
   the operator's user ID with a timestamp and can be revoked at any time without disconnecting the
   account - the revoke control is visible in the same frame.

2. **Publishing names every destination before anything is sent.** At 2:00 the confirmation lists
   every channel the post will reach, including the Facebook Page and the Instagram account, above
   the text "Nothing posts or charges until you approve it". There is no scheduled posting and no
   bulk posting; one listing publish creates at most one post per authorized channel.

**A note on the posts shown at 2:15 - 2:35.** These are the live posts on the operator's own
Instagram Business account and Facebook Page, published through this product from the listing shown
at 0:22. They were created by an earlier run of this same flow, so their timestamps predate this
recording. The recording shows the authorization and approval path that produces them; it does not
re-publish a duplicate to the same account.

## PASTE TO HERE

---

## Why the last line is in there

Because it is true, and because a reviewer comparing the post dates against the recording date will
see it anyway. Volunteering it costs nothing and reads as candour; being caught omitting it reads as
a second Developer Policy 1.6 problem. **If Noam would rather not include it**, the alternative is to
publish a genuinely new post before submitting - which requires either a listing that is not already
live on both Meta channels, or taking the existing posts down first. That is a product decision, not
a recording one.
