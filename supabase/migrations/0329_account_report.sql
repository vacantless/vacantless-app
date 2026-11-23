-- S836b: the monthly account summary (lib/account-report.ts). Additive only.
-- The month last sent for each account, so the 1st-of-month sweep sends it once.
-- It goes out under the same "Monthly report" switch (rental_report_enabled)
-- and the same "Also send to" list (you-rental-report) as the per-rental reports.
alter table public.organizations
  add column if not exists account_report_sent_month text;

comment on column public.organizations.account_report_sent_month is
  'S836b: YYYY-MM of the last monthly account summary sent (Toronto time).';
