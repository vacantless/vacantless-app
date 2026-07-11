-- ============================================================================
-- 0132_n1_service_record — renewal & rent-increase autopilot Slice B (S460).
--
-- Serve-on-behalf of the N1 + vault filing. When the landlord taps "serve" we
-- record HOW + WHEN the notice was served and (with the tenant's consent to
-- electronic service) email the tenant a link to a public, view-only N1. The
-- landlord stays the named landlord/agent on the N1 (design-lock §4); software
-- is only the delivery mechanism at the landlord's explicit, per-service tap.
--
-- Columns (all on tenancies, additive):
--   * n1_served_at / n1_served_method (email|hand|mail) / n1_effective_date —
--     the service evidence trail.
--   * n1_filed_document_id — the vault linkage (mirrors rental_applications
--     .filed_document_id, S456); the served N1 filed as a 'notice' doc.
--   * n1_service_token — unguessable anon credential for the public /n1/[token]
--     view the tenant opens (no login).
--   * electronic_service_consent (+ _at) — the captured consent to electronic
--     service; the email leg refuses to send without it (§4).
--
-- All additive; ships inert (no serve/send until the landlord taps). Reversible.
-- ============================================================================

alter table public.tenancies
  add column if not exists n1_served_at timestamptz,
  add column if not exists n1_served_method text
    check (n1_served_method is null or n1_served_method in ('email','hand','mail')),
  add column if not exists n1_effective_date date,
  add column if not exists n1_filed_document_id uuid,
  add column if not exists n1_service_token uuid not null default gen_random_uuid(),
  add column if not exists electronic_service_consent boolean not null default false,
  add column if not exists electronic_service_consent_at timestamptz;

create index if not exists tenancies_n1_service_token_idx
  on public.tenancies(n1_service_token);

comment on column public.tenancies.n1_service_token is
  'Unguessable anon credential for the public /n1/[token] N1 view the tenant opens (no login). The token is the only handle; a wrong token reveals nothing.';
comment on column public.tenancies.electronic_service_consent is
  'Whether electronic service of notices was consented to; the serveN1 email leg refuses to send without it (design-lock §4).';
