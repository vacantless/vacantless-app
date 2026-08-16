-- ============================================================================
-- 0215_property_photos_storage_prefix_guard
--
-- Prevent property_photos rows from pointing at an object path outside the
-- owning property's organization prefix. Storage writes are already org-scoped,
-- but the table also needs a write-time guard so a copied/imported row cannot
-- disagree with the property it belongs to.
-- ============================================================================

create or replace function public.enforce_property_photo_storage_prefix()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_property_org uuid;
  v_storage_org text;
begin
  select p.organization_id
    into v_property_org
    from public.properties p
   where p.id = new.property_id;

  if v_property_org is null then
    raise exception 'property_photos.property_id % does not reference a property', new.property_id
      using errcode = '23503';
  end if;

  if new.organization_id is distinct from v_property_org then
    raise exception 'property_photos.organization_id must match property organization_id'
      using errcode = '23514';
  end if;

  v_storage_org := split_part(coalesce(new.storage_path, ''), '/', 1);
  if v_storage_org = '' or v_storage_org <> v_property_org::text then
    raise exception 'property_photos.storage_path prefix must match property organization_id'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists property_photos_storage_prefix_guard on public.property_photos;
create trigger property_photos_storage_prefix_guard
  before insert or update of property_id, organization_id, storage_path
  on public.property_photos
  for each row
  execute function public.enforce_property_photo_storage_prefix();
