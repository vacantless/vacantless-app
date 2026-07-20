# S528 — Whole-product operator-UX audit (ranked)

Audited 2026-07-19/20 at app HEAD `a9f4dfec` against the six-question operator standard
(what needs attention / whose is it / safe to share / next action / what happened / auto vs prepared).
Method: full read of dashboard, leasing (leads/showings/screening), money (hub, reconcile,
import-history, P&L, T776, rent, expenses), properties (list + detail + distribute), settings,
automations, billing, messages, maintenance/notices, captures, nav.

## P1 — high leverage, fixed this pass

1. **Emails fire silently from viewing controls** — Reschedule's button is just "Save"
   (`showings/reschedule-control.tsx:40`) but the action re-notifies the renter AND the agent
   (`showings/actions.ts:909,929`). Assign emails the agent, documented only on a different page
   (`showing-agents/page.tsx:79`). "Nudge renter" emails immediately with no signal
   (`showings/page.tsx:514-523`). Meanwhile "Confirm"/"Mark confirmed" sends nothing — the operator
   cannot tell which buttons message people. Fails standard #3/#6. The tenant-messages page has the
   right pattern ("Nothing here has been sent…", `messages/page.tsx:79`).
2. **SMS settings copy implies live texting while SMS is dark** — toggle copy is present-tense
   ("we send a short text…", `settings/page.tsx:1546-1557`), gated on plan not transport; flash says
   "Text message setting saved." (`:1513`); page subtitle promises "automated emails and texts"
   (`:364`). Production SMS is OFF (SMS_LIVE unset). Unsafe wording.
3. **Leasing hub is a static launcher** — the designated funnel front door (`leasing/page.tsx`)
   renders 5 static cards, zero counts/queues; its banner claims "Everything that needs you."
   Answers none of the six questions. Weakest page in the leasing flow.
4. **Money hub dead-end** — Import history is `accounting`-gated
   (`import-history/page.tsx:188-205`) but the hub's Premium-chip predicate omits it
   (`money/page.tsx:127-131`): Free/Growth operators click an unmarked card into a lock screen.

## P2 — fixed this pass

5. **Raw DB enums shown as statuses** — Import history prints `staged`/`committed`/`pending`
   verbatim, including a green "pending" chip (`import-history/page.tsx:358-360,441-443,464-466`).
6. **Report empty states dead-end** — income statement has NO zero-data state (renders a zeros
   table); tax package's "Nothing in this tax year" has no next action (`tax-package/page.tsx:283-287`);
   reconcile's empty state names Expenses but doesn't link it (`reconcile/page.tsx:334-339`).
7. **Premium reports don't cross-link** — T776 action bar has no link to P&L or the statement trio
   (`tax-package/page.tsx:247-255`); P&L links statement + rent-roll but not its sibling T776
   (`income-statement/page.tsx:253-264`). "Reconciles to the P&L" is claimed but not navigable.
8. **Lead detail hides the viewings section entirely when empty** (`leads/[id]/page.tsx:509`) —
   no "book one" affordance; the pipeline's next action lives on another page (context-carry failure).
9. **Confirm verb inconsistency** — At-risk board says "Confirm" (`showings/page.tsx:511`), the row
   control says "Mark confirmed" (`confirm-control.tsx:24`) for the same server action.
10. **"Unreconciled" jargon** — StatCard label + hint (`reconcile/page.tsx:319-324,113-116`) tell
    the operator a fact, not what to do.

## P3 — documented, NOT changed this pass (design decisions, next pass)

- Two overlapping "Money" hubs (`/dashboard/money` vs `/dashboard/rent`, both eyebrowed Money,
  both surfacing Owner statement; stale header comment in `rent/page.tsx:18-20`). Fold exports
  into one front door.
- Rental detail stacks 3–4 competing next-action/publish affordances (header Publish +
  lifecycle-rail "Next:" + NextActionCard + Distribute banner). Make NextActionCard the single
  guided step.
- Two lock-state visual languages (`FeatureLockedNotice` vs `EmptyState` + "See plans").
  Standardize.
- "Record as rent" exists twice with different gates/mental models (expenses money-in split vs
  reconcile one-tap match); "Ignore" vs "Exclude" vocabulary split.
- Automation controls split across `/automations` and Settings→Comms; automations page doesn't
  distinguish auto-send vs prepared-only.
- Viewings row control pile-up (assign + outcome + confirm + reschedule + suggest + contact in one
  flex stack) — needs an overflow menu on mobile.
- Distribution "Live coverage" counts `needs_refresh` as live (`distribute-tab.tsx:236-240,284-286`).
- Lifecycle-rail connector misrender on wrap; tab bars lack overflow cues; billing disabled-Subscribe
  soft dead-end when Stripe unconfigured.

## Explicitly good (do not regress)

- Accounting/tax disclaimers ("not a filed return", "never moves money") — keep as model.
- Distribution honesty ("Submitted to feed - not live yet", proof-before-Live).
- Triage-queue's table-free responsive pattern; most empty states elsewhere.
- SMS transport is genuinely default-closed in code (`lib/sms.ts:548`); the problem is wording only.
