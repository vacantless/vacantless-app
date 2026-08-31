# S309: syndication is an escalation business, not an automation business

_Written 2026-08-31. All figures read from production via the Supabase MCP on 2026-08-31. Read-only:
nothing in this document was pushed, deployed, or written to the database._

## THE ONE NUMBER

**114 real posting attempts. 8 reached live. Under 3% on the path we are trying to sell.**

`distribution_publish_attempts` holds 1,973 rows, but **1,859 of them are cron no-ops**
(`transport IS NULL`, `actor_type = 'system'`, 7 channels). Those are sweep heartbeats, not posting.
The real attempts are the 114 that carry a transport, and they split cleanly:

| transport | what it is | attempts | reached live | rate |
|---|---|---|---|---|
| `automatic` | Meta API (facebook_feed, instagram) | 5 | 5 | **100%** |
| `browser_copilot` | human drives, system guides | 2 | 2 | **100%** |
| `concierge` | headless browser | 107 | 3 | **2.8%** |

**The API path works. The human-guided path works. The headless path does not.**
That is the entire finding, and it should decide the product.

## THE FAILURE IS MONOTONOUS, AND UNEXPLAINED

**78 of 107 concierge attempts end in `needs_operator`**, across kijiji, rentfaster, viewit, zumper
and rentals_ca. Not crashes. Not errors. The robot walked up to something and handed it back.

Full outcome distribution of the 114:

| channel | transport | outcome | n |
|---|---|---|---|
| kijiji | concierge | needs_operator | 42 |
| kijiji | concierge | needs_payment | 16 |
| kijiji | concierge | submitting | 8 |
| kijiji | concierge | **live** | **3** |
| kijiji | concierge | queued | 1 |
| kijiji | browser_copilot | **verified_live** | **2** |
| rentfaster | concierge | needs_operator | 18 |
| rentfaster | concierge | needs_payment | 1 |
| zumper | concierge | needs_operator | 8 |
| viewit | concierge | needs_operator | 7 |
| rentals_ca | concierge | needs_operator | 3 |
| facebook_feed | automatic | **verified_live** | **3** |
| instagram | automatic | **verified_live** | **2** |

**There is not one `error_code` in any of the 1,973 rows. Every value is NULL.**

So the system knows 78 attempts stopped and cannot say why any of them stopped. A Cloudflare block on
rentals.ca, a Kijiji captcha, a rejected field, a login wall and a payment wall all land in the same
undifferentiated bucket.

**This is the blocker to the business model, not the automation.** You cannot price an escalation you
cannot classify, cannot route it, and cannot decide which tier owns it. Everything downstream depends
on a column that is always null, and it is the cheapest thing on this list to fix.

## THE TIER BOUNDARY IS THE TRANSPORT, NOT THE CHANNEL

The instinct to split "ones people can do" from "ones that become problematic" is right, but
**you cannot pre-sort portals into tiers**. Kijiji is simultaneously the only channel that has ever
produced a live post (3) and the largest single source of `needs_operator` (42). The same portal
succeeds and fails on different runs, depending on what it puts in front of the agent that day.

What you can sort on is what happened on that attempt, and **the system already emits exactly that
signal**: `needs_operator`.

- **Self-serve tier.** The system attempts headless. On `needs_operator` the customer gets a
  well-designed prompt and finishes the step themselves. That is the copilot path, 2 for 2.
- **Agency tier.** On `needs_operator` it escalates to us and we resolve the stuck step. Billed per
  escalation resolved, or per placement landed.

**The unit of billing is the escalation, not the channel.** That is more robust than a channel tier
list (it survives a portal changing its defences overnight), and it means revenue arrives precisely
when the automation fails, which is the only honest way to sell automation running under 3%.

## WHAT NOT TO SELL

**Do not position this as defeating bot detection.** The stop gates in the copilot (login, captcha,
payment, final review) are not defects, they are the product's stated ethics: Vacantless never logs
in for you, never enters payment details. Selling "our AI gets past what stops the robot" inverts our
own trust story, is technically fragile, and gets accounts banned. This project already lost Kijiji
ads once.

Sell it as **"we do the human steps for you, with your written authorization."** That is a managed
service, it is defensible, and it is what the data says we actually do.

**Captcha stays off the table entirely.** Solving or bypassing CAPTCHA is out of scope for the agency
tier at any price. If a channel's escalations are mostly captcha, that channel is not agency-able and
should be sold as copilot-only.

**A hard constraint worth designing around: an AI agent cannot resolve a login-gated escalation.**
Claude will not enter credentials. So the slice of `needs_operator` that is "login required" needs a
human or an already-established session, and can never be automated away. Until the enum below exists
we do not know how big that slice is, and it determines whether the agency tier is an AI service with
human backup or a human service with AI assist. Those have very different margins.

## SYNDICATION IS NOT IN EITHER TIER TODAY

Core's "channel-agnostic intake (Facebook, Kijiji, phone, email)" is **leads coming in**, not listings
going out. Neither Core ($400/$200) nor Plus ($750/$375) sells posting. So this is not repositioning,
it is **pricing syndication for the first time**.

And the agency tier contradicts the promise the current sheet is sold on:

> "Vacantless doesn't replace your showing staff; it gives them a system to work from."

That tension is real and should be resolved deliberately rather than discovered in a sales call.
**The reconciliation to test:** the system is still theirs and their operator still runs the daily
rhythm; what we take over is only the step that defeated the machine. The agency tier is an overflow
valve, not a replacement. That keeps the existing promise intact.

## CREDENTIALS: THE SHAPE IS RIGHT, THE GOVERNANCE IS MISSING

**The good news, and it is genuinely good: we do not store passwords.** `distribution_channel_sessions`
holds AES-GCM encrypted session state per org per channel (`encrypted_state`, `iv`, `auth_tag`). The
customer authenticates; we hold a session artifact, not a credential. That is the correct architecture
and it is already built. Ten session rows exist across Agile and Growth Test.

Four gaps stand between that and an agency tier anyone should sign:

**1. Sessions never expire.** `expires_at` is **NULL on all ten rows**, and nothing reads it anyway.
We hold live authenticated sessions to customer portal accounts indefinitely, with no automatic
revocation. For a SaaS that is untidy. For an agency holding client credentials it is the single
biggest liability on this list.

**2. Nobody knows whose account it is.** `external_account_label` is **NULL on every browser channel**.
The Meta channels carry labels ("Vacantless", "@getvacantless"); kijiji, rentals_ca, zumper, rentfaster
and viewit carry nothing. So the data cannot answer "did we post under the client's account or ours?"
That matters because `admin@vacantless.com` has historically been **one shared Kijiji account used by
every org**. An agency tier cannot run on a shared account: the blast radius of one suspension is every
client at once, and it already produced twelve duplicate posts against one address.

**3. Validation is stale and unnoticed.** `last_validated_at` on Agile's rentals_ca session is
2026-07-25, 37 days ago. Growth Test rentals_ca and zumper likewise. A session can be dead for weeks
and nothing says so, which is indistinguishable from the channel simply not being used.

**4. There is no credential consent record.** The codebase already has the right pattern for this:
`automation_authorized` / `_at` / `_by`, and `spend_authorized` / `_at` / `_by` / `spend_revoked_at`.
There is no equivalent for "this org authorized us to hold and act under their portal session."

### Target design, in the order it should be built

1. **Never take possession of a credential. Ever.** The customer authenticates in a session they
   initiate; we capture the artifact. This is already true. Write it down as policy so it survives
   the first customer who offers to email a password.
2. **Prefer real delegated access wherever the portal offers it.** Meta already works this way via
   OAuth, and it is the only transport at 100%. Ask each portal whether an agency or multi-user
   sub-account exists. A sanctioned sub-account beats a captured session on every axis: revocable by
   the client, attributable, and not a ToS problem.
3. **Set and enforce `expires_at`.** A session that has not been validated in N days is dead and must
   be re-established by the client, not silently reused. Enforcement means something actually reads
   the column, which today nothing does.
4. **Populate `external_account_label` on every channel** so every post is attributable to a named
   account. Then move each client off any shared account onto their own.
5. **Add a credential-access consent record** mirroring the spend-authorization pattern:
   granted_at, granted_by, revoked_at, and a client-visible audit of every action taken under their
   session. **Make something read it before the first paying client**, which is the whole lesson of
   the S308 spend gate: an authorization flag nothing enforces is decoration.

## THE INSTRUMENTATION THAT UNBLOCKS ALL OF IT

Before building tiers, pricing, or the escalation console, record why an attempt stopped. One enum
written wherever a run item transitions to `needs_operator`:

    login_required | captcha | payment_wall | field_rejected | listing_cap | timeout | unknown

Run it two weeks across Agile and Growth Test. That single field answers, with evidence rather than
argument:

- which channels are agency-able and which are copilot-only (captcha-dominant means copilot-only)
- what fraction of escalations an AI agent could resolve at all (login-dominant means it cannot)
- what an escalation actually costs to clear, which is the number the price hangs on

**Right now any pricing set for this is a guess dressed as a plan, and there is enough traffic to
answer it properly in a fortnight.**

## SEQUENCE

1. Ship the `needs_operator` reason enum. Small, safe, no customer-facing change. **Gate: normal
   review and deploy.**
2. Measure two weeks.
3. Set `expires_at` on sessions and populate `external_account_label`. **Gate: schema plus a backfill,
   Noam's call.**
4. Draw the tier boundary from the measured mix, then price the escalation.
5. Only then build the escalation console and the agency workflow.

Steps 1 and 2 cost almost nothing and make steps 3 to 5 factual instead of speculative.

## WHAT THIS DOES NOT COVER

Whether the portals' terms of service permit agency posting under a client session. That is a legal
question, it differs per portal, and it should be answered before the agency tier is sold rather than
after. Flagging it as a known gap, not an oversight.
