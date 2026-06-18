-- ============================================================================
-- 0042_persons — the per-person vault (lease vault #11, slice 8)
--
-- Everything in Vacantless is TENANCY-scoped today: a `tenants` row belongs to
-- exactly one tenancy (tenancy_id NOT NULL), so the SAME human renting two units
-- over time is two unrelated tenant rows, and their documents evaporate per
-- tenancy on turnover. The Tenon10 teardown (VACANTLESS-LEASE-VAULT-MODULE-BRIEF
-- Section 10) flagged this as the one structural gap competitors leave open: a
-- TRUE cross-tenancy per-PERSON history — every lease and notice that follows an
-- individual across units and tenancies. That is what this migration adds.
--
-- It introduces a durable, org-scoped `persons` identity and links the existing
-- tenancy-scoped rows to it:
--   * tenants.person_id       — which person this co-tenant slot IS.
--   * lease_signers.person_id — which person actually signed a document.
--
-- A lease_document is tied to a tenancy, and a tenancy's tenants now point at
-- persons, so "every document for person P" = the documents on P's tenancies
-- UNION the documents P personally signed. The vault view reads both paths.
--
-- IDENTITY RULE: within an org, a person is matched by normalized email first,
-- then E.164 phone (mirrors the inbound-STOP phone_e164 match key and the
-- leads/tenants normalization). email_norm = lower(btrim(email)). This is the
-- same plan the app applies for NEW tenants (lib/persons planResolvePerson) so
-- the backfill and the live path agree.
--
-- Additive + backfilled in one shot:
--   1. persons table (+ RLS, grants, match-key indexes) — conventions mirror
--      0040/0033: CHECK-not-enum, RLS on organization_id in user_org_ids(),
--      explicit grants (auto-expose OFF), service_role DML for future crons.
--   2. tenants.person_id + lease_signers.person_id (nullable FK, ON DELETE SET
--      NULL — losing a person must never delete a tenancy/signature record).
--   3. a one-time, idempotent backfill (only rows with person_id IS NULL):
--      resolve-or-create a person per existing tenant, then link tenant-role
--      signers to the matching tenant's person.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. persons — the durable, org-scoped human identity that outlives a tenancy.
-- ---------------------------------------------------------------------------
create table if not exists public.persons (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  full_name       text,
  email           text,
  phone           text,
  -- normalized match keys (set by the app + the backfill; never user-facing).
  -- email_norm = lower(btrim(email)); phone_e164 mirrors tenants.phone_e164.
  email_norm      text,
  phone_e164      text,

  notes           text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists persons_org_idx
  on public.persons(organization_id);
-- the two match keys the resolver looks up, scoped per org.
create index if not exists persons_org_email_idx
  on public.persons(organization_id, email_norm);
create index if not exists persons_org_phone_idx
  on public.persons(organization_id, phone_e164);

alter table public.persons enable row level security;

drop policy if exists persons_all on public.persons;
create policy persons_all on public.persons
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

grant select, insert, update, delete on public.persons to authenticated;
grant select, insert, update, delete on public.persons to service_role;

-- ---------------------------------------------------------------------------
-- 2. link the tenancy-scoped rows to the person. Nullable + ON DELETE SET NULL:
--    a person is a convenience index over records, never their owner — deleting
--    one must leave the tenancy and the signed document fully intact.
-- ---------------------------------------------------------------------------
alter table public.tenants
  add column if not exists person_id uuid references public.persons(id) on delete set null;
create index if not exists tenants_person_idx on public.tenants(person_id);

alter table public.lease_signers
  add column if not exists person_id uuid references public.persons(id) on delete set null;
create index if not exists lease_signers_person_idx on public.lease_signers(person_id);

-- ---------------------------------------------------------------------------
-- 3. Backfill — resolve-or-create a person for every existing tenant, then
--    link tenant-role signers. Idempotent: only touches person_id IS NULL, so
--    re-running is a no-op. Mirrors lib/persons.planResolvePerson exactly
--    (email_norm match first, then phone_e164, else create).
-- ---------------------------------------------------------------------------
do $$
declare
  t           record;
  v_person_id uuid;
  v_email_norm text;
begin
  for t in
    select * from public.tenants
    where person_id is null
    order by organization_id, created_at
  loop
    v_email_norm := nullif(lower(btrim(t.email)), '');
    v_person_id  := null;

    -- match an existing person in the SAME org: email_norm wins, phone_e164 next.
    select p.id into v_person_id
    from public.persons p
    where p.organization_id = t.organization_id
      and (
        (v_email_norm is not null and p.email_norm = v_email_norm)
        or (t.phone_e164 is not null and p.phone_e164 = t.phone_e164)
      )
    order by case when v_email_norm is not null and p.email_norm = v_email_norm then 0 else 1 end
    limit 1;

    if v_person_id is null then
      insert into public.persons (organization_id, full_name, email, phone, phone_e164, email_norm)
      values (t.organization_id, t.name, t.email, t.phone, t.phone_e164, v_email_norm)
      returning id into v_person_id;
    end if;

    update public.tenants set person_id = v_person_id where id = t.id;
  end loop;
end $$;

-- Link tenant-role signers to the person of the matching tenant on the same
-- tenancy (by email, else by name). Landlord/guarantor signers stay unlinked —
-- the vault is tenant/person-of-interest centric. Best-effort, idempotent.
update public.lease_signers s
set person_id = t.person_id
from public.lease_documents d
join public.tenants t on t.tenancy_id = d.tenancy_id
where s.person_id is null
  and s.role = 'tenant'
  and d.id = s.lease_document_id
  and t.person_id is not null
  and (
    (s.email is not null and lower(btrim(s.email)) = lower(btrim(t.email)))
    or (s.name is not null and lower(btrim(s.name)) = lower(btrim(t.name)))
  );
