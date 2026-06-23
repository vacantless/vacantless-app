-- 0059_categorization_rules.sql — bank-feed Slice 4: the "remember this" rules
-- engine. When the owner triages a staged debit and ticks "remember", we save a
-- categorization_rule so future matching transactions auto-categorize (the
-- FreshBooks "Apply to future expenses" UX). On the next sync, a freshly-staged
-- debit is matched against the org's rules: a rule with a definite scope
-- (property/building) auto-files the expense; a broad merchant→category rule
-- pre-fills the category at triage so the owner only confirms.
--
-- The rule model is COMPOSITE + drift-tolerant. Identity keys (at least one
-- required): the Plaid recurring stream_id (strongest — Plaid pre-groups each
-- recurring bill, so 4 Rogers plans across 4 units stay distinct), the stable
-- merchant_entity_id, or a normalized merchant name (merchant_norm) as the
-- credential-free fallback. Narrowers (all optional): account, an amount band,
-- and a day-of-month window. Matching = every NON-NULL field must equal the
-- transaction's; more constraints satisfied = more specific = wins.
--
-- Two scopes (scope_kind): 'merchant' = "always categorize <merchant> as
-- <category>" (broad, category only, never auto-files a property); 'stream' =
-- "always file THIS recurring charge to <unit/building> as <category>" (scoped,
-- auto-files). Per-org RLS gated on organization_id in (select user_org_ids()),
-- exactly like expenses (0058). Explicit grants because new-table auto-expose is
-- off (a missing grant = silent permission-denied no-op under RLS).

-- Carry the two strongest categorization signals onto the staging ledger so a
-- rule can key on them. Idempotent (re-runnable): add only if absent.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'bank_transactions'
      and column_name = 'merchant_entity_id'
  ) then
    alter table public.bank_transactions add column merchant_entity_id text;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'bank_transactions'
      and column_name = 'stream_id'
  ) then
    alter table public.bank_transactions add column stream_id text;
  end if;
end $$;

create table if not exists public.categorization_rules (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,

  -- 'merchant' = broad merchant→category (category only); 'stream' = this
  -- recurring charge→scope+category (auto-files).
  scope_kind          text not null check (scope_kind in ('merchant','stream')),

  -- Identity keys (>= 1 required, enforced by rules_identity_chk below).
  merchant_entity_id  text,
  stream_id           text,
  merchant_norm       text,           -- normalizeMerchant(merchant): lower, alnum-collapsed

  -- Narrowers (all optional). amount band is inclusive cents; day window is
  -- day-of-month of posted_on (1..31, inclusive).
  account_external_id text,
  amount_min_cents    integer check (amount_min_cents is null or amount_min_cents >= 0),
  amount_max_cents    integer check (amount_max_cents is null or amount_max_cents >= 0),
  day_min             integer check (day_min is null or (day_min between 1 and 31)),
  day_max             integer check (day_max is null or (day_max between 1 and 31)),

  -- What to apply. Same category whitelist as expenses (0058). Scope is at most
  -- ONE level (unit XOR building), mirroring expenses_scope_chk.
  category            text not null default 'other'
                        check (category in ('mortgage','property_tax','insurance','utilities',
                                            'maintenance','management','interest','condo_fees',
                                            'supplies','professional','advertising','travel','other')),
  property_id         uuid references public.properties(id) on delete set null,
  building_key        text,

  times_applied       integer not null default 0,
  last_applied_at     timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint rules_scope_chk    check (property_id is null or building_key is null),
  constraint rules_identity_chk check (
    merchant_entity_id is not null or stream_id is not null or merchant_norm is not null
  ),
  constraint rules_amount_band_chk check (
    amount_min_cents is null or amount_max_cents is null or amount_min_cents <= amount_max_cents
  )
);

create index if not exists categorization_rules_org_idx
  on public.categorization_rules(organization_id);
create index if not exists categorization_rules_merchant_idx
  on public.categorization_rules(organization_id, merchant_entity_id);
create index if not exists categorization_rules_stream_idx
  on public.categorization_rules(organization_id, stream_id);

alter table public.categorization_rules enable row level security;

drop policy if exists categorization_rules_all on public.categorization_rules;
create policy categorization_rules_all on public.categorization_rules
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

grant select, insert, update, delete on public.categorization_rules to authenticated;
grant select, insert, update, delete on public.categorization_rules to service_role;
