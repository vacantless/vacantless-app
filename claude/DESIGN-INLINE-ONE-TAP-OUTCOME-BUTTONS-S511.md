# DESIGN — Inline one-tap outcome buttons in the nudge email (S511)

_Vacantless leasing engine · design thread #6 · 2026-07-18 · anchor: app HEAD d3dd83a, latest mig 0157_

## Problem

The post-showing outcome nudge (S392, cron `app/api/cron/showing-outcome-nudge/route.ts`) is the
mechanism that actually converts a passed viewing into a recorded outcome — the "PUSH that mirrors
Aaliyah's tap-a-link habit." It works (THE GATE tripped Jul 16 on exactly this email). But it is **two
taps**, not one:

1. Email → single **"Record the outcome"** button (a GET link).
2. Landing page (`/agent/[token]` calendar, or operator `/showing/[token]`) → tap **Renter showed /
   No-show / Cancelled**, which fires a **POST** server action → RPC records it.

Tally (the legacy habit we're replacing) records on the **single** tap in the email. That missing tap
is the UX gap. Thread #6 = close it: put the outcome choices **inline in the email** so one tap records.

## The load-bearing constraint (why this wasn't already one-tap)

The whole capture architecture deliberately keeps every mutation behind a **POST**, never a GET
side-effect. This is written into three files verbatim (KI585):

> _"email link scanners (Outlook SafeLinks, Gmail prefetch) fetch GET URLs, so a GET that recorded an
> outcome would auto-corrupt data. The page GET only renders; this POST records…"_
> — `app/showing/[token]/actions.ts`, `app/agent/[token]/actions.ts`, `app/agent/[token]/page.tsx`

An inline email button is an `<a href>` = a **GET**. A naive "the button records the outcome" design
therefore reintroduces exactly the hazard the architecture was built to avoid. And it is not cosmetic
here: **`attended` has a downstream side-effect** — the RPC advances the lead to `showed`
(`record_showing_outcome_from_*token`), which moves the renter forward automatically and can trigger
renter-facing follow-up. A corporate link-scanner that crawls all three inline links would silently
record a **false `attended`** and kick off renter automation for a viewing that may not have happened.
Unacceptable for a live, paying, multi-tenant email.

So the real design question is **not** "add three links to the email." It is: **how do we get
one-tap-from-email WITHOUT a GET side-effect, on a customer-facing automation where a false `attended`
has real consequences?**

## Decision

**Inline outcome buttons that each open a minimal, pre-scoped confirm page which auto-submits a POST on
load, with a visible no-JS fallback button. The mutation stays a POST; only a JS-executing real browser
fires it. Reuse the existing RPCs unchanged — no migration.**

Concretely:

- The nudge email's single CTA becomes an **outcome-button row**, audience-specific:
  - **Assigned agent** (has email; routed to `/agent/{agent_token}`): **two** buttons — _Renter showed_
    / _No-show_. Matches what the agent RPC accepts and the on-site reality (a cancellation is never an
    on-site report — the agent RPC rejects `cancelled` by design).
  - **Operator fallback** (unassigned viewing or agent has no email; routed to `/showing/{outcome_token}`):
    **three** buttons — _Attended_ / _No-show_ / _Cancelled_. Matches the outcome-token RPC's accepted set.
  - Plus the existing plain-text link fallback, now listing each outcome's link.
- Each button is a GET to a **new, minimal pre-scoped confirm route**:
  - Agent: `/agent/{agent_token}/record?showing={id}&o={attended|no_show}`
  - Operator: `/showing/{outcome_token}/record?o={attended|no_show|cancelled}`
- The confirm route **server-renders one unambiguous card** — "Mark [renter]'s viewing at [address]
  ([time]) as **No-show**?" — with a **single Confirm button that POSTs** the *existing* server action
  (`recordOutcomeFromToken`), which calls the *existing* SECURITY DEFINER RPC. A GET render mutates
  nothing → **KI585 preserved**.
- The confirm route also mounts a tiny `"use client"` **auto-submit** component: on mount it
  `requestSubmit()`s the hidden confirm form exactly once. Real browser → the POST fires immediately →
  **true one-tap**. Link scanner → doesn't execute JS → never submits → **safe**. No-JS browser → sees
  the visible Confirm button → degrades to one extra tap (strictly no worse than today).
- After the POST, redirect to the **existing** landing page with the **existing** `?status=recorded_*`
  banner. The agent page already lists remaining viewings, so a mistake is immediately visible and the
  other outcomes are one tap away to correct.

### Why this is the right resolution

- **True one-tap** for the human — the thread-#6 goal — via the auto-submit.
- **Honors KI585.** No GET ever mutates. A false `attended` from a link-scanner (which would fire renter
  automation) cannot happen, because scanners don't run the auto-submit JS.
- **No migration, no new RPC, no new DB surface.** Reuses `record_showing_outcome_from_agent_token`
  (attended/no_show, `too_early` + assigned-to-agent + open-only guards, no-op on double-tap) and
  `record_showing_outcome_from_token` (attended/no_show/cancelled, idempotent per 0099). Both already
  granted to anon, both already the server-side source of truth. Pure app-layer → low-risk, reversible,
  Codex-friendly.
- **Correctable by construction.** Idempotent RPCs + the post-record landing page showing state and
  offering the other outcomes → any mis-tap (human fat-finger or the rare JS-executing sandbox) is a
  one-tap fix, and the agent RPC's "second tap is a no-op success" rule means a double-fire never
  flip-flops the record.
- **Audience-correct.** Agent sees the two on-site realities; operator sees all three. No button ever
  points at an outcome its RPC would reject.

## Rejected alternatives

- **Naive GET records the outcome** (button href hits `…/record?o=attended` which writes immediately).
  Rejected: breaks KI585; a corporate link-scanner records a false `attended` and triggers renter
  automation. This is the whole reason the confirm-page indirection exists.
- **AMP for Email** (in-email form that POSTs on one tap). Rejected for MVP: requires Google sender
  registration, a dynamic AMP MIME part, and Brevo support; only Gmail honors it — Outlook/Apple
  Mail/Roundcube fall back to the HTML part, so you **still** need the HTML one-tap path (i.e. this
  design) as the fallback. High effort for partial coverage; revisit later as an enhancement layered on
  top, not a replacement.
- **Interstitial confirm with no auto-submit** (button → single Confirm tap). Not rejected so much as
  **subsumed**: it is exactly the no-JS fallback of the chosen design. Shipping it alone would leave us
  at ~1.5 taps and miss the goal.
- **Per-outcome asymmetry** (auto-record No-show/Cancelled on GET since they have no renter side-effect,
  keep Attended behind a confirm). Rejected: inconsistent UX ("why did one need a second tap?") and it
  still puts two GET-mutating links in the email, keeping the KI585 hazard for the low-stakes outcomes.

## Scope / ship posture

- Pure app-layer: email builder (`lib/email.ts` `notificationHtml` + payload type), the cron's URL
  construction (`showing-outcome-nudge/route.ts`), two new `/record` confirm routes, one client
  auto-submit component. **No migration.** No change to the RPCs, the escalation logic, or the opt-in
  gate.
- The event is already enabled for Agile (`leasing.showing_outcome_nudge`, `outcome_nudge_max=3`), so
  this ships **into a live, converting email**. Recommend: build → verify diff in MAIN → deploy →
  browser-QA the confirm routes with a `?dry=1`-sourced URL → **hold go-live of the visible email change
  for Noam's explicit go** (standing rule: customer-facing sends need his go). The button row is a
  structural email change, not a per-org template-text edit.
- Once recording is frictionless, more outcomes land on nudge #1, so bounded escalation (up to 3)
  naturally stops sooner — no change needed there.

## Build ticket

`claude/CODEX-BUILD-INLINE-ONE-TAP-OUTCOME-BUTTONS-S511.md`
