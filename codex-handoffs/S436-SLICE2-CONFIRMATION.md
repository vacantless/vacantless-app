# S436 Slice 2 - showing confirmation trail (Codex handoff)

**Review range:** the Slice-2 commit on top of the S436c fold.
**Migration:** `0115_showing_confirmation.sql` (additive, already applied to prod:
`showings.confirmed_at` timestamptz + `confirmed_by` text CHECK in ('agent','lead')).
**Tests:** `scripts/test-showing-agents.ts` = 57/0. tsc + eslint clean.

## Why
The "Howard" episode (2026-07-08): a booked viewing had no visible state between
"assigned" and "outcome", so the lead agent could not tell whether the assigned
agent had actually confirmed the appointment with the renter. This adds that state
+ surfaces what's outstanding.

## What changed
- **Migration 0115:** `confirmed_at` (NULL = not yet confirmed) + `confirmed_by`
  ('lead' = the lead agent/operator recorded it, the Slice-2 path since agents are
  account-less; 'agent' reserved for the Slice-3 tokenized self-confirm). Nullable,
  additive, live-safe.
- **lib/showing-agents.ts (pure) + tests:** `deriveCoordinationStatus({outcome,
  assignedAgentId, confirmedAt})` -> cancelled | done | unassigned |
  awaiting_confirmation | confirmed. Plus `needsConfirmation`, `canConfirmShowing`,
  `coordinationStatusLabel`. Never stored, always derived.
- **actions.ts:**
  - `assignShowing` now ALSO resets `confirmed_at`/`confirmed_by` to null on any
    assignment change (reassign or unassign invalidates a prior confirmation).
  - New `setShowingConfirmed` (gated manage_leads): confirm requires status
    awaiting_confirmation and guards the UPDATE with
    `.not(assigned_agent_id is null).is(confirmed_at null).neq(outcome,'cancelled')`
    + org filter; unconfirm requires status confirmed. Logs a lead-timeline note
    ("Viewing confirmed with the renter." / "Viewing confirmation cleared.").
- **UI:** new `confirm-control.tsx` (plain forms, no client JS): "Mark confirmed"
  when awaiting, a green "Confirmed" badge + "Undo" when confirmed. Shown only when
  the viewer can assign (manage_leads). The Viewings "Upcoming" section shows an
  amber count "N assigned viewings are awaiting confirmation."

## Review focus
1. `setShowingConfirmed`: state guards in both the pure `canConfirmShowing`/status
   check AND the UPDATE predicate (belt + suspenders vs a concurrent change); org
   scoping; no PII persisted; note only on a real transition.
2. `deriveCoordinationStatus` precedence (cancelled > done > unassigned >
   awaiting > confirmed) - tests cover each branch.
3. assignShowing's confirmed-reset: reassigning to a new agent must not carry a
   stale confirmation.
4. confirm-control render matrix (awaiting -> button, confirmed -> badge+undo,
   else nothing) and the manage_leads gate on the page.

## Backlog (Slice 3+)
Tokenized /agent/[token] view where the account-less agent self-confirms
(confirmed_by='agent') + a shared calendar; a pre-showing "still unconfirmed"
nudge on the reminder substrate; a coordination count on the Overview dashboard.
