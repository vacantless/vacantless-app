-- ============================================================================
-- 0134_n1_snapshot — renewal autopilot Slice B/C hardening (S460b, Codex fold).
--
-- Codex S460 P1: the served N1 (/n1/[token]) and the Stripe rate sync both
-- RE-DERIVED amounts/dates from mutable tenancy fields (rent_cents, start_date,
-- today, the guideline table). After recordRentIncrease rolls rent_cents +
-- last_rent_increase_date forward, that re-derive yields the NEXT cycle - so the
-- tenant's notice could render different amounts than were served, and the Stripe
-- action could bill next year's increase. Fix = an IMMUTABLE snapshot captured at
-- serve time; both /n1/[token] and updateStripeRentAmount read from it.
--
-- n1_snapshot jsonb holds the frozen N1 at serve time: current/new/increase rent
-- (raw cents + formatted), guideline %, effective + serve-by dates, exempt flag,
-- landlord + tenant names + address, and capturedAtIso. Additive + nullable;
-- ships inert (populated only when serveN1 runs). Reversible (drop the column).
-- ============================================================================

alter table public.tenancies
  add column if not exists n1_snapshot jsonb;

comment on column public.tenancies.n1_snapshot is
  'Immutable snapshot of the served N1 (amounts/dates/parties frozen at serve time). /n1/[token] renders from it and updateStripeRentAmount bills from it, so a later recordRentIncrease re-derive cannot drift the served notice or the rail (S460b, Codex P1 fold).';
