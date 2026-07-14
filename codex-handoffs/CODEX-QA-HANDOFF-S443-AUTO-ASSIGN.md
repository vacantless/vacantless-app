# Codex QA handoff — S443 full auto-assign at booking time

**Range to review:** `68a6cfc..<HEAD after the S443 push>` (base = S442 close).
**Migration:** `0119_auto_assign_agents.sql` — APPLIED + read-back verified on prod
(`nvhvdyxpyogvadpjlvij`); all 9 orgs dark (`auto_on = 0`).

## What shipped
A new opt-in flag `organizations.auto_assign_agents` (default **false** = dark for
every org incl. Agile). When on, a viewing a renter **self-books online** is
automatically routed to the load-balanced showing agent, with the same
`leasing.showing_assigned` hand-off email + lead-timeline note a manual assign
sends. Auto-assign **refuses an at-capacity agent** — a full roster (or no roster)
leaves the viewing unassigned for manual routing.

## Files
- `lib/showing-agents.ts` — new pure `pickAutoAssignAgent(candidates, opts?)`:
  wraps `suggestShowingAgent` and returns **null** when the winner is at capacity
  (or roster empty/all-archived). No other pure change.
- `scripts/test-showing-agents.ts` — 6 new cases (83 -> 91/0).
- `app/r/[propertyId]/actions.ts` — new best-effort `autoAssignBookedShowing(showingId)`
  (service-role admin client, mirrors `notifyOperatorsOfNewLead`), called inside
  `attemptBooking` after a successful book (covers both `submitLead` and
  `rebookSavedLead`). Reads the showing (org + renter/property), gates on the org
  flag, loads the active roster, computes per-agent load THIS org-local week
  (`orgWeekWindow` + the same window filter as the Viewings page), runs
  `pickAutoAssignAgent`, does a **guarded UPDATE** (id + org + `assigned_agent_id is
  null` + open outcome), logs an "auto-assigned" note, fires the hand-off email
  (`audienceEmail` = agent). NEVER throws.
- `lib/org.ts` — `auto_assign_agents` added to the `Org` type + select.
- `app/dashboard/showing-agents/{actions.ts,page.tsx}` — `setAutoAssign` action
  (manage_settings) + an opt-in toggle card with explanatory copy.

## Design decisions worth a look
1. **Capacity is a hard gate for auto-assign but not for the manual suggestion.**
   `suggestShowingAgent` still surfaces an at-capacity agent (amber "full") because
   a human can override; `pickAutoAssignAgent` returns null so the unattended path
   never piles onto a full agent. (Tested both ways.)
2. **Idempotent guarded UPDATE** (`assigned_agent_id is null`) so a concurrent
   manual assign between the RPC book and the helper can't double-route — the
   first writer wins, the helper's UPDATE matches 0 rows. Verified live.
3. **Admin client on the anon path** — the roster + org are RLS-hidden from anon,
   same reason `notifyOperatorsOfNewLead` uses the admin client. Best-effort: a
   routing hiccup can't turn a captured booking into a renter error.
4. **RPC untouched** — the assignment happens in the app layer (calls the pure
   lib), not in `book_public_showing`, so there is ONE ranking implementation.
5. `assigned_by` var = "Auto-assign" in the hand-off email so the agent sees it
   was routed automatically.

## Gate
tsc clean; eslint clean; test-showing-agents 91/0. Live schema-QA on North Star
(b733a191): flag on + Alpha(0)/Beta(2) uncapped -> new viewing routed to Alpha
(least-loaded), concurrent replay = 0 rows, confirmation cleared; both capped full
-> any_pickable=false (stays unassigned). Torn down clean.

## Codex round 1 result + fold (S443b)
Codex reviewed `68a6cfc..9538474`: NO P1, 2 P2s.
- **P2-b FIXED** in the fold: capacity week now anchored on the booking's
  `scheduled_at` (`orgWeekWindow(anchorMs,...)`), not `Date.now()`.
- **P2-a ACCEPTED + documented** (no code): the app-layer capacity count -> guarded
  UPDATE can overrun `weekly_capacity` by one under a rare simultaneous double-
  booking. Left advisory to match the manual assign path (which enforces no cap)
  + the suggestion chip (surfaces full agents); low volume; self-correcting. A
  comment in the file records the escalation path (lock-recount RPC on BOTH paths)
  if capacity ever needs to be a hard guarantee.
Fold range for a re-review (optional, small): `9538474..<S443b HEAD>`.

## Known non-issues (don't re-flag)
- DST week-boundary hour in `orgWeekWindow` is the documented+accepted S441 P3
  simplification (matches lib/leasing-snapshot).
- Auto-assign scope is the **public self-book path only** (the volume inflow).
  Operator-created showings are assigned by hand at creation. Intentional.
