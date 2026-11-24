-- 0333 (S840, Noam 2026-11-24): a pasted one-time code for the sign-in window.
-- The window is a remote screen, so a code copied from an email cannot be
-- pasted into it. The landlord pastes it on the Vacantless page instead; the
-- app saves it here (4 to 12 letters or digits, never a password), the worker
-- types it where the cursor is and clears it within seconds.
-- Additive. Existing grants and row rules on the table cover the new columns.
alter table public.site_signin_windows
  add column if not exists type_code text,
  add column if not exists type_code_at timestamptz;

comment on column public.site_signin_windows.type_code is
  'S840: a one-time code waiting to be typed into the window; the worker clears it once typed.';
