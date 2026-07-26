alter table public.leads
  add column if not exists ingest_message_key text;

create unique index if not exists leads_org_ingest_message_key_uidx
  on public.leads (organization_id, ingest_message_key)
  where ingest_message_key is not null;
