-- ============================================================================
-- 0135_rent_guidelines — Ontario rent-increase guideline as DATA, not code (S465)
--
-- The guideline % was a hardcoded table (ONTARIO_GUIDELINE in lib/rent-increase.ts)
-- that had to be edited + redeployed each year when Ontario publishes the next
-- value — and it went stale (2027 = 1.9% was published 2026-06-23 but the constant
-- stopped at 2026 until S463). This table lets a superadmin add future years with
-- NO redeploy. The code constant remains the SEED + a runtime FALLBACK
-- (guidelineForYear), so the app still works if this table is empty or a year is
-- missing: the server lookup is dbValue ?? constant ?? null.
--
-- GLOBAL reference data (province-wide, NOT org-scoped): one row per effective
-- year. Readable by all authenticated users (the derive runs server-side); writes
-- only via service_role (the superadmin admin-console action; no write policy).
-- No PII. Additive + idempotent; seeded to match the shipped constant so apply is
-- behaviour-preserving.
-- ============================================================================

create table if not exists public.rent_guidelines (
  -- The calendar year the increase TAKES EFFECT.
  year        integer primary key check (year >= 1991 and year <= 2100),
  -- Guideline percentage (1.9 = 1.9%). Ontario caps at 2.5; allow headroom, >= 0.
  percent     numeric(4,2) not null check (percent >= 0 and percent <= 10),
  -- Provenance for audit: e.g. 'ontario.ca 2026-06-23', 'seed'.
  source      text,
  updated_at  timestamptz not null default now()
);

comment on table public.rent_guidelines is
  'Ontario rent-increase guideline by effective year (S465). Global reference data: one row per year, readable by all authenticated users; writes via service_role only (superadmin admin console). Seeds + overrides the code constant ONTARIO_GUIDELINE; a missing year falls back to the constant, then null. No PII.';

alter table public.rent_guidelines enable row level security;

-- Read-all: public reference data; every authenticated caller that derives an
-- increase can read it. NO write policy => writes only via service_role (which
-- bypasses RLS), i.e. the superadmin console action.
drop policy if exists rent_guidelines_read on public.rent_guidelines;
create policy rent_guidelines_read on public.rent_guidelines
  for select using (true);

grant select on public.rent_guidelines to authenticated;
grant select, insert, update, delete on public.rent_guidelines to service_role;

-- Seed from the shipped constant (post-S463) so apply changes NO behaviour.
insert into public.rent_guidelines (year, percent, source) values
  (2023, 2.5, 'seed'),
  (2024, 2.5, 'seed'),
  (2025, 2.5, 'seed'),
  (2026, 2.1, 'seed'),
  (2027, 1.9, 'seed: ontario.ca 2026-06-23')
on conflict (year) do nothing;
