# SCOPE S679 - The Kijiji payment-prompt lane, costed against the code

_2026-09-04. Prep for the lane Noam decided on 2026-09-03: worker builds the ad into the
cart, stops at the fee wall, escalates with the invoice, human types the CVV and pays,
worker resumes. Read [[project_kijiji_fee_wall_cvv]] for why the CVV wall is permanent
and [[project_kijiji_lane_real_gate]] for why "the connected session" is not a blocker.
NOTHING IS BUILT HERE. This is a cost estimate against real anchors._

## The headline: most of it already exists

`needs_payment` is a first-class status today, not something to invent. It is in the
publish-status union (`lib/distribution-publish.ts:63`), labelled "Needs payment" and
styled `warning` (`:77`, `:92`), and it renders on four surfaces already:

| surface | anchor |
|---|---|
| Distribute tab | `distribute-tab.tsx:292,360,378,420` |
| Launch run panel | `launch-run-panel.tsx:276,355,365,1085` |
| Publish-everywhere modal | `publish-everywhere.tsx:901-904` |
| Channel publish rail | `channel-publish-rail.tsx:134` |

The app cron even carries the operator sentence: *"complete the channel's payment, then
review and submit the post"* (`app/api/cron/distribution-worker/route.ts:56`).

## And the field for the invoice URL already exists

**`distribution_run_items.operator_action_url`** is a live column [confirmed 2026-09-04
against `information_schema`]. The launch run panel already renders it as a clickable
link (`launch-run-panel.tsx:876-878`). The app writes it from the plan builder
(`properties/actions.ts:2236`, `lib/distribution-publish.ts:408-686`) and the lease-up
takedown writes it (`lib/leaseup-takedown.ts:243`).

**The worker never writes it. Zero occurrences of `operator_action_url` in
`vacantless-worker/src`.** That is the gap, and it is a gap in a wire, not a schema.

**So: NO MIGRATION. NO NEW SURFACE.**

## The three real pieces of work

### 1. Worker writes the payload when it parks at needs_payment (small)

At the point the paid submit lands at the fee wall (`phase-b-submit-paid.ts`, around the
existing `needs_login` write at `:338`), also write:

- `operator_action_url` = the Kijiji `m-feature-cart.html?invoice=...` URL
- the exact total with tax, and which account it charges, into `error_message` /
  `audit_message`
- the unit and the advertised price, so the prompt is actionable on its own

Per the fee-wall memory, a bare "payment needed" is not actionable. **The prompt must
carry: invoice URL, total with tax, unit, price, and the charging account.**

**ORDERING NOTE: this touches the same recorder surface as the S674 error_code wire,
which is PR #9 `70a2cf0`, unmerged and undeployed. Merge that first or the two conflict.**

### 2. Somebody has to be TOLD (this is the whole risk)

**Grepped 2026-09-04: nothing anywhere notifies on `needs_payment`.** No email, no
notification event, no alert. The status renders on a dashboard nobody is watching.

That is not a hypothetical. Growth Test kijiji items `e8d80187` and `6407dcac` captured
live ads on **2026-08-12** and have sat at `needs_operator` on the Publish-for-me desk
for **23 days** [read back 2026-09-04]. A new escalation surface with no notification
will rot in exactly the same way, and this one rots with a half-built ad in a cart.

**The good news:** the notification framework already has the right shape -
`NotificationAudience = "operator"` and `NotificationLane = "listing"`
(`lib/notifications.ts:28,38`), plus a settings catalog and templating. So this is a new
EVENT in an existing catalog, not a new rail.

### 3. A named owner

Not a code task. **An escalation with no named owner is not a lane.** Today the
Marketplace lead queue is Noam-only and cannot be delegated; the Kijiji business account
login is `rentals@agileonline.ca`, which Aaliyah could in principle hold. Whoever owns
it has to be willing to type a CVV on demand, because that is the entire human step.

## The one decision this reduces to

Everything above is mechanical except one question:

> **Who gets the payment prompt, and on what channel?**

Three shapes, ranked by how likely the ad actually goes live:

1. **Push/SMS to Noam, link straight to the invoice.** Fastest to build (one
   notification event), fastest to act on, and matches how every other Kijiji ad has
   actually gone up so far. Concentrates the work on one person.
2. **Email to `rentals@agileonline.ca`,** which Aaliyah can reach. Spreads the load and
   uses the account that owns the card, but adds a person who has never done this step.
3. **Dashboard-only, no notification.** This is what exists today. It is the shape that
   already produced a 23-day-old stalled item. Not recommended.

## What is NOT in scope here

- The CVV wall. Permanent, not a gap. See [[project_kijiji_fee_wall_cvv]].
- Spend authorization. Separate, and it is Noam's money decision (see
  [[project_kijiji_lane_real_gate]] for the exact fields and the same-save trap).
- Where the worker runs. Still the Hetzner box, still unreachable from every session
  surface.

[[project_agile_leasing_engine]]

---

# ADDENDUM S679b - How this works for OTHER operators

_Added 2026-09-04 after Noam asked the multi-tenant question. All re-derived from code._

## A CORRECTION TO CARRIED MEMORY, FIRST

`project_agile_leasing_engine` says: *"`WORKER_PAY_MAX_CENTS` is PROCESS-GLOBAL... Nothing
wires per-org `spend_max_cents` into that check."*

**The second half is WRONG.** `effectivePayMaxCents` (`vacantless-worker/src/phase-b-submit.ts:942-947`):

```
const accountMax = positiveCents(accountSpendMaxCents);
const envMax     = positiveCents(PAY_MAX_CENTS);
if (accountMax != null && envMax != null) return Math.min(accountMax, envMax);
return accountMax ?? envMax ?? DEFAULT_PAY_MAX_CENTS;
```

It is called with `job.account.spend_max_cents` at `:2666` and `:1273`. **The per-org
ceiling IS wired, as a `Math.min` against the env var.** So the env var is a cap on every
operator's cap, not a replacement for it.

## What already scales per operator

| concern | where it lives | verdict |
|---|---|---|
| Spend ceiling | `distribution_channel_accounts.spend_max_cents`, per org, set in that operator's own Settings, wired as `min(org, env)` | **scales** |
| Who gets the prompt | `notification_settings` rows: per org, per event, with `recipients string[]`, `enabled`, and per-org subject/body templates (`lib/notifications.ts:1205-1214`) | **scales** |
| The card | each operator's own Kijiji business account and own saved card. Nothing shared | **scales** |
| Encrypted session storage | `distribution_channel_sessions` is keyed `(organization_id, channel)`, and the APP can already write it with the same AES-256-GCM envelope (`lib/distribution-session-crypto.ts`, used today for Facebook Page tokens) | **scales** |

**This is why the payment prompt is worth building.** It is one new event in an existing
per-org catalog. It gets MORE valuable per operator, not less, because the failure it
prevents (a paid cart nobody is told about) multiplies with tenants.

## What does NOT scale

### 1. Acquiring the session. This is the real gate to selling the channel.

Scoped separately in `SCOPE-S679-SELF-SERVE-SESSION-CONNECT.md`. Short version: `npm run
warm` is a terminal command needing `SUPABASE_SERVICE_ROLE_KEY` and `SESSION_ENC_KEY`, so
today onboarding a new operator means Noam runs it on his own machine while the customer
supplies their password. Fine for one operator, unsellable at ten.

### 2. `WORKER_PAY_MAX_CENTS` is one env var across every tenant

Default 5000 cents. Because of the `Math.min`, it caps everyone. Fine while every operator
buys Lite at 3384. **The first operator who wants Plus at $95.13 forces a raise for all of
them**, and a shared env var is a bad place to hold a per-customer commercial limit.

**The fix is small and should land before the SECOND operator, not after**: treat the env
var as a safety rail (raise it, or make it the absolute maximum) and let the per-org
ceiling be the operative number. It is already read at one place. Do not bundle this with
the prompt work; it is a separate one-line change with its own test.

### 3. The rot multiplies

With no `needs_payment` notification today, one operator gives you one silently stalled
cart. Ten give you ten, each holding a half-built ad with an expiry clock on it.

## Revised ranking

1. **The payment prompt.** Per-org data on an existing rail, no migration, improves with scale.
2. **Self-serve session connect.** The actual commercial gate. Real build, needs a decision
   on trust posture before any code.
3. **The global pay-cap fix.** Ten minutes, and it is a landmine only while it is cheap to defuse.

Everything still queues behind merging the S674 wire, PR #9 `70a2cf0`.
