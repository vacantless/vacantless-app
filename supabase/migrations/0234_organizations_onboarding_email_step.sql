-- S702j: which getting-started emails a new account has been sent
-- (0 none, 1 welcome, 2 welcome + next-day nudge). Each is sent once.
alter table public.organizations
  add column if not exists onboarding_email_step integer not null default 0,
  add column if not exists onboarding_email_last_at timestamptz;
