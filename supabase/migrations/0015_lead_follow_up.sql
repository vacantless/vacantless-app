-- ============================================================================
-- Vacantless — Lead follow-up fields (next action)
-- ============================================================================
-- Adds a lightweight, operator-set follow-up reminder to each lead so the
-- lead-detail page can answer "what do I owe this renter next, and by when?" —
-- and the leads list can flag overdue follow-ups at a glance. This maps to the
-- Learning-Audit finding that follow-up discipline was the weakest link
-- (Status/outcome fields went unmaintained; leads went cold with no next step).
--
-- Both columns land on public.leads, which is already RLS-protected and already
-- granted to the app roles at the table level (the M1 grants carry no column
-- list, so they extend to columns added here). No new grant needed.
--
-- Operator-internal (NOT renter-facing — never surfaced through any public RPC):
--   * next_action_at    date  — the day the operator plans to follow up next
--                               (NULL = no follow-up scheduled).
--   * next_action_note  text  — optional short reminder of what to do
--                               ("call about parking", "send application").
-- ============================================================================

alter table public.leads
  add column if not exists next_action_at   date,
  add column if not exists next_action_note text;

-- Partial index: the leads list / dashboard only ever query the small set of
-- leads that HAVE a follow-up scheduled (to surface overdue / due-today). A
-- partial index keeps it tiny and ignores the common NULL rows.
create index if not exists leads_next_action_at_idx
  on public.leads (next_action_at)
  where next_action_at is not null;
