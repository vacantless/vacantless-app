-- 0305 (S816b): a mobile number per teammate, for the phone book.
-- Noam 2026-11-17: "team mate text numbers ... needs to be all easy at fingertips".
alter table public.memberships add column if not exists mobile text;
