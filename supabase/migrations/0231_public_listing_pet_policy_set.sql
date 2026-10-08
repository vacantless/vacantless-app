-- S702: the booking form told renters "This home isn't pet-friendly" for every
-- listing whose landlord never set a pet policy, because pet_friendly coalesces
-- an unset policy to false. Add pet_policy_set (true when any of the property,
-- building or org pet fields is set) so the form only states a policy that the
-- landlord actually gave. Additive key; pet_friendly is unchanged.
do $mig$
declare
  v_def text;
  v_anchor text := E'    ''pet_friendly'',';
  v_patch text := E'    ''pet_policy_set'',   (coalesce(p.pets_cats, bp.policy_pets_cats, o.policy_pets_cats) is not null\n'
    || E'                          or coalesce(p.pets_dogs, bp.policy_pets_dogs, o.policy_pets_dogs) is not null),\n'
    || E'    ''pet_friendly'',';
begin
  v_def := pg_get_functiondef('public.get_public_listing(uuid)'::regprocedure);
  if position('''pet_policy_set''' in v_def) > 0 then
    raise notice 'already patched';
    return;
  end if;
  if (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'S702 anchor not unique in get_public_listing';
  end if;
  execute replace(v_def, v_anchor, v_patch);
end
$mig$;
