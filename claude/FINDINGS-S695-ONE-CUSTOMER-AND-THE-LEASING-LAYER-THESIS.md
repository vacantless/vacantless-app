# FINDINGS S695: one customer, and what was actually built

Date: 2026-09-10 (Session 695, after the wrap). Written because the pricing work earlier the same day reasoned about tiers for a product with no external user, and that fact was not written down anywhere.

## The evidence: every org in the system [verified 2026-09-10 via SQL]

| Org | Properties | Leads | Showings | Tenancies |
|---|---|---|---|---|
| Agile Real Estate Group | 10 | **226** | **100** | 0 |
| Abbas Husain | 12 | 0 | 0 | 11 |
| David Harel | 4 | 0 | 0 | 4 |
| Davis Muscovitch Rentals | 3 | 1 | 0 | 3 |
| Fiona Cunningham & Jeff Gross | 1 | 0 | 0 | 1 |
| Paul Peretz | 1 | 0 | 0 | 1 |
| Mahmood Foadghazni | 1 | 0 | 0 | 1 |

Remaining orgs are test fixtures (North Star QA, Growth Test, Smoke Test, Maple Door, Org A/B, Premium Test).

**Read it plainly:**

- **One organization uses the leasing product, and Noam manages it.** Agile is 96% of all lead activity ever recorded.
- **Six real landlord orgs hold 21 tenancies between them and have never produced a single lead or showing.** They are portfolio records, not users.
- **Zero dollars have ever been collected through the product by anyone**, and no rent mandate has ever been active.
- **All 32 properties are in Ontario**, so nothing is currently blocked by Noam's Ontario-only licence.

There is proof the machine works. There is not yet evidence anyone will buy it as software. Those are different things.

## What was built

A property management platform, described until now as a leasing tool.

- **Leasing:** renter listing pages with tracked attribution (`/r/<property_id>?p=<listing_post_id>`), lead capture into the app and Airtable, Calendly booking, confirmations, reminders at 24h / same day / 2h, outcome tokens and nudges, renter reply routing. 226 leads, 100 showings, one real third-party lease-up in 8 days.
- **Syndication:** channel catalog with per-portal capability contracts, a Playwright worker posting unattended to Zumper and Rentals.ca (7 live worker posts), AES-256-GCM session storage, a session-check job, an ad writer, a concierge desk with proof-of-publish, and a daily live check that re-reads every live ad on the real portal.
- **Money:** Plaid feed, OFX import fallback, categorization rules, expenses tagged per unit, reconcile, rent roll, income statement, tax package, accountant package, Rotessa and Stripe rails modelled.
- **Platform:** multi-tenant with RLS, magic links so no renter needs a password, per-org notification settings, compliance calendar, listing health, Ontario rent-increase guideline logic, a worker box, crons every 15 minutes, 224 migrations, 241 test scripts and a ratcheting plain-language gate.

## The thesis, proven accidentally on Noam himself

Buildium, Yardi and AppFolio are strong on money and weak on leasing and syndication. This build has the opposite emphasis.

**Noam runs Agile's money in Buildium and Agile's leasing in Vacantless.** That is not a workaround, it is the product statement: the leasing and syndication layer for landlords and managers whose money is handled elsewhere, or nowhere. It also explains the table above. The only org with real activity is the one where the leasing layer was genuinely needed; the dormant orgs entered their portfolios as records and had no leasing problem to solve.

## Monetization, ranked against what can actually be delivered

1. **Charge agent rates for Ontario lease-ups now.** The only line with proven delivery, a licence behind it, and no engineering required. Roughly $625 on a $1,250 Windsor one bedroom against $99 for software. The landlords are already in the database; Abbas alone holds 12 properties and 11 tenancies.
2. **Treat Vacantless as the margin lever, not the product.** Every hour it removes is margin on a lease-up already being paid for, which funds the build without requiring anyone to buy software.
3. **Sell software to people who earn per lease-up**, meaning agents and small managers, not two-door landlords. They have the same economics and can justify $99 immediately.
4. **Do not sell rent collection until it has moved a dollar.**
5. **Syndication is weak as a standalone product** (a landlord can post to Kijiji himself, portals can break it without warning) and strong as a component of a lease-up worth $625.

## The licence constraint, and why it argues for automation

Noam is licensed in Ontario only. Every current property is Ontario, so nothing is blocked today, but two things follow:

- The services path caps at one province and his own hours. That makes it the funding and proving stage, not the destination.
- **The concierge model sits on the exposed side of the licence line.** DECISION-S694 commits to one button with a person behind it, and a person performing leasing work for compensation is the shape that looks like trading in real estate rather than supplying a tool. Inside Ontario that is covered. Outside it, that question needs a real answer from a lawyer who knows TRESA before a single account is sold. **This is not a Claude judgment and must not be guessed at.**
- Therefore the case for real automation is stronger than DECISION-S694 implies. Automation is not only cheaper delivery, it is the difference between a product sellable in Ontario and one sellable anywhere. **Keep the concierge desk as an Ontario-only premium, not as the foundation.**

## What is missing

Distribution. Not code. Nobody outside Noam's own relationships has any way to discover this exists, which is why that gap stayed open while everything else got finished.

## Do not

- Do not restart the $99 / $199 tiering debate without first naming the buyer. Those numbers were reasoned for one product and one customer, and there are two of each.
- Do not treat Agile as a validation of demand. It is Noam's own management client.
- Do not sell leasing services outside Ontario pending a real legal answer.
