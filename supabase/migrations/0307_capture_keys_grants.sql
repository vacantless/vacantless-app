-- S816l: 0306 made capture_keys but this project gives new tables no default
-- grants. The server (service role) reads and writes keys; a signed-in person
-- reads only their own rows (RLS policy capture_keys_select_own).
grant select, insert, update on public.capture_keys to service_role;
grant select on public.capture_keys to authenticated;
