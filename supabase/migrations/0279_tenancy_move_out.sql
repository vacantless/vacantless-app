-- S770 (REVIEW-S770 section 6): the tenant's move-out date, recorded by the
-- landlord when the tenant gives notice (an N9, a text, a conversation).
-- lib/coming-vacant reads it, with renewal_intent = 'leaving', to put a
-- "coming vacant" card on Today with a one-click relist.

alter table public.tenancies
  add column if not exists move_out_date date,
  add column if not exists move_out_source text,
  add column if not exists move_out_noted_at timestamptz;

comment on column public.tenancies.move_out_date is
  'The day the tenant leaves, as they told the landlord (S770). Null = no notice. Drives the coming-vacant card and the one-click relist.';
comment on column public.tenancies.move_out_source is
  'tenant_notice (an N9 or the tenant''s word), renewal_checkin, or landlord. Free text kept short by the app.';
