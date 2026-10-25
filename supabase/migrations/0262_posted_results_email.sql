-- S737 (review item 2): one "your ads are live" email per rental turn.
-- Stamped when sent; a later turn (new ads after the old ones came down)
-- starts after the stamp, so it gets its own email.
alter table public.properties
  add column if not exists results_emailed_at timestamptz;
