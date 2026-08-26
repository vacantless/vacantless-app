# DESIGN - Distribution reset: headless-first launch experience (S279)

Date: 2026-08-26
Status: product/architecture reset plus source/UI Gate 1 and Gate 2 implementation; no DB, provider, worker, payment, portal, live-send, or deploy gate
Author: Codex, after Noam corrected the old guided framing

## Why this reset exists

Distribution started as guided posting, browser co-pilot, and concierge handoff. That was the right
bootstrap path when Vacantless did not yet own portal execution. The product has since evolved:
Claude and Codex built a standalone Playwright worker, mapped the major portals, added account
authorization, added spend-authorization scaffolding, added Relist Radar expiry reminders, and added
lease-up takedown substrate.

The problem is that the product language and mental model still expose the build history. Every
iteration layered more terms on top of the previous one: guided, co-pilot, concierge, desk,
autopilot, worker, publish everywhere, relist radar. The result is less clear than the product
deserves.

Noam's direction is now the source of truth:

- One listing is created in Vacantless.
- The listing has every field, photo, link, account, proof, cost, and compliance requirement needed
  for all selected distribution destinations.
- Account sign-in is handled once and feels seamless.
- The user clicks once or twice at most to launch.
- Headless or API execution happens behind the scenes.
- Paid channel costs are explicitly authorized and passed through to the landlord.
- Vacantless keeps the listing live with expiry reminders/refreshes until it leases.
- Takedown is part of the same dashboard, not a separate cleanup chore.

Guided/manual posting is no longer the product center. It is an exception path for channels that are
blocked by login, CAPTCHA, unsupported platform rules, missing consent, or unproven automation.

## North star

Create one great listing. Connect accounts once. Authorize spend once. Click Launch. Vacantless
posts, proves, refreshes, and removes the listing everywhere it can.

The landlord or operator should see a calm control room:

- Ready
- Needs account
- Needs authorization
- Needs spend limit
- Launching
- Live
- Expires soon
- Refreshing
- Needs attention
- Removed

They should not need to understand Playwright, worker branches, portal selectors, mapping JSON,
Graph API, run items, distribution attempts, co-pilot scripts, feed acceptance, or internal publish
modes.

## New product model

### 1. Listing packet

The listing packet is the source of truth. It must contain the facts every channel needs:

- address, unit, rent, availability, beds, baths, sqft, property type, lease term
- photos and cover image
- amenities, utilities, parking, pets, accessibility, smoking, laundry, air conditioning
- public Vacantless listing URL and tracked inquiry links
- channel-specific copy and safe fallbacks
- phone/email/contact policy
- proof state, refresh state, and takedown state

If a channel cannot launch because a field is missing, the UI should point to the source field, not
to a generic "posting step."

### 2. Account setup

Account setup is a one-time setup layer:

- Connect the account or session.
- Confirm the account identity shown to the user.
- Authorize Vacantless to post/refresh/takedown for that destination.
- For paid channels, set a spend limit and pass-through rule.
- Keep reconnect and revoke simple.

This should live as a polished setup experience, not a raw advanced table.

### 3. Launch dashboard

Launch is the operational surface:

- Show which destinations are ready now.
- Show which destinations need account/spend/setup.
- Show the exact cost exposure before launch.
- One "Launch" action starts all ready destinations.
- Any unavoidable human action appears as a simple task, not as a separate workflow.

### 4. Keep-live automation

Distribution is not finished when the first post is made. Vacantless owns the live lifecycle:

- record posted date and computed expiry
- verify live proof
- remind before expiry when automation is not authorized
- auto-refresh where authorized and free
- use spend authorization or request consent for paid refreshes
- surface reconnect tasks when sessions expire
- prefer takedown over refresh once the listing is leased or off-market

User promise: Launch once. Vacantless keeps it live until it leases.

### 5. Takedown

Takedown is a first-class distribution state:

- When leased/off-market, identify every live destination.
- Use a headless/API takedown path where proven.
- Raise one clear operator task where takedown is not yet automated.
- Do not mark removed until the channel's removal proof shape is satisfied.

## Authorization model

Authorization needs four concepts, not a maze of internal flags.

### User-facing concepts

1. Connect account

Example: "Connected as Agile Rentals."

2. Let Vacantless post and refresh

Example: "Vacantless can post, refresh, and remove listings for this account."

3. Set spend limits

Example: "Kijiji can charge up to $29.95 per listing and $150 per month. Costs are passed through
to the landlord."

4. Launch this listing

Example: "Launch 833 Pillette to all ready destinations."

### Internal substrates

Existing app substrates to keep:

- `distribution_channel_accounts.account_status`
- `distribution_channel_accounts.automation_authorized`
- `distribution_channel_accounts.auto_submit_allowed`
- `distribution_channel_accounts.requires_payment`
- `distribution_channel_accounts.spend_authorized`
- `distribution_channel_accounts.spend_max_cents`
- `distribution_channel_accounts.spend_period_max_cents`
- `distribution_channel_spend`
- encrypted channel sessions in the worker session store
- `distribution_publish_attempts`
- `distribution_verifications`
- `listing_posts`

Important reconciliation gate:

The app migration `0217_distribution_channel_spend_authorization.sql` adds the spend authorization
columns and the guarded `claim_approved_distribution_run_item_for_worker` RPC. The current local
standalone worker branch still has `src/claim.ts` selecting `requires_payment` but not enforcing
`spend_authorized` / `spend_max_cents`, and does not call that RPC. Before any paid worker lane goes
live, the worker claim path must be reconciled with the app-side spend gate.

## Channel execution model

Every channel should have a single contract:

- account setup
- listing requirements
- execution method
- payment/spend rule
- proof rule
- refresh rule
- takedown rule
- current rollout state

Execution methods should be internal. User-facing labels should describe readiness/outcome.

### Current source-grounded truth table

| Destination | Desired user state | Current source truth | Main reset work |
|---|---|---|---|
| Vacantless public page | Instant | App can publish the renter page and tracked inquiry link. | Keep as always-ready core destination. |
| Org XML feed | Instant/in feed | App includes eligible available listings in feed. Partner acceptance is separate proof. | Separate "in feed" from "live on partner site." |
| Network/private feed | Ready after partner setup | Exists behind partner/feed setup. | Keep as account/setup destination. |
| Facebook Page feed | Headless/API | App and worker paths exist for Graph Page posting with connected/authorized account. | Keep distinct from Marketplace; prove deploy/env/app-review state. |
| Instagram | Headless/API | App/worker path exists for linked IG Business account, image-required post. | Keep app-review/env/org allowlist proof separate. |
| Kijiji | Headless worker, paid pass-through where needed | Worker has headless Kijiji free/relist paths on main. Local paid lane branch exists and is dark/unmerged. Kijiji decision moved to paid-only with standing spend authorization. | Reconcile paid branch, spend enforcement, deploy, proof, and product copy. |
| Rentals.ca | Headless worker/feed candidate | Worker mapping and runner exist. Feed candidate remains separate from live partner acceptance. | Prove live posting path and refresh/takedown contract. |
| Zumper/PadMapper | Headless worker/feed candidate | Worker mapping and runner exist; live script exists. | Prove account/session/deploy/live URL lifecycle. |
| Viewit | Headless worker, paid gate | Worker mapping and runner exist; paid path can stop at fee wall / pay-on-file only with explicit gate. | Reconcile spend pass-through, proof, and takedown. |
| RentFaster.ca | Headless worker, paid gate | Worker mapping and runner exist; paid path can stop/pay through pay-on-file only with explicit gate. | Reconcile spend pass-through, proof, and takedown. |
| Facebook Marketplace | Exception/fallback unless a compliant route is proven | Older app/source still treats it as co-pilot/guided. Do not conflate it with Facebook Page feed. | Decide whether it has a true compliant headless route; otherwise demote to fallback/manual task. |
| Realtor.ca | Broker/agent route | MLS/broker route, not a self-serve landlord post. | Keep separate from portal automation. |
| WhatsApp/LinkedIn/Snapchat | Share/planned | Planned/share-message style rows exist, no true posting integration. | Keep out of core launch count until a real execution path exists. |

## Keep-live and expiry reminders

Existing source already has the start of this:

- `distribution_run_items.external_posted_at`
- `distribution_run_items.external_expires_at`
- `relist_radar_settings`
- `relist_radar_events`
- Relist Radar emails and decision tokens
- free Kijiji auto-refresh gate
- hands-off refresh toggle via `auto_submit_allowed`
- monthly autopilot recap copy

Reset requirement:

Relist Radar should become "Keep live" in the product model. It should not feel like a separate
technical subsystem.

User-facing states:

- Live
- Expires soon
- Refresh scheduled
- Refreshing
- Needs reconnect
- Needs spend approval
- Expired
- Removed

Rules:

- If the channel is free and authorized, refresh automatically and send a recap.
- If the channel is paid and spend is authorized within limits, refresh automatically and record the
  pass-through spend.
- If the paid spend limit is missing/exceeded, ask for approval before any charge.
- If the session is expired, ask for reconnect.
- If the listing is leased/off-market, do takedown instead of refresh.
- Unknown TTL means no automatic refresh until the channel contract proves the expiry rule.

## Takedown model

Existing source already supports a real lease-up takedown path for Facebook Page feed:

- app creates `transport='takedown'` work
- standalone worker sweep handles `facebook_feed`
- Graph DELETE is followed by GET object-gone proof
- only then mark `listing_posts.status='removed'`
- write `distribution_verifications.result='removed'`
- run item lands terminal removed/done shape

Reset requirement:

Every destination row needs a takedown contract:

- `api_delete`
- `headless_delete`
- `operator_remove_task`
- `broker_remove_request`
- `not_applicable`

Browser portal takedown currently remains an operator task unless/until a headless removal path is
proven per portal. That is acceptable only if the UI presents it as one clear "Remove this ad"
task, not as a separate guided flow.

## Terminology reset

Retire from user-facing primary surfaces:

- guided posting
- browser co-pilot
- concierge
- publishing desk
- worker
- Playwright
- assisted manual
- feed candidate

Allowed as internal/source terms where renaming would be too risky:

- `browser_copilot`
- `concierge`
- `automatic`
- `feed_partner`
- `api_automatic`
- `automation_authorized`
- `auto_submit_allowed`
- `spend_authorized`

User-facing replacements:

- "Connect account"
- "Authorize posting"
- "Set spend limit"
- "Launch"
- "Vacantless is posting"
- "Needs reconnect"
- "Needs spend limit"
- "Live"
- "Refresh scheduled"
- "Removed"

## Source cleanup lanes

### Lane A - Channel contract v2

Create a source-owned contract layer, probably pure TypeScript, that maps every channel to:

- `executionKind`: public_page, feed, api, headless_worker, broker, share, fallback
- `accountKind`: none, oauth, stored_session, broker, share
- `authorizationKind`: none, posting, posting_and_refresh, broker_request
- `spendKind`: none, paid_pass_through_optional, paid_pass_through_required
- `proofKind`: public_url, graph_permalink, feed_acceptance, broker_url, removal_proof
- `refreshKind`: none, ttl_auto, ttl_reminder, unknown
- `takedownKind`: none, api_delete, headless_delete, operator_task, broker_request
- `rolloutState`: planned, dark, source_built, merged, deployed, live_proven

This becomes the product truth consumed by Settings and Launch, instead of each surface inventing
its own "mode" labels.

### Lane B - Authorization UX

Build a clean setup flow:

- connect account
- show account identity
- authorize posting/refresh/takedown
- set spend limit for paid channels
- show pass-through billing wording
- revoke/change limit

No raw internal flags in the UI.

### Lane C - Launch console cleanup

Rewrite the launch surface around outcomes:

- Ready to launch
- Needs account
- Needs posting authorization
- Needs spend limit
- Launching
- Live
- Needs attention

Demote fallback/manual tasks into a small exception drawer.

### Lane D - Worker reconciliation

Before live paid/autopilot rollout:

- decide canonical worker branch for Kijiji paid lane
- reconcile standalone worker claim path with app `0217` spend RPC or identical enforcement
- prove worker deploy host/timer/env gates
- prove channel-by-channel dark and live URL outcomes
- record spend ledger rows only after successful paid charges

### Lane E - Keep-live and reminders

Fold Relist Radar into the main distribution lifecycle:

- encode TTL by channel
- encode refresh authorization by channel
- encode free vs paid refresh behavior
- send reminders only when Vacantless cannot safely proceed
- auto-refresh within authorization
- monthly recap for hands-off free/authorized refreshes

### Lane F - Takedown expansion

For every live channel:

- define takedown method
- implement/prove headless/API removal where possible
- otherwise create one clear operator remove task
- never mark removed without proof

## Immediate recommendation

Next source gate should be a narrow, no-provider, no-worker-run, no-payment source slice:

Build `Channel contract v2` as a pure model plus tests, then adapt one display surface to read the
new user-facing states without changing any execution behavior. This gives the product a clean
language layer before touching live posting, paid spend, or worker deploy.

Acceptance for that first slice:

- no DB/env/provider/payment/portal action
- no worker execution
- pure tests cover each channel's execution, authorization, spend, refresh, and takedown contract
- old terms are allowed only as internal values, not primary user-facing labels
- Kijiji, Facebook Page feed, Facebook Marketplace, Instagram, Rentals.ca, Zumper, Viewit,
  RentFaster, Realtor.ca, feeds, and share/planned channels resolve distinctly
- paid channels cannot be "ready" without spend authorization
- refresh and takedown are part of the contract, not separate afterthoughts

## S279 source progress

Gate 1 implemented the pure `lib/distribution-channel-contracts.ts` contract and wired Settings,
the property launch rail, and the launch picker to contract-driven readiness labels. Kijiji,
RentFaster, Viewit, Rentals.ca, Zumper, Instagram, Facebook Page feed, Facebook Marketplace,
Realtor.ca, feeds, and share/planned channels now resolve through one source-owned launch model.
Paid-required channels are not ready unless the account is connected, posting is authorized, spend
is authorized, the spend ceiling is positive, and spend has not been revoked.

Gate 2 added contract-derived lifecycle copy for keep-live and takedown. The launch rail and
channel picker now show refresh/expiry and removal expectations before a listing is launched. This
is still display/source-only: it does not create reminder jobs, mutate the worker claim path, post
to any portal, remove any ad, charge a card, or change production data.

Gate 3 added a source-only lifecycle attention read model in `lib/distribution-freshness.ts`.
Existing property/run-item data now drives launch-queue attention for:

- takedown needed when a live outside ad remains after the rental is leased, paused, or off-market;
- open takedown run items;
- refresh due from `stale_after`, stale verification, or elapsed external expiry;
- expires soon from `external_expires_at`;
- proof needed when a row is marked Live without a real ad URL.

The property page now reads `distribution_run_items.external_expires_at` and passes the derived
attention into the launch queue. This is still read-only display logic; reminder send stamps,
landlord emails, cron behavior, worker refreshes, and portal takedowns remain separate gates.

Gate 4 folded the existing Relist Radar substrate into the cleaned-up "Keep live" product model
without changing DB shape, cron scheduling, worker behavior, or live sends. The source now resolves
each run-item attention state against the channel contract plus account/authorization/hands-off
refresh/spend state:

- an expiring Kijiji item with connected account, posting authorization, hands-off refresh, and
  landlord spend limit reads as "Keep-live scheduled" instead of a human task;
- missing account, missing authorization, or missing spend becomes one setup action;
- proof-needed and takedown-needed remain top-priority operator tasks;
- Facebook Page feed takedown checks the API-account/authorization gate before reading as ready to
  remove;
- landlord-facing email, decision-link, notification, dashboard, and worker-audit copy says
  "Keep live" while internal tables/routes/event keys keep the existing `relist_radar_*` names.

Verified source proof after Gate 4:

- `npx tsx scripts/test-distribution-channel-contracts.ts` -> 218 passed, 0 failed.
- `npx tsx scripts/test-channel-publish-rail.ts` -> 55 passed, 0 failed.
- `npx tsx scripts/test-distribution-run.ts` -> 106 passed, 0 failed.
- `npx tsx scripts/test-distribution-freshness.ts` -> 43 passed, 0 failed.
- `npx tsx scripts/test-relist-radar.ts` -> 63 passed, 0 failed.
- `npx tsx scripts/test-relist-radar-email.ts` -> 64 passed, 0 failed.
- `npx tsx scripts/test-relist-radar-execute.ts` -> 39 passed, 0 failed.
- `npx tsx scripts/test-notifications.ts` -> 123 passed, 0 failed.
- `npx tsx scripts/test-channel-connection-stages.ts` -> 45 passed, 0 failed.
- `npx tsx scripts/test-distribution-channels.ts` -> 268 passed, 0 failed.
- `npx tsx scripts/test-spend-authorization.ts` -> 16 passed, 0 failed.
- `npx tsx scripts/test-distribution-publish.ts` -> 57 passed, 0 failed.
- `npx tsc --noEmit`.
- `npm run lint`.
- `npm run build`.
- Focused `git diff --check`.

Recommended next gate after this source proof is one of:

- Worker reconciliation gate: reconcile paid headless worker claims with the app spend RPC before
  any paid channel can run unattended.
- Live reminder-readback gate: only after explicit approval, read back the target env flags and DB
  shape, then prove the existing distribution-freshness cron can create/stamp Keep live events
  without sending an unintended landlord email.
- Takedown expansion gate: add or prove channel-specific headless/API removal paths; until then the
  UI correctly presents removal as one operator task.

## Boundaries

These gates did not:

- change worker behavior
- apply migrations
- touch Vercel/env
- run a worker
- send a landlord email
- post to an external portal
- charge or authorize payment
- mutate production data
- mark any channel live or removed

It is a reset artifact so the next implementation starts from the final product Noam wants, not the
historical guided/co-pilot path.
