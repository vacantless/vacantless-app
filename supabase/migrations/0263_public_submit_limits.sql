-- S742b: a small counter for the public renter form (/r/<id>) so one script
-- cannot flood a landlord's inbox, run up email and AI spend, or use the
-- landlord's sender as a relay. Service role only; the app calls the function
-- and fails OPEN (a counter error never blocks a real renter).
create table if not exists public.public_submit_hits (
  bucket_key text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket_key, window_start)
);
alter table public.public_submit_hits enable row level security;
-- No policies on purpose: nothing but service_role reads or writes it.

create or replace function public.public_submit_hit(
  p_key text,
  p_window_seconds integer,
  p_limit integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start timestamptz;
  v_hits integer;
begin
  if p_key is null or p_window_seconds is null or p_window_seconds <= 0 or p_limit is null then
    return true;
  end if;
  v_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.public_submit_hits (bucket_key, window_start, hits)
  values (p_key, v_start, 1)
  on conflict (bucket_key, window_start)
  do update set hits = public.public_submit_hits.hits + 1
  returning hits into v_hits;
  -- Keep the table small: prune two-day-old windows now and then.
  if random() < 0.01 then
    delete from public.public_submit_hits where window_start < now() - interval '2 days';
  end if;
  return v_hits <= p_limit;
end;
$$;

revoke all on function public.public_submit_hit(text, integer, integer) from public;
revoke all on function public.public_submit_hit(text, integer, integer) from anon;
revoke all on function public.public_submit_hit(text, integer, integer) from authenticated;
grant execute on function public.public_submit_hit(text, integer, integer) to service_role;
