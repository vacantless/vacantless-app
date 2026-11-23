-- S831: the per-rental monthly report.
-- 1) A cost can belong to one rental, so the report can show what each rental cost.
--    Null means the cost covers the whole account (e.g. one ad for two units).
alter table public.marketing_costs
  add column if not exists property_id uuid references public.properties(id) on delete set null;

create index if not exists marketing_costs_property_idx
  on public.marketing_costs (property_id) where property_id is not null;

comment on column public.marketing_costs.property_id is
  'S831: the rental this cost was for; null = account-wide.';

-- 2) The account switch on Every message we send (on for every account).
alter table public.organizations
  add column if not exists rental_report_enabled boolean not null default true;

comment on column public.organizations.rental_report_enabled is
  'S831: send the monthly report for each advertised rental on the 1st.';

-- 3) The landlord's own "next steps" note, and the month last sent (claim stamp).
alter table public.properties
  add column if not exists report_next_steps text,
  add column if not exists rental_report_sent_month text;

comment on column public.properties.report_next_steps is
  'S831: free text the landlord types; shown under Latest work and next steps.';
comment on column public.properties.rental_report_sent_month is
  'S831: YYYY-MM of the last monthly report sent for this rental (Toronto time).';

-- 4) "Also send to" works for the report too (0317 listed the allowed alerts).
alter table public.message_extra_recipients
  drop constraint if exists message_extra_recipients_message_id_check;
alter table public.message_extra_recipients
  add constraint message_extra_recipients_message_id_check
  check (message_id in ('you-posted-results', 'you-signin-lost', 'you-site-mail', 'you-incident-report', 'you-rental-report'));
