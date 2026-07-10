# Codex QA handoff — S444 "Assign all unassigned" bulk action

**Range to review:** `5e0ac4f..<HEAD after the S444 push>` (base = S443b close).
**Migration:** none. **New env:** none.

## What shipped
One button on the Viewings page (`/dashboard/showings`) that routes EVERY still-
open **upcoming** viewing with no agent yet, in a single operator click, through
the same load-balanced, capacity-respecting pick as per-booking auto-assign
(S443). Each row is claimed by a **guarded UPDATE** (assign only if still
unassigned + open + in this org), so it adds **no new write path or privilege**
over the manual `assignShowing`. Gated on `manage_leads`, same as the single
assign. Ships **active** for every org (an operator action; no behaviour change
until clicked). The button only renders when there is something to route AND an
active roster to route to.

## Files
- `lib/showing-agents.ts` — new pure `planBulkAssignments({unassigned, existing,
  agents, tz, weekStartsOn?})`. Buckets each agent's existing non-cancelled
  assignments by org-local week, walks the unassigned viewings in `scheduled_at`
  order, and for each builds candidates with `assignedThisWeek = existing[week] +
  what this batch already gave them`, then calls the existing
  `pickAutoAssignAgent`. Returns `{assignments:[{showingId,agentId,agentName}],
  skipped:[showingId]}`. A viewing whose week has everyone at capacity (or an
  empty roster, or a null `scheduledAtMs`) goes to `skipped`. No other pure change;
  reuses `orgWeekWindow` + `pickAutoAssignAgent`.
- `scripts/test-showing-agents.ts` — 18 new assertions (91 -> 109/0): empty roster
  -> all skipped; no viewings -> empty plan; uncapped 2-agent/4-viewing -> 2/2
  balance (running load counts); existing-load tilt keeps the week balanced within
  one; two cap-1 agents / 3 viewings -> each takes exactly one, third skipped
  (overflow-skip, no overrun); all-full week -> all skipped; per-week capacity (an
  agent full THIS week is free NEXT week); archived agents never picked + null-time
  viewing skipped.
- `app/dashboard/showings/actions.ts` — new `assignAllUnassigned()` server action
  (`manage_leads`-gated). Loads the org's unassigned upcoming open viewings
  (`assigned_agent_id is null` + `scheduled_at >= now` + `outcome is null OR
  scheduled`, org-scoped), the active roster, and existing non-cancelled
  assignments for the per-week load; calls `planBulkAssignments`; executes each
  assignment with the SAME guarded UPDATE as `assignShowing` (id + org +
  `assigned_agent_id is null` + open outcome), skipping silently if a concurrent
  manual assign already claimed the row; batches the lead-timeline notes into ONE
  insert; fires the `leasing.showing_assigned` hand-off email per newly-assigned
  viewing via `Promise.allSettled` (best-effort); `revalidatePath`s and redirects
  back with `?assigned=<n>&full=<skipped>`.
- `app/dashboard/showings/page.tsx` — the bulk button (visible only when
  `manage_leads` + active roster + at least one unassigned upcoming viewing) + a
  result banner reading the `?assigned` / `?full` summary. Added `searchParams`.

## Design decisions worth a look
1. **Batch balancing is pure + tested.** The one thing a single per-viewing pick
   can't do is account for what the batch already handed out; `planBulkAssignments`
   increments a running per-(agent, week) tally so 4 same-week viewings across 2
   uncapped agents split 2/2, not 4/0. This is the meat of the review.
2. **Per-week capacity, anchored on each viewing's `scheduled_at`** (the S443 P2-b
   anchor), so a viewing in a future week load-balances against that week — not
   "this" week. Existing assignments are bucketed the same way.
3. **Guarded UPDATE per row + idempotent.** Identical predicate to `assignShowing`.
   If a concurrent manual assign wins between the plan and the write, the UPDATE
   matches 0 rows and we skip it (assignedCount reflects only rows we truly
   claimed). The plan's running tally assumed success, so a lost race can leave the
   remaining picks marginally less balanced — harmless (capacity is advisory
   everywhere else; see S443 P2-a).
4. **Same notification path, one email per viewing.** Reuses the exact
   `leasing.showing_assigned` event the manual/auto path sends (one ranking + one
   notification implementation). Net email volume equals assigning each by hand,
   just collapsed into one click; sent concurrently so a large batch doesn't serialize.
5. **No property product-type column yet**, so every agent is a generalist (no
   `productType` passed) — lights up when properties gain a type, same as S441/S443.

## Gate
tsc clean; eslint clean; test-showing-agents 109/0. Live schema-QA on North Star
(b733a191): seeded 3 agents (Gamma cap 1) + 5 unassigned upcoming viewings (4 in
one Toronto week + 1 next week); the action's exact filter chain returned exactly
those 5 (excluding the past/attended/cancelled baseline rows). End-to-end live UI
click verified after deploy (assignments matched the expected plan; re-click
assigned 0 = idempotent). Seeds torn down clean.

## Known non-issues (don't re-flag)
- Capacity overrun-by-one under a simultaneous cross-request race is the accepted,
  documented S443 P2-a posture (advisory capacity; escalation = lock-recount RPC on
  all paths). The bulk loop is sequential within one request, so there is no
  intra-batch race.
- DST week-boundary hour in `orgWeekWindow` is the accepted S441 P3 simplification.
- One hand-off email per assigned viewing is intentional (matches the manual path);
  a per-agent digest is a possible future enhancement, not a defect.
