-- S822: a short air conditioning note per rental (e.g. "bring a portable unit
-- sized for the wall sleeve"). Read by Quick replies' Air conditioning answer
-- (lib/reply-answers) and copied by sister-unit fill. Column on an existing
-- table: the table's grants already cover it.
alter table public.properties
  add column if not exists ac_notes text
  check (ac_notes is null or char_length(ac_notes) <= 300);
