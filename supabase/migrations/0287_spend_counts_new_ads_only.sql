-- S784: the monthly spend fallback counts NEW ads only, matching
-- lib/spend-cap.ts countNewPaidAds. Before this, every robot run with a URL
-- this month counted as a paid ad, so free edits and takedowns of an older
-- ad used up the monthly limit and blocked a real repost.
--
-- One list price per listing_posts row created this month that robot runs
-- touched (no ledger row), plus one per robot-posted item with no listing
-- record (errs high). Runs on an ad first posted in an earlier month are free.
create or replace function public.distribution_period_spend_cents(
  p_organization_id uuid,
  p_channel text,
  p_exclude_item_id uuid default null
) returns integer
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  start_ts timestamptz := (date_trunc('month', now() at time zone 'America/Toronto')) at time zone 'America/Toronto';
  ledger_total integer;
  new_ads integer;
  orphans integer;
  price integer := public.distribution_channel_list_price_cents(p_channel);
begin
  select coalesce(sum(greatest(coalesce(s.amount_cents, 0), 0)), 0)::integer
  into ledger_total
  from public.distribution_channel_spend s
  where s.organization_id = p_organization_id
    and s.channel = p_channel
    and s.charged_at >= start_ts;

  if price <= 0 then
    return ledger_total;
  end if;

  with posted as (
    select dri.id, dri.listing_post_id,
      exists (
        select 1 from public.distribution_channel_spend s2
        where s2.distribution_run_item_id = dri.id and s2.charged_at >= start_ts
      ) as in_ledger
    from public.distribution_run_items dri
    where dri.organization_id = p_organization_id
      and dri.channel = p_channel
      and dri.external_url is not null
      and dri.last_attempted_at >= start_ts
  ),
  ledger_posts as (
    select distinct listing_post_id from posted where in_ledger and listing_post_id is not null
  )
  select
    count(distinct p.listing_post_id) filter (
      where p.listing_post_id is not null
        and exists (select 1 from public.listing_posts lp where lp.id = p.listing_post_id and lp.created_at >= start_ts)
        and p.listing_post_id not in (select listing_post_id from ledger_posts)
    )::integer,
    count(*) filter (where p.listing_post_id is null)::integer
  into new_ads, orphans
  from posted p
  where not p.in_ledger
    and (p_exclude_item_id is null or p.id <> p_exclude_item_id);

  return ledger_total + (coalesce(new_ads, 0) + coalesce(orphans, 0)) * price;
end;
$function$;
