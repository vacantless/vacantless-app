-- S749: Form N8 (persistent late rent) is stored in notices like the N4, N5 and
-- N12. Widen the type check; N6 and N7 are added now so the next LTB forms need
-- no further migration. Existing rows are unaffected.
alter table public.notices drop constraint if exists notices_type_check;
alter table public.notices
  add constraint notices_type_check
  check (type in ('N1', 'N4', 'N5', 'N6', 'N7', 'N8', 'N12', 'N13'));
