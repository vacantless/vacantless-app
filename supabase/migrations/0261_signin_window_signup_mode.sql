-- S736 (review item 7 second half): "create the account for me".
-- A landlord with no Kijiji, Zumper or Rentals.ca account presses "Make my
-- <site> account". The same sign-in window opens on the site's sign-up page,
-- and the worker fills in the details they typed (first and last name, email,
-- phone). The landlord chooses the password and finishes on the site itself;
-- the worker never types a password or presses a submit button
-- (vacantless-worker src/signup-prefill-logic.ts).
alter table public.site_signin_windows
  add column if not exists mode text not null default 'signin',
  add column if not exists prefill jsonb;

do $$ begin
  alter table public.site_signin_windows
    add constraint site_signin_windows_mode_check check (mode in ('signin', 'signup'));
exception when duplicate_object then null; end $$;

comment on column public.site_signin_windows.prefill is
  'S736: the landlord''s own details for a sign-up window (first_name, last_name, email, phone). Never a password.';
