# DECISION S695: syndication pricing, and the tier above it

Date: 2026-09-10 (Session 695, after the wrap). Answers open question 1 of `DECISION-S694-SYNDICATION-BECOMES-A-PAID-ADDON-COLLECT-ONCE-ONE-BUTTON.md`. Opens a second lane that is worth more than the first.

## Settled

1. **The unit is a vacancy, not a month.** One charge per vacancy, covering until leased or 60 days. Per-month-while-vacant pays the business more the longer the unit sits empty, which inverts the product's own claim. It also matches the cost structure: 107 of 111 publish attempts end at a human, so cost accrues per post attempt, not per calendar month.
2. **Site fees pass through at cost, never marked up.** Kijiji is $33.84 or free depending on whether that account's single Owner slot is in use; Zumper is free to 5 live; Rentals.ca free to 3 active. Those vary per account, so a markup makes the confirmation screen wrong or dishonest, and that screen naming real dollars is what makes the one button trustworthy.
3. **Free route versus paid route: writing is free, posting is paid.** The ad writer, the public `/r/` listing page, the tracked link and the lead funnel stay in the base tier. Putting the ad on sites is the add-on. This is already the shape of the code (`listing_marketing` entitlement plus `CONCIERGE_DESK_ENABLED`), so adopting it costs nothing.
4. **Only sites we can reach are sold.** Viewit and RentFaster stay out of the add-on until they post. Rentals.ca answers Cloudflare 403 to Vercel egress and runs from the Mac.
5. **Two tiers, per vacancy (Noam, 2026-09-10, superseding the single $99 syndication price filed earlier the same day).**
   - **$99: the showing engine.** The booking link, reminders, confirmations, outcome capture and the renter-facing page. Noam's words: "the showing hero part of the site".
   - **$199: everything, including full syndication.** He floated $249 "or $199 whatever".

   **Recommended: $199, not $249.** Anchor is the leasing agent's fee, roughly half a month, about $625 on a $1,250 Windsor one bedroom. $199 is 32% of that and sits under the $200 line; $249 is 40% and starts reading as agent-replacement pricing, which invites agent-level expectations on a service whose delivery is a human 107 times out of 111. The $100 gap between tiers is also a cleaner story: double it and we do the ads too.

   **The structural caution on this split.** It prices the least reliable component highest. The showing engine is built, working, and ours end to end. Syndication depends on portals that block automation, sessions that die silently, and a person behind the button. Putting syndication in the premium tier means the premium promise is the fragile one. That is survivable, but the upgrade pitch should sell effort removed rather than certainty, and the $99 tier should be able to stand alone as a product.

## The willingness-to-pay signal, from Noam, 2026-09-10

> "I have been handling the ads for Agile with your help but would gladly push Agile to pay an extra $99 for ads to be handled for us. I would even pay more for lead follow up."

This corrects the assumption in the pricing analysis that Agile would not buy because Aaliyah does it in house. **Agile is a buyer at $99.** That changes validation: the first paying customer is the anchor account, not an outside landlord, so the price can be tested without finding a new customer first.

**The more important half is the second sentence.** He would pay more for lead follow-up than for ads. That is consistent with the measurement in `FINDINGS-S694-THE-FUNNEL-DIES-AT-THE-SHOWING.md`: 244 leads, 105 showings, 20 attended, 0 applications ever. Syndication fills the top of a funnel whose failure is further down. **The tier above ads is worth more because it addresses the part that is actually broken.**

## The lead follow-up lane, REFRAMED by Noam 2026-09-10 after the first draft of this doc

**The auto-answer idea is dead and should not be revived.** Noam:

> "It would only be helpful if you could answer the messenger ads for me so I think that part is a dead end. Leads end up in the operators email and they take it from there and then need to update the dashboard or tenant profile to keep it up to date."

Facebook Marketplace is where his volume is ("I got tons of interest via FB Marketplace", S683) and it lands in his personal Messenger, which cannot be delegated or read by us. An auto-responder that cannot cover Messenger answers the minority of enquiries, so the feature fails at its own premise. **Do not propose an automated lead answerer again.**

**The real problem is double entry.** The operator resolves the lead wherever it arrived, in email or Messenger, and then has to go to the dashboard and re-enter what happened to keep the record and the tenant profile true. When they do not, the system's picture is stale.

### The measurement, Agile org, 2026-09-10 via SQL

| `showings.outcome` | Count |
|---|---|
| cancelled | 48 |
| attended | 18 |
| auto_closed (nudged, never answered) | 13 |
| null (2026-05-11 to 2026-06-26, pre-outcome-system) | 15 |
| no_show | 6 |

Two findings, both new:

1. **The double entry is quantified and the loss is 46%.** The system sent an outcome nudge 28 times. It got an answer 15 times (18 attended minus 9 recorded another way, plus 6 no_show). The other 13 auto-closed with the outcome known only to a human. That is the exact pain Noam named, measured.
2. **The funnel's biggest single loss is CANCELLATION, not attendance.** 48 of 100 showings were cancelled before anyone arrived. `FINDINGS-S694-THE-FUNNEL-DIES-AT-THE-SHOWING.md` and every restatement since, including in this session, have said the funnel dies at the showing. It dies earlier, between booking and arrival. **Separate the two problems before building for either.** Note the carried fact that cancelling a viewing in the dashboard sends the renter nothing.

### Why this is the cheap lane

The rail already exists: `showings.outcome_token`, `outcome_nudge_sent_at`, `outcome_nudge_count`, and a token link that lets an operator answer without opening the dashboard. It converts at 54%. **Raising that conversion is cheaper and more certain than building the Kijiji email ingest parser**, and it is independent of Messenger, because it acts on what the operator does after the conversation rather than trying to read the conversation.

The Kijiji ingest parser (`CODEX-PROMPT-S306-INGEST-KIJIJI-LEAD-EMAILS.md`, specified S306, never built) is still worth doing for lead *capture* and attribution, but it is no longer the first step of this lane and it was never going to enable auto-answering.

Lead arrival today, for the record: Kijiji replies go to `rentals@agileonline.ca` (Aaliyah's inbox, 1,032 enquiries historically, not in the app); Marketplace goes to Noam's personal Messenger and cannot be delegated; Zumper leads go to the Zumper account email and never enter Vacantless; only Rentals.ca reaches the funnel, because the worker fills `u-...@in.vacantless.com` as the contact email.

## Open

- Whether both tiers are per vacancy. The unit argument in point 1 applies to both and Noam has not said otherwise, but he has not confirmed it either.
- Why 48 of 100 showings cancel. Nobody has looked. This is the largest measured loss in the funnel and its cause is unknown.
- Whether the outcome nudge fails because of timing, channel, wording, or because the operator is not the right person to ask.
- Whether the tenant profile can be kept current from artifacts that already exist (Calendly booking, application, lease) rather than from an operator typing.

## Do not

- Do not build an automated lead answerer. Marketplace is the volume and it is unreachable. Settled 2026-09-10.
- Do not flip `SMS_LIVE` or any org's `sms_enabled` to demo any of this. A2P sole proprietor status was granted 2026-09-03; both gates are still ours and need an explicit go.
- Do not let any automated message state a pet, utility or price fact that is not on the record. A utility line is a landlord fact and is never inferred.
- Do not repeat "the funnel dies at the showing" without saying cancellation first.

## SUPERSEDING DIRECTION, Noam 2026-09-10 end of session: rent collection is the spine, syndication is the edge

Noam, after settling that he wanted a subscription rather than per-vacancy pricing:

> "That was why I thought about the PAD payments (Rotessa and/or Stripe) as being something else built in that would make a subscription worthwhile that also eventually helps with tax season."

**This reorders everything above it.** The tiering debate in this doc priced syndication as the product and showings as the base. Under this direction:

- **Always on, justifies the subscription every month:** rent collection by pre-authorized debit (Rotessa and/or Stripe), **expenses tagged to the unit** (Noam: "and the FreshBooks part of it too"), the tenant record kept current, and the year-end package that falls out of both.
- **When a unit turns:** leasing, showings, the booking and outcome loop.
- **The acquisition edge, top tier:** syndication.

**Why this is right.** A subscription needs a reason to exist in a month with nothing vacant, and showings alone do not provide one. Rent collection does, and it is the stickiest thing in the product: once a landlord's tenants are on PAD through Vacantless, leaving means re-papering every tenant. It also makes the unit of pricing obvious. A door either collects rent or it does not, so **per door per month** follows naturally, which fixes the problem that $199 works for Agile's ten doors and is absurd for Abbas's two.

### State of the rail [verified 2026-09-10 via SQL]

**Built and cold.** The schema is modelled properly and nothing runs on it:

- `tenancies` carries 17 Stripe and Rotessa columns (`rotessa_customer_id`, `rotessa_schedule_id`, `stripe_subscription_id`, `stripe_mandate_status`, `stripe_setup_session_id`, sync stamps, and more).
- A `rotessa_accounts` table exists. `organizations` carries `stripe_customer_id` and `stripe_subscription_id`.
- **22 tenancies across 7 orgs. Zero on Stripe. Zero on Rotessa. Zero active mandates. Not one dollar has moved through it.**

### The money stack is BUILT, ran once, and stopped at triage [verified 2026-09-10 via code read + SQL]

**CORRECTION.** An earlier draft of this section said the problem was capture rather than storage, and recommended solving capture. **That was wrong. Capture is built and it worked.** Noam: "we built a connection to banks / credit cards to pull expenses per unit that can be tagged per unit (it never worked 100% as certain software left out certain credit cards in Canada and US without heavy costs) but we got it pretty far. And then it also allows uploads."

**What exists in `vacantless-app` today:**

- Dependencies `plaid` and `react-plaid-link`. `lib/bank-feed/plaid.ts`, `lib/bank-feed/index.ts`.
- `lib/bank-import/ofx.ts` and `lib/bank-import/index.ts`: the file-upload fallback for cards the aggregator does not cover.
- `lib/categorization-rules.ts`. Migrations `0058_bank_feed`, `0059_categorization_rules`, `0104_bank_import`.
- `app/dashboard/expenses/` with `PlaidConnectButton.tsx`, `import-actions.ts`, `triage-core.ts`.
- `app/dashboard/money/` with `income-statement`, `reconcile`, `spend`, `import-history`, **`tax-package`** and **`accountant-package`**.
- `lib/rent-from-bank.ts`, `lib/rent-receipt.ts`, `lib/income-statement.ts`, `lib/reconcile-assign.ts`, `lib/statements.ts`.

**What actually ran:**

| Table | Rows | Orgs | Last activity |
|---|---|---|---|
| `bank_connections` | 2 | 2 | 2026-07-05 |
| `bank_transactions` | **112** | 2 | 2026-07-05 |
| `categorization_rules` | **1** | 1 | 2026-07-05 |
| `categorization_import_batches` | **0** | 0 | never |
| `expenses` | 11 | 1 | 2026-07-20 |

**The diagnosis.** On one day in July, two orgs connected banks and 112 real transactions arrived. Eleven became unit-tagged expenses. The other hundred sat. **The bottleneck is TRIAGE, not capture:** turning a bank line into a unit-tagged, categorized expense. With exactly one categorization rule on file, every transaction required a human decision, which is the data-entry problem the feed was supposed to remove. **The rules engine is the part that was never really built out.** The OFX upload path, the answer to the card-coverage gap, has never been used once.

**Do not rebuild FreshBooks, and do not rebuild this either.** What FreshBooks and QuickBooks do badly for landlords is the only part needed: they organize around clients and invoices, and a landlord needs expenses per door. That slice is already coded.

**The next move is not a build.** Reconnect Agile's accounts, pull the transactions, and drive triage on a real ten-door portfolio until it either produces a clean income statement or shows exactly where it breaks. That is one session and it would settle more than any design work. Expect the answer to be about categorization rules and per-unit assignment, not about the feed.

**Why this is the retention hook.** A Canadian landlord filing a Statement of Real Estate Rentals (T776) needs gross rents and expenses per property. If Vacantless holds both, year-end is close to mechanical and leaving in November costs the landlord his year. Syndication creates no equivalent switching cost. Note that `money/tax-package` and `money/accountant-package` already exist as surfaces, so the year-end deliverable is not hypothetical either.

### The pilot is already scheduled

Mahmood Foadghazni, 1 Bloor St E Unit 3701, org `f7d00035`, $3,800 a month, single active tenancy. Tenants prepaid through December 2026, so **the first month needing real collection is January 2027**, and a reminder fires 2026-11-24 to get the mandate live with lead time. That is the first live test of the rail and it needs no new customer.

### Cautions

- **Money movement is heavier than posting ads.** Failed payments, NSF, and a landlord expecting funds on the first. The concierge move that makes syndication work today, quietly putting a person behind the button, does not translate to money.
- **Before scaling beyond Noam's own units, get a real answer on what handling tenant rent implies for trust accounting and registration in Ontario.** That is a question for his lawyer or accountant. Not a Claude judgment and not to be guessed at in a doc.
- Everything above this section about tier numbers ($99 / $199 / $249) was reasoned with syndication as the base. **Re-run those numbers per door under this direction before quoting anyone.**

## Adjacent ideas, deliberately ranked BELOW the spine

### Virtual staging for empty photos (Noam, 2026-09-10)

> "We were going to offer via API with ChatGPT or via your API virtual staging for empty photos."

- **Not Anthropic's API.** It does not generate images. This needs an image API (OpenAI's, or a real-estate-specific staging service). Do not write "Claude stages the photo" into any plan.
- **Not built.** No staging, no image generation, no AI SDK in `vacantless-app` dependencies [verified 2026-09-10 via code read]. Photo plumbing does exist: `lib/photos.ts`, `lib/image-url-import.ts`, `lib/photo-upload-modal-focus.ts`.
- **Disclosure is a hard constraint, not a setting.** Noam is a licensed Royal LePage agent, so RECO advertising rules attach to him personally, and portals have their own photo rules. Every staged image carries a visible "virtually staged" label, always, with no option to switch it off.
- **Scope limit: add furniture to an empty room, nothing else.** The moment the feature can remove a stain, change a finish or hide damage it is misrepresentation, and it is a licence at risk rather than a software bug.
- **Placement:** a listing-quality feature, so it belongs in the top (syndication) tier, with the per-image API cost passed through or covered by an allowance.

**Ranking, stated plainly so it is not lost:** this sits below the money spine and below fixing the funnel. It improves ads at the top of a funnel that already produces 226 leads and fails downstream (93% never click through, 48 of 100 showings cancel, 112 bank transactions yielded 11 tagged expenses). Good upsell, cheap to add, not the constraint on the business.
