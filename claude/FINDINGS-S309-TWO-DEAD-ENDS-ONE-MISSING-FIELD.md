> **[PARTIALLY SUPERSEDED 2026-08-31 by `FINDINGS-S673-THE-ENUM-ALREADY-EXISTS-IN-METADATA.md`. Read that first.]**
> The "one missing reason field" framing is withdrawn. The reason is already recorded, in structured form, in
> `distribution_publish_attempts.metadata`, and `error_code` already exists on BOTH tables with the worker writing
> real values onto `distribution_run_items`. What is missing is the WIRE between them, not the field.

> **PARTLY RESOLVED 2026-08-31 (same session), migration `0223_offmarket_shows_referral_page`, commit `8bc5a9f`.**
> The FIRST dead end is fixed: an off-market unit's `/r` page no longer 404s. Both public RPCs moved
> from `status not in ('off_market','draft')` to `status <> 'draft'`, so the "no longer available"
> page that was already built for `status='leased'` now renders for archived units too, with the
> org's open units listed under "Available now". Verified in Chrome on the real Unit D URL.
> The SECOND dead end is UNCHANGED: `archiveProperty` still never touches `listing_posts`, so the
> external ad stays live. The missing-reason-field argument below stands in full.

# S309: two dead ends, one missing field

_Written 2026-08-31. Both halves verified in production the same day. The syndication half is a
measurement; the archive half is a live incident that cost real money and real trust._

## THE PATTERN

Twice in one day, in two unrelated parts of the system, **an action recorded that it happened and
never recorded why.** Both times the missing field was the whole problem, and both times the fix is
one enum.

| | syndication | archive |
|---|---|---|
| the action | headless post stops | unit taken off market |
| what is recorded | `needs_operator` | `archived_at`, `status = off_market` |
| what is NOT recorded | why it stopped | why it was archived |
| the cost | 78 escalations nobody can price, route or tier | a leased unit advertised for 43 hours, then re-listed by us in error |

## HALF ONE: THE ESCALATION WITH NO REASON

Of 1,973 `distribution_publish_attempts` rows, **1,859 are cron no-ops** (`transport IS NULL`).
The 114 real attempts split by transport, and the split is the finding:

| transport | attempts | reached live | rate |
|---|---|---|---|
| `automatic` (Meta API) | 5 | 5 | **100%** |
| `browser_copilot` | 2 | 2 | **100%** |
| `concierge` (headless) | 107 | 3 | **2.8%** |

**78 of 107 concierge attempts end in `needs_operator`, and there is not one `error_code` in the
entire table.** Cloudflare, captcha, login walls, payment walls and rejected fields are all the same
undifferentiated shrug. You cannot price, route or tier an escalation you cannot classify.

Full detail: `FINDINGS-S309-SYNDICATION-IS-AN-ESCALATION-BUSINESS-NOT-AN-AUTOMATION-ONE.md`.

## HALF TWO: THE ARCHIVE WITH NO REASON

**1551 Assumption St Unit D was archived 2026-08-30 21:57 UTC. It was archived because it had been
leased** (Narayan, in writing, 2026-08-31 20:30 UTC: *"Unit D at assumption is now rented and tenant
moved in on Friday."* Friday was 2026-08-28).

**Nothing recorded that.** So on 2026-08-31 three separate parties independently failed to answer
"is this unit leased?":

1. **The operator had forgotten.** Reasonable. It was Friday, there are ten units, and nothing in the
   product said so.
2. **The assistant checked and could not tell.** `leased_outcomes` empty, no tenancy, no lead past
   `showed`, no showing after 08-27, no waitlist.
3. **The database structurally cannot answer it.** Agile has **zero tenancies org-wide** and
   `leased_outcomes` has never been written. The schema has the columns; nothing populates them.

**Any one of those three working would have prevented the entire day.**

### What the day cost

The unit was restored to market at 16:50 UTC on the strength of point 2. In the 3h56m before the
error was caught: roughly fifteen renters were told it was available, **two viewings were booked on an
apartment with a tenant living in it** (2026-09-01 18:00 and 18:15 EDT), and sixteen Messenger threads
had to be walked back.

### The assistant's error, stated precisely

Not "failed to know". **Reported not-knowing as near-certainty.** The phrase used was "almost
certainly NOT leased", derived from five empty tables in a system that the same investigation had
just proven does not record lease-ups. **Absence of a record is not evidence of absence when the
system cannot produce the record.** This is the project's own KI1117 rule inverted, and the correct
output was "the system cannot answer this, ask Narayan" - which would have taken a few hours, since
he answered unprompted the same afternoon.

## THE UNDERLYING PRODUCT DEFECT, WHICH IS SEPARATE AND STILL OPEN

Archiving does not stop advertising:

- `get_public_listing` ends `where p.status not in ('off_market','draft')`, so the `/r` page 404s.
  **Driven by `status`, not `archived_at`,** which the RPC never reads.
- `archiveProperty` (`app/dashboard/properties/actions.ts:1466`) updates `properties` and nothing
  else. It never touches `listing_posts`, never calls the takedown.
- `handleLeaseupAdLifecycle` is imported at `:163` but fires only at `:1006` on
  `effectiveStatus === "leased"`, and is gated behind `LEASEUP_TAKEDOWN_ENABLED`.
- The UI renders the contradiction without flagging it: **"Renter page not live" beside "1 outside ad
  live"** on the same panel.

So a correctly archived unit keeps advertising to a page that 404s. Renters called it a scam. **Had
the coupling existed, Saturday's archive would have pulled the ad, no renter would have hit a dead
link, and there would have been no reason to investigate or restore.** One missing coupling produced
both halves of the incident.

## THE FIX, WHICH IS THE SAME FIX TWICE

**1. Reason on `needs_operator`:**
`login_required | captcha | payment_wall | field_rejected | listing_cap | timeout | unknown`

**2. Reason on archive:**
`leased | paused | renovating | withdrawn | duplicate | other`

Both are one enum, written where the transition already happens, surfaced where a human already
looks. Saturday's archive would have read **"Rented, 30 Aug"** and nobody would have been guessing.

**Ship the reasons before building anything that depends on knowing them** - the tier model, the
escalation console, the takedown coupling. All three are speculation until the field exists.

## SECONDARY, WORTH FIXING WHILE IN THERE

- **No audit of property mutations anywhere in the 96-table schema**, and `archiveProperty` records no
  actor. Only two accounts can archive an Agile property: `thadmusco@gmail.com` (owner_admin) and
  `rentals@agileonline.ca` (operator). "Who archived this" is permanently unanswerable as built.
- **Nothing checks that a `listing_posts` row marked `live` points at a page that renders.** That
  tripwire is one query and would have caught this within a cron cycle. Note the paused renter-funnel
  monitor would NOT have caught it: it selects `status='available' and archived_at is null`, so it
  would have tested a different unit and passed green.
- **Process fix on the Agile side, already raised with Narayan 2026-08-31:** notify on the day a lease
  is signed, not at the next schedule request. Ads run until someone says stop.
