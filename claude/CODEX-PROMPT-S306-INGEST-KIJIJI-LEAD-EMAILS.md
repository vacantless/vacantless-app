# CODEX PROMPT S306: turn on the Kijiji lead ingest that was designed and never wired

Repo: vacantless-app
Evidence: claude/FINDINGS-S306-KIJIJI-HAS-DELIVERED-1032-ENQUIRIES-TO-AALIYAH.md

## The situation

1,032 renter enquiries have arrived at `rentals@agileonline.ca` from `noreply@rts.kijiji.ca`
since 2024-05-03, most recently 2026-08-13. Four of them exist in `leads`. The other ~1,028 are
invisible to the product, which is why an internal read concluded Kijiji was dead.

The machinery to fix this already exists and already names Kijiji. `lib/portal-senders.ts`
opens with:

> "The syndication portals (Rentals.ca today; Zumper / Kijiji later) email a tenant lead from
> their OWN system address..."

and its registry comment says:

> "Grouped by portal so adding Zumper / Kijiji later is one entry."

`PORTAL_REGISTRY` today contains exactly one portal, `rentals_ca`. Kijiji has been "later" for
months while delivering thousands of leads into a mailbox nothing reads. This ticket is that
one entry, plus the parsing and the delivery path that make it actually arrive.

## Part 1: register the Kijiji sender

Add to `PORTAL_REGISTRY` in `lib/portal-senders.ts`:

    kijiji: { addresses: ["noreply@rts.kijiji.ca"], domain: "kijiji.ca" }

and widen `PortalKey`. Note the alignment question and get it right rather than guessing: the
sending host is `rts.kijiji.ca` but the ORGANIZATIONAL domain for DMARC/DKIM alignment is
`kijiji.ca`. The existing guard checks alignment to `domain`, so `kijiji.ca` is correct if
Kijiji's DKIM `header.d` is `kijiji.ca`. **Verify against a real message's
Authentication-Results header before enforcing.** The route's observe mode exists precisely for
this: run it accept-but-log until a real delivery confirms the header shape, then enforce.

## Part 2: parse the Kijiji message shape

Kijiji's subject is:

    New message from <Name>(<email>) about "<ad title>"

The renter's name and email are in the SUBJECT, which is unusual and convenient. The body
carries the message text and a reply link. Extract name, email, the ad title, and the message
body. Map the ad title back to a property where possible; the titles in use are free text
("Bright Renovated 1-Bedroom at 833 Pillette Rd", "Move-In-Ready 2nd-Floor 1BR, Fully Tiled -
833 Pillette Rd"), so an exact match will fail. Prefer matching on the `listing_posts` row for
portal `kijiji` whose `url` or `label` corresponds, and fall back to leaving `property_id` null
rather than guessing wrong. A lead on the right org with no property beats a lead on the wrong
property.

Set `source = 'Kijiji'` to match the four existing hand-entered rows, and set `listing_post_id`
when the ad can be resolved, so Kijiji attribution works from day one rather than repeating the
Facebook tracked-link gap.

## Part 3: the delivery path, which is NOT code and must be decided with Noam

Registering the sender is necessary and not sufficient. Kijiji sends to
`rentals@agileonline.ca`, not to the org's unguessable ingest address. Nothing will arrive until
one of these is true:

  (a) A forwarding rule on `rentals@agileonline.ca` copies mail from `noreply@rts.kijiji.ca` to
      the org's ingest address. Least invasive, keeps Aaliyah's workflow untouched, and is the
      recommended option.
  (b) The Kijiji account's contact email is changed to the ingest address. Cleaner long term,
      but it moves Aaliyah's leads out of the inbox she works from, so do not do this without
      her.

**Do not implement either. Write the ticket so Noam can choose.** This is a change to a live
mailbox that a person depends on daily.

Also note: Kijiji mail currently arrives at a mailbox that also receives Kijiji verification
codes, order confirmations and "Promote your ad!" marketing. The ingest must accept ONLY the
`New message from ... about "..."` shape and ignore everything else from that sender, or a
verification code becomes a lead.

## Part 4: backfill is out of scope, and say so

~1,028 historical enquiries exist as email only. Do not attempt to backfill them in this ticket.
Note in the code comment that historical Kijiji volume lives in `rentals@agileonline.ca` and is
not represented in `leads`, so any analysis of channel performance before the ingest date is
understated for Kijiji.

## How to verify

An end-to-end test with a real Kijiji reply. Send a test enquiry to a live Kijiji ad, confirm the
message reaches the ingest, and read the resulting `leads` row back. Check specifically that the
renter's email came out of the subject line correctly, that a verification-code email from the
same sender does NOT create a lead, and that the observe-mode auth log shows the real
Authentication-Results shape before anything is switched to enforce.
