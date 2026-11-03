-- 0268 (S747): an account's viewing time zone follows its first rental.
--
-- Every organization starts on booking_timezone 'America/Toronto' (0004). A
-- landlord in Vancouver or Calgary who never opens Viewing times would show
-- renters Toronto hours. When an account adds its FIRST rental and the zone is
-- still the Toronto default, set the zone from the rental's postal code (its
-- first letter names the province) or, failing that, a province code or name
-- in the address. Ontario, Quebec, Nunavut and unknown addresses keep Toronto.
-- A landlord can still change it on Viewing times.

create or replace function public.timezone_for_canadian_address(p_address text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  a text := upper(coalesce(p_address, ''));
  fsa text;
  prov text;
begin
  -- A Canadian postal code in the address, e.g. "V6B 1A1" or "T2P1J9".
  fsa := (regexp_match(a, '(?:^|[^A-Z0-9])([A-Z])[0-9][A-Z] ?[0-9][A-Z][0-9](?:$|[^A-Z0-9])'))[1];
  if fsa is not null then
    return case fsa
      when 'V' then 'America/Vancouver'
      when 'T' then 'America/Edmonton'
      when 'S' then 'America/Regina'
      when 'R' then 'America/Winnipeg'
      when 'E' then 'America/Halifax'
      when 'B' then 'America/Halifax'
      when 'C' then 'America/Halifax'
      when 'A' then 'America/St_Johns'
      when 'Y' then 'America/Whitehorse'
      when 'X' then null            -- NT and NU share X; leave the default
      else 'America/Toronto'        -- K L M N P (ON), G H J (QC)
    end;
  end if;
  -- No postal code: a province code or name as its own word.
  prov := substring(a from '(?:^|[ ,])(BC|AB|SK|MB|ON|QC|NB|NS|PE|PEI|NL|YT)(?:$|[ ,.])');
  if prov is null then
    prov := case
      when a ~ 'BRITISH COLUMBIA' then 'BC'
      when a ~ 'ALBERTA' then 'AB'
      when a ~ 'SASKATCHEWAN' then 'SK'
      when a ~ 'MANITOBA' then 'MB'
      when a ~ 'NEW BRUNSWICK' then 'NB'
      when a ~ 'NOVA SCOTIA' then 'NS'
      when a ~ 'PRINCE EDWARD ISLAND' then 'PE'
      when a ~ 'NEWFOUNDLAND' then 'NL'
      when a ~ 'YUKON' then 'YT'
      else null
    end;
  end if;
  return case prov
    when 'BC' then 'America/Vancouver'
    when 'AB' then 'America/Edmonton'
    when 'SK' then 'America/Regina'
    when 'MB' then 'America/Winnipeg'
    when 'NB' then 'America/Halifax'
    when 'NS' then 'America/Halifax'
    when 'PE' then 'America/Halifax'
    when 'PEI' then 'America/Halifax'
    when 'NL' then 'America/St_Johns'
    when 'YT' then 'America/Whitehorse'
    else null
  end;
end;
$$;

create or replace function public.properties_first_rental_sets_timezone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  tz text;
begin
  if (select count(*) from public.properties p where p.organization_id = new.organization_id) <> 1 then
    return new;
  end if;
  tz := public.timezone_for_canadian_address(new.address);
  if tz is null or tz = 'America/Toronto' then
    return new;
  end if;
  update public.organizations o
     set booking_timezone = tz
   where o.id = new.organization_id
     and o.booking_timezone = 'America/Toronto';
  return new;
end;
$$;

revoke all on function public.properties_first_rental_sets_timezone() from public, anon, authenticated;

drop trigger if exists properties_first_rental_sets_timezone on public.properties;
create trigger properties_first_rental_sets_timezone
  after insert on public.properties
  for each row execute function public.properties_first_rental_sets_timezone();
