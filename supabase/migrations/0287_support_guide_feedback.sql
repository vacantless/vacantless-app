-- Support guide feedback: capture lightweight outcomes and optional examples.
-- Do not store voice recordings or conversation transcripts.
create table if not exists public.support_guide_feedback (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  page_path text not null check (char_length(page_path) between 1 and 300),
  topic_key text not null check (char_length(topic_key) between 1 and 80),
  feedback_type text not null check (feedback_type in ('helpful', 'stuck')),
  comment text check (comment is null or char_length(comment) <= 1000),
  created_at timestamptz not null default now()
);

create index if not exists idx_support_guide_feedback_org_created
  on public.support_guide_feedback (organization_id, created_at desc);

alter table public.support_guide_feedback enable row level security;

grant insert on public.support_guide_feedback to authenticated;

drop policy if exists support_guide_feedback_insert_own
  on public.support_guide_feedback;
create policy support_guide_feedback_insert_own
  on public.support_guide_feedback
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and (
      organization_id is null
      or organization_id in (select public.user_org_ids())
    )
  );
