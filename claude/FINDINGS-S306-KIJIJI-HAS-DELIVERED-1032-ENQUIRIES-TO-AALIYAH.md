# FINDINGS S306: Kijiji has delivered 1,032 renter enquiries. The product has seen 4.

Date: 2026-08-29
Method: read-only search of `rentals@agileonline.ca` (Aaliyah's Roundcube), logged in by Noam.
Search: From contains `rts.kijiji.ca`, scope all folders. No message was opened, moved or marked read.
Mailbox URL: https://emailmg.netfirms.com/roundcube/?_task=mail&_mbox=INBOX

## The number

**1,032 messages from `noreply@rts.kijiji.ca`**, the address Kijiji uses when a renter replies to
an ad. Oldest on the last page is **2024-05-03**. Most recent is **2026-08-13**.

For comparison, on the same day:

| source | Kijiji leads visible |
|---|---|
| Aaliyah's mailbox | **1,032** |
| Noam's Gmail (copies of Zapier alerts) | 16 |
| Supabase `leads` where source = 'Kijiji' | **4** |

## What I got wrong, plainly

Earlier today I wrote that Kijiji had produced zero, and recommended deferring spend partly on
that basis. The statistic I used, "598 attempts, zero published", is true and is about the WORKER.
It means the automation has never posted a Kijiji ad. I used it as though it described the
CHANNEL. It does not. The ads that produced these 1,032 enquiries were posted by hand.

Noam caught it and pointed at Aaliyah's mailbox, which is exactly where the evidence was.

## The recent rate, which is what matters for a spend decision

The first page of results, newest 50, spans **2026-02-15 to 2026-08-13**. So roughly **8 enquiries
a month** in 2026. Page 21, the oldest, shows about 20 enquiries in five days of May 2024, so
volume is far below what it once was, but it is not zero and it has not stopped.

833 Pillette specifically, from the newest page:

| date | renter | ad |
|---|---|---|
| 2026-08-13 | Javad Motamed | Bright Renovated 1-Bedroom at 833 Pillette Rd |
| 2026-07-31 | simarjot.0001 | Bright Renovated 1-Bedroom at 833 Pillette Rd |
| 2026-07-03 | Dee Dee | Move-In-Ready 2nd-Floor 1BR, Fully Tiled |
| 2026-07-03 | Rudra thakkar | Bright Renovated 1-Bedroom |
| 2026-06-30 | Mini (x2) | Move-In-Ready 2nd-Floor 1BR |
| 2026-06-23 | Naw dah | Move-In-Ready 2nd-Floor 1BR |
| 2026-06-22 | Princess | Bright Renovated 1-Bedroom |

Eight enquiries in under two months, from two Pillette ads. The rest of the 50 are Wyandotte and
the older (A1)/(B1)/(P1)/(W1) ads.

## Kijiji is ALREADY being paid for

Also visible in the same mailbox, not opened, subject lines only:

- **"Kijiji order confirmation #CA20036847018"**, 2026-07-24
- "Agile Real Estate Group, your listing 'Bright Renovated 1-Bedroom at 833 Pillett...'", 2026-07-24
- Repeated "Promote your ad!" mails through July

So the question was never "should Agile start paying for Kijiji". Agile has been paying. The
question is only whether the WORKER should be allowed to do the paying automatically. That is a
much narrower question and it changes the shape of the decision.

## Why the product cannot see any of this

The enquiries land in `rentals@agileonline.ca` as Kijiji-branded mail. Nothing ingests them.
Four made it into `leads` with source 'Kijiji', presumably typed in by hand. The other ~1,028
exist only as email. Every dashboard number, every channel comparison, every "which channel is
working" judgement this project has made was computed without them.

That is the largest single blind spot found in this project to date, and it is the same failure
as the tracked-link gap and the stale availability date: the product's picture of the world is
narrower than the world, and nothing in the product says so.

## Standing rule, written the hard way, twice

A zero from a query is a claim about the query. Before calling a channel dead, find where its
leads would actually land and look there. For Agile that is Aaliyah's Roundcube, not Supabase.
