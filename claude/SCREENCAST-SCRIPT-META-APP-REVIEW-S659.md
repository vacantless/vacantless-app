# Meta App Review screencast: shot list (S659, 2026-08-16)

Supersedes §3 of `claude/META-APP-REVIEW-PACKAGE-VACANTLESS-S628.md`, which scripts a
"Review & post" button that does not exist. See
`claude/FINDINGS-APP-REVIEW-FLOW-MISMATCH-S659.md`.

**STATUS 2026-08-16: UNBLOCKED.** The gate shipped (`b64eb36`) and the contradictory copy was
fixed (`3084501`); prod is `3084501` and both deploys are READY. **Either publish path now
confirms**, so Set Live is filmable again - the sequence below still uses Publish everywhere
because that surface shows more channels.

**One thing left before you hit record:**

1. **Paste the replacement section 1 / 2 / 4 text** from
   `claude/FINDINGS-APP-REVIEW-FLOW-MISMATCH-S659.md` into the Meta submission. That doc has been
   updated for the shipped UI - use the version headed "PASTE-READY SUBMISSION TEXT", not the S628
   originals, which describe a "Review & post" button that does not exist.

Six permissions ride on this one recording: `pages_show_list`, `pages_read_engagement`,
`business_management`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`.

---

## Before you hit record

1. **`@getvacantless` profile polish** — avatar, real bio, website link. This is the first thing
   a reviewer sees and the profile currently renders Instagram's "Add Profile Photo" prompt.
   Yours to do.
2. **Decide which take you are shooting** (see below). Rehearse it dry once with recording off.
3. Have `app.vacantless.com` and `instagram.com/getvacantless` open in separate tabs, both
   already signed in. Do not film a login.
4. Close anything with a customer name in it. Growth Test only.

**Property:** `5a1e0c7d-9b64-4f21-8c3a-1d7e2f6b4a90`, 833 Pillette Rd Unit 3, Windsor ON,
18 photos, org Growth Test `8ea1da48`. Currently `off_market`.

**Correction to the S658 handoff:** you do *not* need to set it to Draft first. `publishProperty`
accepts `off_market` directly (`actions.ts:1126-1129`). Set Live works from where it sits.

---

## Which take

### Take A — full flow, one continuous recording (recommended if you'll rehearse it)

Covers all six permissions in one pass, including the OAuth Page picker that `pages_show_list`
and `business_management` need on camera. Requires disconnecting Instagram first, which means
re-running the OAuth reconnect live. That reconnect has a ~10 minute window; do not deliberate
inside it (rule 72). Rehearse dry, then shoot.

### Take B — safe order, two recordings

Shoot the IG post first while the lane is warm and proven, bank it, then separately shoot the
connect/OAuth portion. If the reconnect misbehaves you still have the post captured.
`instagram_content_publish` is the scope with 0 API calls and the most to prove, so it gets
filmed first.

**Recommendation: rehearse Take A dry, and if anything feels shaky, shoot Take B.**

---

## Pre-flight state reset (needed for either take)

Instagram is currently `automation_authorized = true` (set 2026-08-16 01:58:49 UTC). To film the
authorization moment you have to clear it first.

- **Take A:** disconnect Instagram, which resets everything. Film the reconnect.
- **Take B:** click **Revoke** on the Instagram row. `revokeChannelAutomation`
  (`distribution-actions.ts:415`) sets `automation_authorized=false` and nulls the `_at`/`_by`
  pair. It does **not** touch `account_status`, so the connection survives. Re-clicking Authorize
  restores it with a fresh timestamp. Fully reversible, same buttons proven in S658.

---

## The shot list

### 1. The listing is real — 15 sec
Open the property in Vacantless. Hold on the address, beds, baths and monthly rent long enough to
read. Scroll the photos briefly. The reviewer needs to believe this is a real rental listing, and
needs these values to match the Instagram caption later.

### 2. Connect the account — `pages_show_list`, `business_management`, `pages_read_engagement`
*(Take A, or Take B's second recording.)*

Click **Connect**. On the Meta consent screen, **pause on the Page picker** — that screen is the
whole justification for `pages_show_list`. Select the Vacantless Page. Return to Vacantless and
hold on the row now reading connected, with the account label `@getvacantless` visible. That
label is `instagram_basic` doing its job: identifying which account is connected.

**Say:** "Vacantless asks the operator to pick which of their own Pages to connect, and reads the
Instagram Business account linked to it so posts go to the right place."

### 3. Connecting is not consent — the key beat
Point at the channel row while it is connected but **not** yet authorized. This is the single most
important frame in the recording.

**Say:** "Connecting the account does not authorize any posting. Nothing can be published until
the operator takes a second, separate action."

### 4. Authorize — the consent moment
Click **Authorize auto-post**. Hold on the row changing state.

**Say:** "This is that second action. Vacantless records this authorization against my user ID
with a timestamp. It applies to this one channel, and I can revoke it at any time."

### 5. Show the off switch — 5 sec
Point at the **Revoke** control on the same row. Do not click it. Reviewers care that consent is
withdrawable, and most submissions never show it.

**Say:** "Revoking here stops all further posting immediately."

### 6. Publish this listing — `pages_manage_posts`, `instagram_content_publish`
On the **Get online** tab, click **Publish everywhere**. Hold on the confirm modal: it names the
listing and lists every destination the post will reach, with Instagram marked **INSTANT**. Then
approve it.

**The "Set Live" button in the page header is SAFE to film as of `b64eb36` / prod `3084501`.**
It is now `type="button"` and opens the same "Approve connected account posts" confirm
(`page.tsx:2499`, proven live on prod 2026-08-16). Use **Publish everywhere** anyway, because that
surface lists more channels on camera. The pre-`b64eb36` warning that Set Live posted silently is
obsolete - see `claude/FINDINGS-APP-REVIEW-FLOW-MISMATCH-S659.md`.

**Say:** "Authorization on its own posts nothing. To publish, I approve a confirmation that names
every account this listing will be posted to. One listing published, one post per authorized
channel. There is no scheduling and no bulk posting."

### 7. The post exists — the payoff
Cut to the `instagram.com/getvacantless` tab, refresh, open the post permalink. Hold on the
caption long enough to read the **address, beds, baths, rent and tracked link**, and make sure the
reviewer can match them against what you showed in shot 1. Show the cover photo is the listing's.

### 8. Close the guardrail — 15 sec
**Say:** "Every post is the direct result of an operator authorizing a channel and then publishing
a specific listing. No scheduled posting, no bulk posting, and no tenant or renter personal
information is ever sent to Meta."

---

## Length and format

Two to three minutes. Meta reviewers skim; the frames that decide it are shot 3 (connecting is not
consent), shot 4 (the authorize click), shot 5 (revoke exists) and shot 7 (the real post matching
the real listing). Everything else is connective tissue.

Narrate out loud rather than relying on captions. Do not speed up or cut inside the
authorize -> publish -> confirm -> post sequence; a reviewer needs to see it is continuous and
unedited.

---

## After filming

1. Paste the replacement §1 app description and the six §2 per-permission justifications from
   the findings doc. Do not paste the S628 originals.
2. Attach the recording.
3. Submit under **Use cases -> Customize -> Permissions and features** (not the old
   `/app-review/permissions/` path, which redirects).
4. Restore state if you shot Take B: re-click **Authorize auto-post** on Instagram, and take the
   listing back to `off_market`.
5. **Delete the Instagram post** once the recording is captured, and re-verify the profile is back
   to 0 posts. Instagram has no web Archive for feed posts; delete is the only web path.
