# Pillette one-bedroom pricing rule (confirmed by Narayan, 2026-08-31)

Narayan, in writing, closing the Unit 3 price conflict:

> Sorry on the fluctuation on the pricing for unit# 3. I think the $1250 is a
> more attractive pricing, no balcony and on the main floor.
> Will keep the $1275 for the balcony units (one bedroom).

## The rule

- **833 Pillette one-bedroom WITH balcony: $1,275**
- **833 Pillette one-bedroom WITHOUT balcony: $1,250 or below**, priced down by floor and finish
  (Unit 20 $1,195 second floor, Unit 33 $1,225 third floor, Unit 3 $1,250 main floor no stairs)
- 833 Pillette two-bedroom (Unit 36, 600 sqft, third floor): **$1,450 plus hydro**
- All Pillette rents are plus hydro; heat and water included

## Why the Unit 3 conflict happened

On 2026-08-18 Narayan confirmed $1,275 for Unit 3 in red ink. On 2026-08-31 his vacancy schedule read
$1,250. Both were his own word, thirteen days apart, and the live ad carried $1,275.

The database had already encoded the rule nobody had stated. Every property at $1,275 in the Agile
org is a balcony unit:

| Unit | balcony | rent | status |
|---|---|---|---|
| 22 | true | $1,275 | off market |
| 27 | true | $1,275 | off market |
| 30 | true | $1,275 | off market |

Unit 3 has `balcony = false` and was carrying the balcony price. The August 18 confirmation was the
balcony rate applied to a non-balcony unit.

**Generalisable lesson:** when a landlord's two written statements conflict, check whether the data
already separates them on some attribute before asking him to choose. The attribute here (balcony)
explained both numbers and neither was a mistake in isolation. Asking for the RULE rather than the
NUMBER is what surfaced it.

## State as of 2026-08-31

Unit 3 is live at $1,250, sqft corrected 550 to 500, and the hardcoded "Available August 1" line
removed from its description. No balcony unit is currently vacant, so the $1,275 rate applies to
nothing on the market today.

Pricing remains Narayan's and Aaliyah's lane. This document records what he decided; it is not a
mandate to re-open the question.

## Related

- `claude/FINDINGS-S309-TWO-DEAD-ENDS-ONE-MISSING-FIELD.md`
- Migration `0223_offmarket_shows_referral_page.sql` (commit `8bc5a9f`)
- WORKFLOW 236 in `WORKFLOW.md` (reconcile the live listings against the vacancy schedule)
