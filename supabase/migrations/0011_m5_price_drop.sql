-- ============================================================================
-- Vacantless — M5 differentiator: price-drop blasts to historical leads
-- ============================================================================
-- When an operator lowers a property's rent, they can email every still-open
-- lead who inquired earlier ("the price just dropped — still interested?").
--
-- Two columns on already-granted tables (no new grant needed: the M1 grants are
-- table-level with no column list, so they extend to columns added later; no
-- new RPC needed because the blast runs in the operator's own authenticated
-- server action, scoped by the existing RLS policies):
--
--   * properties.price_drop_pending_cents — when rent drops, the PRIOR (higher)
--     rent we should announce a reduction FROM. NULL = nothing pending. Set in
--     updateProperty on a drop; cleared after a blast (or on a price increase).
--
--   * leads.price_drop_notified_cents — the lowest rent this lead has already
--     been emailed about. NULL = never blasted. Per-lead idempotency: a lead is
--     re-eligible only if the current rent is strictly below this value, so a
--     further drop re-notifies but a repeat click / unchanged price does not.
-- ============================================================================

alter table public.properties
  add column if not exists price_drop_pending_cents integer;

alter table public.leads
  add column if not exists price_drop_notified_cents integer;
