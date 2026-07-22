-- ============================================================================
-- 0177_distribution_jobs
--
-- S553: durable done-for-you automation jobs. This is the internal work-order
-- layer between an operator's concierge request and the existing proof/attempt
-- tables. It is additive and does not mark any channel Live.
-- ============================================================================

create table if not exists public.distribution_jobs (
  id                         uuid primary key default gen_random_uuid(),
  organization_id            uuid not null references public.organizations(id) on delete cascade,
  property_id                uuid not null references public.properties(id) on delete cascade,
  run_id                     uuid not null references public.distribution_runs(id) on delete cascade,
  run_item_id                uuid not null references public.distribution_run_items(id) on delete cascade,
  channel                    text not null,
  transport                  text,
  source                     text not null default 'concierge_request'
                               check (source in ('concierge_request', 'worker_retry', 'manual_staff')),
  status                     text not null default 'queued'
                               check (status in (
                                 'queued', 'preparing', 'ready_for_human',
                                 'blocked', 'completed', 'failed', 'cancelled'
                               )),
  adapter_kind               text not null default 'manual_external'
                               check (adapter_kind in (
                                 'internal_app', 'feed_partner', 'human_external',
                                 'broker_handoff', 'custom_manual'
                               )),
  requested_by               uuid references auth.users(id) on delete set null,
  assigned_to                uuid references auth.users(id) on delete set null,
  requested_at               timestamptz not null default now(),
  claimed_at                 timestamptz,
  completed_at               timestamptz,
  next_run_at                timestamptz not null default now(),
  locked_at                  timestamptz,
  locked_by                  text,
  attempt_count              integer not null default 0,
  account_status_snapshot    text,
  requires_connected_account boolean not null default false,
  requires_login             boolean not null default false,
  requires_payment           boolean not null default false,
  requires_captcha_gate      boolean not null default false,
  requires_human_final_submit boolean not null default true,
  proof_required             boolean not null default true,
  ai_consent_at              timestamptz,
  ai_consent_by              uuid references auth.users(id) on delete set null,
  ai_prepared_at             timestamptz,
  ai_model                   text,
  minimum_payload            jsonb not null default '{}'::jsonb
                               check (jsonb_typeof(minimum_payload) = 'object'),
  ai_result                  jsonb not null default '{}'::jsonb
                               check (jsonb_typeof(ai_result) = 'object'),
  human_gates                jsonb not null default '[]'::jsonb
                               check (jsonb_typeof(human_gates) = 'array'),
  blockers                   jsonb not null default '[]'::jsonb
                               check (jsonb_typeof(blockers) = 'array'),
  notification_state         jsonb not null default '{}'::jsonb
                               check (jsonb_typeof(notification_state) = 'object'),
  last_error                 text,
  proof_url                  text,
  proof_verification_id      uuid references public.distribution_verifications(id) on delete set null,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  unique (run_item_id)
);

create index if not exists idx_distribution_jobs_org
  on public.distribution_jobs(organization_id);
create index if not exists idx_distribution_jobs_status_next
  on public.distribution_jobs(status, next_run_at);
create index if not exists idx_distribution_jobs_run
  on public.distribution_jobs(run_id);
create index if not exists idx_distribution_jobs_property
  on public.distribution_jobs(property_id);

alter table public.distribution_jobs enable row level security;
drop policy if exists distribution_jobs_all on public.distribution_jobs;
create policy distribution_jobs_all on public.distribution_jobs
  for all to authenticated
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

grant select, insert, update, delete on public.distribution_jobs to authenticated;
grant select, insert, update, delete on public.distribution_jobs to service_role;

comment on table public.distribution_jobs is
  'Durable S553 done-for-you distribution work orders. Existing distribution_run_items remain the operator-visible status source; jobs drive staff/worker execution and never mark Live without proof.';
comment on column public.distribution_jobs.ai_consent_at is
  'Explicit operator/staff consent timestamp before minimum listing/channel data may be sent to Claude/Anthropic for prep. Null means no model call.';
comment on column public.distribution_jobs.requires_human_final_submit is
  'True when payment, CAPTCHA, portal login, broker handoff, or final external submit must be completed by a person.';
comment on column public.distribution_jobs.proof_required is
  'Always true for channel completion: proof is saved through distribution_verifications/listing_posts before the run item can be marked Live.';
