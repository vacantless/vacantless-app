# S436 - Multi-operator showing routing, Slice 1 (Codex handoff)

**Range to review:** `13da51d..<new HEAD>` (single commit).
**Migration:** `0113_showing_agents.sql` (additive; new table + 2 nullable columns).
**Tests:** `scripts/test-showing-agents.ts` = 44/0. `tsc --noEmit` + `eslint` clean.
`test-notifications.ts` not runnable under `node -r sucrase/register` here (it
transitively imports `@/lib/sms`; alias not resolved in the sandbox) - tsc covers
the notifications.ts change.

## What this is
The dogfood note DOGFOOD-MULTI-OPERATOR-ROUTING-2026-07-07.md: Vacantless has a
single showing agent baked in; Noam had to delegate viewings to a "#2 and #3"
(Peter, Odette) by hand. Slice 1 adds a first-class, **account-less** roster of
showing agents you can assign a viewing to, and emails the agent the hand-off.

## Design decision (please sanity-check)
Showing agents are **account-less records** (mirror of `trade_contacts` 0054),
NOT Supabase-Auth members. Rationale: the real agents coordinate on their own
calendars and CC the lead agent; they don't want another login. A tokenized
`/agent/[token]` view + shared calendar is a deliberate later slice (the
`get_dispatch_context` 0065 pattern), no schema change needed for it.
Table named `showing_agents` (not `operators`) to avoid colliding with the
`memberships.role='operator'` auth concept (lib/roles.ts).

## Files
- `supabase/migrations/0113_showing_agents.sql` - new `showing_agents` (org-scoped,
  per-org RLS via `user_org_ids()`, explicit grants, CHECK on weekly_capacity>=0;
  routing attrs tier/service_area/product_types[]/weekly_capacity stored, UNWIRED
  in Slice 1). Adds `showings.assigned_agent_id` (FK on-delete-set-null) +
  `assigned_at` + index. All additive/nullable = live-safe.
- `lib/showing-agents.ts` (pure) + `scripts/test-showing-agents.ts` - PRODUCT_TYPES,
  normalizeProductTypes, validateShowingAgent, canAssignShowing (cancelled = not
  assignable), remainingCapacity/isAtCapacity (seed Slice 2 routing),
  agentDisplayLabel, activeAgents.
- `lib/notifications.ts` - new `leasing.showing_assigned` event (audience operator,
  active, hyphen copy). Defaults to the assigned agent's own email via
  `operatorFallback`; org can add standing CC recipients for oversight.
- `app/dashboard/showing-agents/{page.tsx,actions.ts}` - roster CRUD. Gated on
  `manage_settings` (owner_admin + operator; not showing_helper).
- `app/dashboard/showings/actions.ts` - new `assignShowing` action. Gated on
  `manage_leads` (routing is a lead-agent decision; a showing_helper only acts on
  viewings routed to them). Empty agent_id = unassign. Re-reads the showing,
  re-checks canAssignShowing, validates the target agent is a live (non-archived)
  agent in the org, stamps assigned_at, logs a lead-timeline note, fires the
  hand-off email best-effort (never blocks the transition).
- `app/dashboard/showings/{page.tsx,assign-select.tsx}` - per-row assign picker
  (native select, submit-on-change). An archived-but-assigned agent is surfaced as
  an extra "(archived)" option so the row reads correctly.
- `app/dashboard/dashboard-nav.tsx` - `/dashboard/showing-agents` lights up Leasing.

## Review focus
1. `assignShowing`: server-side re-validation (state + agent-belongs-to-org +
   not-archived) before the UPDATE; the notification is best-effort and after the
   commit; no PII persisted beyond name/email already in the roster.
2. RLS on `showing_agents` matches the trade_contacts posture exactly.
3. `product_types` text[] round-trip (insert/update/normalize) is clean.
4. Capability gates: manage_settings for roster, manage_leads for assignment.

## Slice 1.5 (added after Slice 1, same review range if deployed together)
`app/dashboard/showings/page.tsx` only (view-layer, no migration, no notification
change): the assigned agent's phone is surfaced on each showing row as tap-to-text
(`sms:`) + tap-to-call (`tel:`) links, so the lead agent can relay a renter message
to whoever is covering. `contactDigits` strips the free-text phone to `[\d+]` for
the href; the block only renders when the showing is assigned AND the agent has a
phone. QA-verified pattern; extend the Codex range to `13da51d..<HEAD>` to cover it.

## Codex fold (S436c) — all 4 findings addressed
- **P1a cross-org assignment.** `assignShowing` now filters the showing read, the
  target-agent read, AND the update by `organization_id = org.id`. DB invariant
  added: migration `0114_showing_agent_same_org` — a BEFORE trigger
  (`enforce_showing_agent_same_org`, SECURITY DEFINER) raises `check_violation` if
  `assigned_agent_id`'s org != the showing's org. (A composite FK with ON DELETE
  SET NULL was rejected: it would null the NOT NULL `organization_id`.) **Proven
  live on prod** — a temp agent from org A could not be assigned to a showing in
  org B (self-cleaning transaction).
- **P1b dropped agent when CC configured.** `resolveNotificationRecipients` now
  ALWAYS includes `audienceEmail` for the operator audience (additive with
  configured CCs); `assignShowing` passes the agent as `audienceEmail` (not
  `operatorFallback`). Existing operator events pass no `audienceEmail` = no-op.
  New test in `test-notifications.ts`.
- **P2 pre-read-only cancel guard.** The UPDATE itself now carries
  `.eq(organization_id).neq(outcome,'cancelled')`; a 0-row result stops before
  logging/notifying, closing the read-then-write race.
- **P3 forbidden-click UX.** `showings/page.tsx` role-gates the "Manage showing
  agents" link (`manage_settings`) and the assign picker (`manage_leads`); a
  `showing_helper` sees a read-only assigned label instead of the picker.

## Not in this slice (backlog)
Slice 2 routing suggestion (suggestOperator scorer over tier/geo/product/capacity);
Slice 3 tokenized agent view + shared calendar; Slice 4 lead-agent oversight view +
operator qualification note carried on the record.
