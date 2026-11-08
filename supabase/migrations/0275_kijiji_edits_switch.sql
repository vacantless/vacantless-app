-- S762: allow the staff switch kijiji_edits (lib/platform-switches.ts): the
-- robot edits a live Kijiji ad in place after a rental's details change.
alter table public.platform_org_switches
  drop constraint if exists platform_org_switches_key_check;

alter table public.platform_org_switches
  add constraint platform_org_switches_key_check
  check (switch_key in ('shared_sms_number', 'answers_own_enquiries', 'kijiji_edits'));
