-- ============================================================================
-- 0207_property_qa - AI leasing reply knowledge base
--
-- Stores operator-curated and auto-learned question/answer pairs used by the
-- dark AI reply helper. property_id NULL means an org-wide common answer;
-- property-scoped rows are checked first by the app.
--
-- Migration is authored only in this lane. Cowork applies and reads back before
-- deploy.
-- ============================================================================

create table if not exists public.property_qa (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id     uuid references public.properties(id) on delete cascade,
  question_key    text not null,
  question_text   text not null,
  answer_text     text not null,
  source          text not null default 'operator'
                    check (source in ('operator', 'auto')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists property_qa_scope_key_idx
  on public.property_qa (
    organization_id,
    coalesce(property_id, '00000000-0000-0000-0000-000000000000'::uuid),
    question_key
  );

create index if not exists property_qa_lookup_idx
  on public.property_qa(organization_id, property_id);

comment on table public.property_qa is
  'AI reply Q&A knowledge store. property_id NULL means an operator-curated org-wide common answer; source auto rows are learned per-property from operator replies.';
comment on column public.property_qa.question_key is
  'Normalized stable key used for deterministic inquiry matching and scoped de-dupe.';
comment on column public.property_qa.source is
  'operator = curated by an operator; auto = learned per-property from an operator reply capture.';

alter table public.property_qa enable row level security;

drop policy if exists property_qa_all on public.property_qa;
create policy property_qa_all on public.property_qa
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

grant select, insert, update, delete on public.property_qa to authenticated;
grant select, insert, update, delete on public.property_qa to service_role;
