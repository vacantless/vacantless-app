# S412 batch — Distribution cockpit, Slices 2-6

Date: 2026-07-04
Repo: `vacantless-app` on `main`
Review target: the S412 batch commit (this note is committed in it), on top of the
already-accepted Slice 1 (`ed1cd0c`).
Migrations: `0105_distribution_runs`, `0106_distribution_partner_accounts` — BOTH
already applied to prod DB (Supabase ref `nvhvdyxpyogvadpjlvij`). Additive + inert
(zero rows until used), so the DB safely leads the code until deploy.

This is one batch of five slices building on the Slice 1 Distribute command
center. Every slice: a pure lib (unit-tested) + presentation. No public/anon RPC,
no cron, no money, no PII, no external LLM. Honest framing throughout (assisted-
manual only; feed notes are candidates, never a partner claim).

## Slice 2 — Guided launch runs (`lib/distribution-run.ts`, migration 0105)
A saved, resumable posting session. `distribution_runs` + `distribution_run_items`
(org-denormalized RLS on `user_org_ids()`, cascade with org/run, one item per
`(run, channel)`). Pure lib: per-channel step checklist derived from the matrix
(broker route reads differently; Facebook carries its unique-photo/QR note; a
gotcha step only when guardrails exist), `runProgress`, status vocab. Server
actions `startDistributionRun` / `updateRunItem` / `addRunChannel` /
`cancelDistributionRun` (all in `app/dashboard/properties/actions.ts`). KEY REUSE:
marking a channel **done with a live URL** produces/refreshes that channel's
`listing_posts` row (via the SAME `validateListingPost` path) and links it, so a
run feeds source attribution + the Slice-1 cards — no parallel tracker. One active
run per property (reused on start). `app/.../launch-run-panel.tsx` renders it.
Also folded in **reply snippets** (`lib/reply-snippets.ts`): Facebook DM replies
tell the renter to copy the link into their browser (KI590); other channels link
directly; shown per assisted/feed channel card.

## Slice 3 — Feed-partner onboarding (`lib/distribution-partner.ts`, migration 0106)
`distribution_partner_accounts` — ORG-level, one per `(org, channel)`, for the
partner-capable channels only (rentals_ca/zumper/viewit/realtor_ca/other;
Facebook + Kijiji excluded by the check constraint — assisted-only). Pure lib:
status vocab (`not_started/submitted/accepted/rejected/paused`) + tone +
`partnerNextStep`. Server action `upsertPartnerAccount`. Surfaced + edited from the
feed-eligible channel cards (Rentals.ca/Zumper) — the status chip + next step + a
setup form (feed URL, contact, dates, notes). `isPartnerActive` gates the honest
"accepted vs feed-ready" distinction.

## Slice 4 — Distribution analytics (`lib/distribution-analytics.ts`, no migration)
Reads only existing leads + `listing_posts`. Aggregates leads up to the PORTAL via
`listing_post_id` (an unknown/absent post id → "Direct / untracked"), counts those
that advanced past inquiry (booked/showed/applied/leased), days-live from the
most-recent live post, and a pure `channelSuggestion` next-action. Rendered as a
"What's working" table at the bottom of the Distribute tab. No ad-spend assumptions
(cost-per-lead deferred until spend is recorded).

## Slice 5 — Listing quality layer (`lib/listing-quality.ts`, no migration)
Rule-based, NO LLM. `scoreListing` (weighted 0-100 + grade), `fairHousingLint`
(flags wording that risks the Ontario Human Rights Code protected grounds —
conservative regex rules, "no pets" intentionally NOT flagged; labeled "guidance,
not legal advice"), `missingDetails` (persuasive details a strong ad usually
mentions). Rendered as a collapsible "Listing quality" panel in the Distribute
header. **Scope note:** the LLM-dependent plan items (freeform semantic rewrite,
learned quality model) are deliberately NOT built — per-portal rewrite already
exists (`lib/listing-copy`); this ships the deterministic core with no model/cost
dependency. Flag for a later cost/model decision.

## Slice 6 — Post-publish QA checker (`lib/post-publish-qa.ts` + `qa-checker.tsx`)
`checkPastedAd` compares OPERATOR-PASTED ad text against the listing: right city,
rent shown (comma-tolerant), required hydro + unfurnished disclosures, booking
link, phone/email, plus Facebook link-risk + Kijiji location-pin tips. **It never
fetches or scrapes the portal** — reads only what the operator pastes. `qa-checker.tsx`
is a small CLIENT component running the pure checker live in the browser (no server
round-trip, no persistence). Rendered as "Check your posted ad" on each channel
card. `city` is best-guessed from the address's 2nd comma segment.

## Intentional-by-design (please don't "fix")
- Runs produce `listing_posts` rows on done-with-URL (reuses attribution; not a
  duplicate tracker). Marking done WITHOUT a URL is allowed (posted, link not
  captured).
- Partner accounts are ORG-level but edited from any listing's feed card.
- Analytics has no cost-per-lead yet (no spend data source).
- Quality layer is rule-based on purpose (no LLM); fair-housing is guidance.
- QA checker reads pasted text only (portal scraping is out of scope + restricted).
- The Slice-6 QA checker is the one CLIENT component; everything else is server +
  the existing CopyLink/CopyTextButton client islands.

## Verification (here)
- `npx tsc --noEmit` clean. `npx next lint` on all 11 changed files: clean.
- New unit tests: distribution-run 38/0, reply-snippets 12/0, distribution-partner
  19/0, distribution-analytics 26/0, listing-quality 25/0, post-publish-qa 24/0.
- Regressions: distribution-channels 79/0, listing-distribution 66/0,
  listing-marketing 26/0, booking 40/0.
- Slice 1 was already live-smoked + Codex-accepted (`ed1cd0c`).
- **Batch live-smoked on North Star QA (prod `c447679`, 833 Pillette):** started a
  launch run (Facebook + Kijiji) -> the run rendered channel-specific step
  checklists (Facebook got the unique-photo/QR note + its gotcha count; Kijiji got
  "cover photo first"); marked Facebook **Done** with a live URL -> the header
  flipped to "1 channel posted", progress advanced to "1 of 2", the run produced a
  `listing_posts` row + its tracked `?p=` link, AND the Facebook channel card below
  flipped to **Posted** (the run-to-attribution reuse, proven end to end).
  Slice 3: Rentals.ca + Zumper show "FEED PARTNER · Not started" + next step +
  setup form. Slice 4: the "What's working" table showed Direct/untracked 3 leads /
  1 advanced + Facebook live 0 leads, each with its suggestion. Slice 5: the
  quality panel = Fair 75/100 + "Strengthen" + the missing-detail list. Slice 6:
  the QA checker ran live on a pasted ad -> "3 to fix, 3 to check" with correct
  severities (city/rent/booking-link critical, hydro/furnishing/phone warning,
  email + Kijiji-pin tips). Then WIPED QA back to baseline (0 runs / 0 items /
  0 posts / 0 partner rows) [verified execute_sql].

## S412b — Codex batch review follow-up (both P2s fixed)

Codex reviewed `ed1cd0c..c447679` and raised two P2s; both fixed in this commit.
No migration, no env, no pure-lib change (actions.ts only).

**P2 #1 — cross-org write via a tampered `property_id`.** The run/listing_post
writes took `property_id` straight from the form while `organization_id` came from
`getCurrentOrg()`, so a foreign UUID could create an org-A row pointing at an
org-B property (and the public lead RPC resolves tracked posts by
`listing_posts.property_id`). Fix:
- New `ownedProperty(supabase, propertyId)` helper — selects the property under
  RLS (`properties` is scoped to `user_org_ids()`), returns `{id, organization_id}`
  or null. `startDistributionRun` + `addListingPost` (the pre-existing path had the
  identical latent bug) now call it and abort with `?forbidden=1` if null, and use
  the **property's** org as the authoritative `organization_id`.
- `updateRunItem` no longer trusts the form: it re-selects the item's RUN under
  RLS and derives `property_id` + `organization_id` from the run for the
  `listing_posts` write + the redirect. `addRunChannel` + `cancelDistributionRun`
  likewise re-select the run under RLS (abort if null) and derive the property.
  So a `listing_posts` row can no longer be created with mismatched org/property
  through any of these paths, and the public RPC can't be fed a cross-org post.

**P2 #2 — duplicate `listing_posts` for an already-tracked channel.** Marking a
run channel done inserted a NEW post whenever the run item had no `listing_post_id`
— even if Slice 1 already had a live post for that channel. Fix: before inserting,
`updateRunItem` looks up the most-recent **non-removed** `listing_posts` row for
`(property_id, portal)` and, if found, UPDATES + links it instead of inserting.
So "already-tracked Facebook, then guided-launch Facebook done" reuses the one
tracker (no duplicate card/link), honoring the same-tracker promise.

Verification: `tsc` clean, eslint clean on `actions.ts`, existing 144 lib tests
unaffected (actions.ts is not unit-tested). **Dedupe live-smoked on North Star QA
(prod `9c9e07c`):** seeded a Facebook `listing_posts` row via SQL (a Slice-1
tracker), then started a guided launch and marked Facebook done with a DIFFERENT
URL. Result [verified execute_sql]: `facebook_post_count = 1` — the run UPDATED the
seeded post (its url became the new value) instead of inserting a second, and the
run item linked to that same post. QA wiped to baseline afterward. The P2#1 guard
is enforced by the RLS-scoped `ownedProperty` / run re-selects (a tampered foreign
`property_id` returns null and the action aborts with `?forbidden=1`).

## Not built (parked, spec'd separately)
Browser sidecar extension (`DISTRIBUTION-SIDECAR-SPEC.md`) — a separate Chrome
extension repo + Web Store policy review; must be user-driven, no scraping /
auto-submit / credentials / anti-bot bypass. External partner proof (plan S415) —
needs a real partner agreement.
