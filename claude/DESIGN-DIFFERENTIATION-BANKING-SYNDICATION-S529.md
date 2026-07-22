# DESIGN — Best-of-breed without the fees: banking + syndication differentiation (S529)

Session 524, 2026-07-20. Noam's brief: Vacantless must be best-of-breed and slick for small
landlords; we cannot pay Flinks/Yodlee and cannot get RentSync's ~50 portal connections; use the
limitations to our advantage; beat FreshBooks / Buildium / Xero / QuickBooks for landlords
specifically; saving landlords money and time with syndication is key.

## The core position: the pipe is a commodity, the ledger is the moat

FreshBooks, QBO, and Xero all have bank feeds — and landlords still churn off them, because after
the feed lands they are staring at generic categories with no concept of a unit, a tenancy,
principal-vs-interest, or a T776 line. Nobody buys a bank connection; they buy "my books are
done and my accountant is happy."

We already shipped the part they can't cheaply copy: a ledger that is NATIVELY per-property,
rent-aware, rail-deduped (bank deposit LINKS to the already-recorded rail rent, never
double-records), and files onto real T776 lines with mortgage principal correctly memo'd.
The strategy is not to match Flinks connection-for-connection; it is to make every ingestion
path land in the smartest landlord ledger in Canada.

Positioning line (marketing, when GTM unfreezes): **"Your books, done the landlord way — with
any Canadian bank, no credentials shared."**

## Pillar 1 — banking: coverage through paths, not aggregators

Four ingestion paths, each already partly live, ranked by trust posture:

1. **Rails first (zero-feed data).** Rent collected through Stripe PAD / Rotessa is native data —
   no feed needed at all. Every org we move onto on-platform collection shrinks its bank-feed
   problem to expenses-only. Keep pushing collection adoption as the accounting on-ramp.
2. **Plaid for the majors (live sync, Growth).** Already built and production-proven. Big-five
   coverage is what most landlords need for live sync.
3. **OFX/QFX/CSV as a first-class citizen, not a fallback.** Every Canadian bank and credit card
   exports these. Flip the frame: "works with EVERY institution in Canada, and your bank
   credentials never touch an aggregator" — a privacy pitch AND a coverage pitch. With the
   shipped rules engine (FreshBooks seed + payee rules + S527 picker + retroactive sweep), a
   monthly file drop is minutes. Build investment to make it sing: drag-drop, auto-dedupe vs prior
      imports (the dedupe rail exists), and a "caught up through <date>" marker per account.
4. **NEW — e-Transfer email capture (the uniquely Canadian move), BOTH directions.** Most small
   landlords get rent by Interac e-Transfer — and PAY their trades (cleaners, painters,
   gardeners) the same way [Noam, 2026-07-19, approved]. Every e-Transfer produces a
   notification email. Parse a forwarded (later: auto-forwarded) notification →
   RECEIVED = suggest a rent payment against the right tenancy; SENT = suggest an expense with
   the category prefilled from the org's payee rules (the S527 "always categorize <payee>"
   rules pay off again here — Maria's Cleaning auto-suggests Cleaning on every future capture).
   Money in AND money out tracked with ZERO bank connection of any kind. None of FreshBooks /
   Buildium / QBO / Xero does this. Scoping in Appendix A; full ticket
   `claude/CODEX-BUILD-ETRANSFER-CAPTURE-S530.md`.

Inverite stays the pay-per-use fallback if a client truly needs live long-tail sync. Flinks
stays dead.

**The trades-payment completeness story (Noam, s524):** landlords pay cleaners / painters /
gardeners three ways, and every one has a capture path — credit card or debit via the feed/file
path + payee rules (LIVE), e-Transfer via S530 (IN BUILD), cash/cheque receipts via the live
email-in photo capture (LIVE). Once S530 ships, "however you pay, the books stay done" becomes a
marquee claim. Marketing translation lives in `MARKETING-COMPETITIVE-POSITIONING-2026-07-20.md`.

**Against the accounting incumbents,** the sell is: landlord-native categories and T776 output
(they need mapping gymnastics), rent-aware reconciliation (they double-count rail rent),
per-property P&L out of the box, flat $249 with tax package included (they charge per-org plus
an accountant's cleanup hours). The accountant hand-off export (already roadmapped,
export-first) completes the "fire your spreadsheet, keep your accountant" story.

## Pillar 2 — syndication: own the operator's hands, not the portals' APIs

RentSync-style server-side syndication needs partnerships we can't get and money we shouldn't
spend — and the channels small landlords actually use most (Kijiji, Facebook Marketplace) have
NO public API anyway (Meta killed rental partner feeds in 2021 — KI755). The incumbents are
structurally weak exactly where our ICP posts. So we don't buy integrations; we make the
operator's own posting 10x faster and smarter:

1. **Feeds where feeds exist.** The feed render + RentFaster channel are live. Keep adding
   feed-accepting channels opportunistically (liv.rent card is already on the backlog).
2. **NEW — posting-assist extension, advanced from copy-assist to autofill.** The
   DISTRIBUTION-SIDECAR-SPEC design lock already establishes the honest, policy-safe posture:
   the extension NEVER auto-submits; the operator is present; every write happens on user
   gesture. The advance: from "Copy next field" to per-field FILL on the operator's click, with
   photos staged and the tracked link inserted. "Post everywhere in five minutes" with zero
   partnerships and zero per-listing fees. Scoping in Appendix B.
3. **The loop the incumbents don't close.** We already have proof-before-Live, refresh-due
   nudges, and per-channel lead attribution wired to outcomes. RentSync syndicates and goes
   silent; Vacantless tells the landlord which channel produced the lead that actually leased
   the unit. Attribution is the retention hook — keep it front and center in the cockpit.

Positioning line: **"Every channel that matters, posted in minutes, with proof — and you'll know
which one leased the unit."**

## The differentiators to push (the busy-SaaS-class answer)

- **The leasing loop** — inquiry → pre-screen → booking → reminders → renter confirm → at-risk
  board → outcome. FreshBooks has none of it; Buildium's is enterprise-clunky; ShowMojo charges
  more than our whole Growth tier for showing coordination alone.
- **Canadian-native compliance** — N4s, Ontario guideline rent increases, T776. Buildium thinks
  in Schedule E; the generic books think in nothing.
- **Flat honest pricing** — $99/$249 flat vs per-unit pricing plus junk fees; applicant-pays
  screening keeps our costs (and the landlord's) at zero.
- **Honest automation as brand** — the S528 posture: the operator always knows what sends, what
  is only prepared, and what is live vs submitted. "Software that never surprises your tenants"
  is a real position in a category full of spooky automation.

## Sequencing (recommendation)

Near-term build order, consistent with build-ahead-of-demand and the current Premium track:
1. Finish Premium sell-readiness first: **Slice D (CCA)** + **accountant hand-off export** —
   they close the "$249 is obviously worth it at tax time" story that pillar 1 sells.
2. **e-Transfer capture** (Appendix A) — highest new-ingestion leverage, mostly reuses the live
   ingress + rent-safety rails.
3. **Posting-assist extension MVP** (Appendix B) — the syndication unlock; pairs with GTM
   unfreezing since it is a marquee demo.
4. **Market-rent tool** stays the anti-commodity differentiator on the leasing side (needs the
   comps-source decision first; unchanged).

---

## Appendix A — build scoping: e-Transfer email rent capture (ticket-grade sketch)

**What:** a landlord forwards (v1) an Interac e-Transfer notification email to their existing
per-org ingest address (`u-<token>@in.vacantless.com`) → Vacantless parses {name, amount, date,
direction} from the body → files a PENDING suggestion: RECEIVED = "looks like rent from <name>"
matched to a tenancy (S519 likely-rent classifier); SENT = "payment to <payee>" as an expense
with category/unit prefilled from the org's payee `categorization_rules` (S527) → the landlord
confirms one tap in the dashboard → records via the same claim-first paths as manual logging.
NEVER an unattended write. Double-count guard both directions: a later bank-feed deposit LINKS
to the recorded rent (existing S519 rail rule); a later bank-feed debit LINKS to the
capture-created expense via the existing `expenseMatchCandidateForTransaction` helper rather
than creating a duplicate.

**Reuse (all live):** the S384 ingress rail (`lib/email-ingest.ts`: webhook auth, token→org,
per-org sender allow-list, loop-drop, dedupe — layers 1–3,5,6 unchanged) + Postmark/MX + the
S519 rent-suggest safety classifier (likely-rent only, amount/timing windows) + the S518/S527
reconcile single-source invariants.

**The one design departure to flag loudly:** today's ingress deliberately IGNORES email bodies
(attachment-only, PII posture). e-Transfer capture is a body-parse feature, so it needs a new
ingress class with its own guardrails: parse ONLY messages whose From matches Interac notify
domains AND whose recipient token + sender allow-list pass as today; extract ONLY
{payer name, amount, date}; never store the raw body (parse-and-discard, keep the parsed triple +
hashed message-id). Fail-closed: anything not confidently an e-Transfer notification → drop
(or asset-capture path if it has an attachment).

**Shape (est. 6–8 files, additive; 1 small migration for the pending-suggestion table or reuse
of an existing pending-capture pattern):** pure `lib/etransfer-ingest.ts` (sender-domain check +
body parser + match-to-tenancy proposer, unit-tested) · branch in `app/api/inbound/asset`
routing (or a sibling route) · pending-suggestion card on the rent surface · confirm action
reusing the existing record-rent path. Premium or Growth gating: recommend **Growth** (it feeds
collection adoption) with volume caps, revisit later.

**Not in v1:** auto-forward rules setup UX (mail-client filters doc instead), auto-deposit
matching to bank feeds (the reconcile rail already links when a feed exists), non-Interac banks'
notification formats beyond the common Interac template set.

## Appendix B — build scoping: posting-assist extension MVP (ticket-grade sketch)

**What:** advance the existing sidecar design from copy-per-field to fill-per-field. Operator
opens Kijiji / Facebook Marketplace / Zumper's posting form, opens the Vacantless side panel,
picks the unit → the panel shows the channel-tailored kit (title, body, price, tracked link,
photos sized) → each "Fill" button writes that field into the page ON CLICK; photos stage via
the file-picker with a one-click copy path. The extension NEVER clicks Post/Publish — the
design-lock rule stands. After the operator posts, the panel's existing "mark posted + paste ad
URL" proof flow records it, feeding live coverage + refresh nudges + attribution.

**Reuse:** DISTRIBUTION-SIDECAR-SPEC.md (design lock: no auto-submit, user-gesture writes),
S482 browser co-pilot transport, per-channel copy already generated per listing, pre-reserved
tracked links (mig 0144), the proof/attribution loop.

**MVP scope:** 2 channels (Kijiji + FB Marketplace — the no-API giants), field mapping per
channel maintained as data (selectors WILL rot; ship a "mapping stale? copy mode still works"
fallback so the extension degrades to today's copy-assist, never breaks), Chrome only,
unlisted→listed Web Store track. Entitlement: Growth+ (`listing_marketing` adjacent).

**Risks to own up front:** portal DOM churn (mitigated by copy-mode fallback + mapping-as-data),
Web Store review time (start early, ship unlisted to Noam first), FB pacing/anti-fraud rules
still apply (KI756/757 — the extension doesn't change posting cadence policy).

---

*Written 2026-07-20 (s524). Companion docs: `claude/DESIGN-ACCOUNTANT-HANDOFF-AND-INTEROP-
ROADMAP-2026-07-19.md` (pillar-1 finish), DISTRIBUTION-SIDECAR-SPEC.md (repo, pillar-2 design
lock), `codex-handoffs/AUDIT-UI-OPERATOR-PASS-S528.md` (the polish track). Full Codex tickets
get cut when Noam picks a lane.*
