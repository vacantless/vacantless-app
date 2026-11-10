-- ============================================================================
-- Vacantless - S775: group viewings per rental.
-- ============================================================================
-- Landlords on the forums name group viewings (one time, several renters) as
-- the best answer to no-shows. 0159 added an account-wide "Open-house
-- booking" switch: unlimited renters per time on every rental, off on every
-- account. This adds a per-rental size:
--   properties.viewing_group_size  1 to 20 renters per viewing time; null keeps
--                                  the account rule (one renter, or unlimited
--                                  when Open-house booking is on).
-- Applied in:
--   * set_showing_slot_lock (trigger on showings): a full time raises
--     unique_violation, which every booking path already reads as "that time
--     was just taken". Serialized per account and time with an advisory lock,
--     so two renters booking the last place at once cannot both get it.
--   * get_public_availability: a time is offered until this rental's group is
--     full; another rental's viewing still blocks the time unless the account
--     takes several. Returns group_size (0 = no limit) for the renter page.
-- Additive: with every viewing_group_size null nothing changes.
-- ============================================================================

alter table public.properties
  add column if not exists viewing_group_size integer
    check (viewing_group_size is null or (viewing_group_size between 1 and 20));

-- 1. The slot lock trigger (0159 body plus the per-rental group).
create or replace function public.set_showing_slot_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allow boolean;
  v_cap integer;
  v_count integer;
begin
  if tg_op = 'UPDATE'
     and new.scheduled_at is not distinct from old.scheduled_at
     and new.organization_id is not distinct from old.organization_id
     and new.property_id is not distinct from old.property_id
     and new.slot_lock is not null then
    return new;
  end if;

  select coalesce(o.allow_double_booking, false) into v_allow
    from public.organizations o
    where o.id = new.organization_id;
  select pr.viewing_group_size into v_cap
    from public.properties pr
    where pr.id = new.property_id;

  if v_cap is null then
    -- The account rule, as in 0159. A one-renter time also refuses a time a
    -- group viewing on another rental already holds (its lock is random).
    if not v_allow and new.outcome = 'scheduled' then
      perform pg_advisory_xact_lock(hashtextextended(new.organization_id::text || '|' || new.scheduled_at::text, 0));
      if exists (
        select 1 from public.showings s
        where s.organization_id = new.organization_id
          and s.scheduled_at = new.scheduled_at
          and s.outcome = 'scheduled'
          and s.id is distinct from new.id
      ) then
        raise exception using errcode = 'unique_violation', message = 'Viewing time is taken';
      end if;
    end if;
    new.slot_lock := case when v_allow then gen_random_uuid()::text else new.scheduled_at::text end;
    return new;
  end if;

  -- A group: up to v_cap renters at this rental and time.
  if new.outcome = 'scheduled' then
    perform pg_advisory_xact_lock(hashtextextended(new.organization_id::text || '|' || new.scheduled_at::text, 0));
    select count(*) into v_count
      from public.showings s
      where s.property_id = new.property_id
        and s.scheduled_at = new.scheduled_at
        and s.outcome = 'scheduled'
        and s.id is distinct from new.id;
    if v_count >= v_cap then
      raise exception using errcode = 'unique_violation', message = 'Viewing time is full';
    end if;
    if not v_allow and exists (
      select 1 from public.showings s
      where s.organization_id = new.organization_id
        and s.scheduled_at = new.scheduled_at
        and s.outcome = 'scheduled'
        and s.property_id is distinct from new.property_id
        and s.id is distinct from new.id
    ) then
      raise exception using errcode = 'unique_violation', message = 'Viewing time is taken';
    end if;
  end if;
  new.slot_lock := gen_random_uuid()::text;
  return new;
end $$;

-- 2. Public availability: offer a time until the group is full; say the size.
do $mig$
declare
  d text;
  old_block constant text :=
'    ''booked'', case when coalesce(o.allow_double_booking, false) then ''[]''::jsonb
      else coalesce((
        select jsonb_agg(s.scheduled_at)
        from public.showings s
        where s.organization_id = o.id
          and s.outcome = ''scheduled''
          and s.scheduled_at >= now()
      ), ''[]''::jsonb) end,';
  new_block constant text :=
'    -- S775: group viewings per rental (viewing_group_size; 0 = no limit).
    ''group_size'', case
      when p.viewing_group_size is not null then p.viewing_group_size
      when coalesce(o.allow_double_booking, false) then 0
      else 1 end,
    ''booked'', coalesce((
      select jsonb_agg(t.scheduled_at) from (
        select s.scheduled_at
        from public.showings s
        where s.organization_id = o.id
          and s.outcome = ''scheduled''
          and s.scheduled_at >= now()
          and not coalesce(o.allow_double_booking, false)
          and (s.property_id is distinct from p.id or p.viewing_group_size is null)
        union
        select s.scheduled_at
        from public.showings s
        where s.property_id = p.id
          and s.outcome = ''scheduled''
          and s.scheduled_at >= now()
          and p.viewing_group_size is not null
        group by s.scheduled_at
        having count(*) >= p.viewing_group_size
      ) t
    ), ''[]''::jsonb),';
begin
  d := pg_get_functiondef('public.get_public_availability(uuid)'::regprocedure);
  if position('S775: group viewings per rental' in d) > 0 then
    return; -- already applied
  end if;
  if position(old_block in d) = 0 then
    raise exception 'S775: get_public_availability booked block not found; not modified';
  end if;
  d := replace(d, old_block, new_block);
  execute d;
end
$mig$;
