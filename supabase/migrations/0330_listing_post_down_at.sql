-- S836d: the day each ad came down. Additive only.
-- Ads are marked removed or expired from about nine places in the app (the
-- live check, takedowns, the Marketplace helper, Mark rented...), so the date
-- is kept by the database itself: set when an ad goes from live (or draft) to
-- removed or expired, cleared when it goes live again. Ads that came down
-- before this existed keep a null date ("date not recorded").
alter table public.listing_posts
  add column if not exists down_at timestamptz;

comment on column public.listing_posts.down_at is
  'S836d: when the ad last went from up to removed or expired; null when it is up or the date was never recorded.';

create or replace function public.listing_posts_stamp_down_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status in ('removed', 'expired') then
    if tg_op = 'INSERT' or old.status is distinct from new.status and old.status not in ('removed', 'expired') then
      new.down_at := coalesce(new.down_at, now());
    end if;
  elsif new.status = 'live' then
    new.down_at := null;
  end if;
  return new;
end;
$$;

create or replace trigger listing_posts_stamp_down_at
  before insert or update of status on public.listing_posts
  for each row execute function public.listing_posts_stamp_down_at();
