-- 0099_codex_s388_s392_fixes.sql
-- S395 — lands the two findings from the S388–S392 Codex QA review
-- (VACANTLESS_CODEX_REVIEW_S388_S392_2026-07-01.md, range 76a526b..ac41085).
--
--   P2 — appliance_consumables (0096) let a direct authenticated write create a
--        row whose organization_id / property_id / appliance_id are mutually
--        inconsistent (RLS only checked organization_id IN user_org_ids(); it
--        never checked the parent appliance). The server action addConsumable is
--        safe because it denormalizes from the resolved parent, but the DB
--        surface was looser than the app surface, and the service-role cron trusts
--        the denormalized columns. Fix = a BEFORE INSERT/UPDATE trigger that
--        enforces the row matches its parent appliance's org + property (and the
--        property's own org), for EVERY writer/role, so the denormalization can
--        never drift.
--
--   P3 — record_showing_outcome_from_token (0098) inserted a "Viewing marked X."
--        timeline note on EVERY call, so a double-submit / retry / repeated same
--        tap created duplicate notes. Fix = when the incoming outcome equals the
--        already-recorded outcome, return ok without re-updating or re-noting.
--        A genuine correction (outcome changes) still updates + logs the note.
--
-- Both are additive/idempotent and reversible. No data change.

-- ===========================================================================
-- P2 — DB-level parent-consistency guard for appliance_consumables
-- ===========================================================================
-- Runs as the invoking role (SECURITY INVOKER, the default). For an authenticated
-- direct write this means the parent lookup is itself RLS-scoped: an appliance_id
-- outside the caller's org returns no row and is rejected as 'appliance not found'.
-- For the service-role cron (RLS bypassed) the checks still hold on the true
-- parent. Enforces:
--   * the parent appliance exists,
--   * consumable.organization_id  = appliance.organization_id,
--   * consumable.property_id      = appliance.property_id,
--   * the property's own organization_id = consumable.organization_id
--     (defense-in-depth in case a parent appliance were ever itself inconsistent).
create or replace function public.appliance_consumables_check_parent()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_app_org   uuid;
  v_app_prop  uuid;
  v_prop_org  uuid;
begin
  select a.organization_id, a.property_id
    into v_app_org, v_app_prop
    from public.unit_appliances a
   where a.id = new.appliance_id;

  if v_app_org is null then
    raise exception
      'appliance_consumables: parent appliance % not found', new.appliance_id
      using errcode = '23503';
  end if;

  if new.organization_id is distinct from v_app_org then
    raise exception
      'appliance_consumables: organization_id % does not match parent appliance org %',
      new.organization_id, v_app_org
      using errcode = '23514';
  end if;

  if new.property_id is distinct from v_app_prop then
    raise exception
      'appliance_consumables: property_id % does not match parent appliance property %',
      new.property_id, v_app_prop
      using errcode = '23514';
  end if;

  select p.organization_id
    into v_prop_org
    from public.properties p
   where p.id = new.property_id;

  if v_prop_org is distinct from new.organization_id then
    raise exception
      'appliance_consumables: property % belongs to org % not %',
      new.property_id, v_prop_org, new.organization_id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists appliance_consumables_parent_consistency
  on public.appliance_consumables;
create trigger appliance_consumables_parent_consistency
  before insert or update on public.appliance_consumables
  for each row execute function public.appliance_consumables_check_parent();

comment on function public.appliance_consumables_check_parent() is
  'S395/Codex P2: BEFORE INSERT/UPDATE guard ensuring an appliance_consumables row is consistent with its parent unit_appliances (same org + property) and that the property belongs to that org, so the denormalized org/property columns can never drift via a direct table write.';

-- ===========================================================================
-- P3 — make record_showing_outcome_from_token idempotent for the timeline note
-- ===========================================================================
-- Same body as 0098 plus an early return when the outcome is unchanged, so a
-- same-outcome replay does not append a duplicate 'Viewing marked X.' note.
create or replace function public.record_showing_outcome_from_token(
  p_token   uuid,
  p_outcome text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_showing public.showings%rowtype;
  v_label   text;
begin
  -- Only the three real outcomes the one-tap page offers. 'scheduled' is the
  -- not-recorded placeholder and is never a valid record-from-token value.
  if p_outcome is null or p_outcome not in ('attended','no_show','cancelled') then
    return jsonb_build_object('ok', false, 'reason', 'bad_outcome');
  end if;

  select * into v_showing
  from public.showings
  where outcome_token = p_token
  for update;
  if v_showing.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- Idempotency (Codex P3): a same-outcome replay (double-submit / retry /
  -- repeated tap) must not append a second identical timeline note. The outcome
  -- is already recorded, so return ok without re-updating or re-noting. A real
  -- correction (a DIFFERENT outcome) still falls through to the update + note.
  if v_showing.outcome is not distinct from p_outcome then
    return jsonb_build_object('ok', true, 'outcome', p_outcome, 'unchanged', true);
  end if;

  update public.showings
     set outcome = p_outcome
   where id = v_showing.id;

  -- Replay updateShowingOutcome's lead-side effects (only when the showing is
  -- tied to a lead; ad-hoc showings just set the outcome).
  if v_showing.lead_id is not null then
    -- attended advances the lead to 'showed' from the allowed prior stages only.
    if p_outcome = 'attended' then
      update public.leads
         set status = 'showed'
       where id = v_showing.lead_id
         and status in ('new','replied','contacted','booked');
    end if;

    v_label := case p_outcome
      when 'attended'  then 'Attended'
      when 'no_show'   then 'No-show'
      when 'cancelled' then 'Cancelled'
      else p_outcome
    end;

    insert into public.messages (organization_id, lead_id, channel, direction, body)
    values (v_showing.organization_id, v_showing.lead_id, 'note', 'outbound',
            'Viewing marked ' || v_label || '.');
  end if;

  return jsonb_build_object('ok', true, 'outcome', p_outcome);
end;
$$;

grant execute on function public.record_showing_outcome_from_token(uuid, text)
  to anon, authenticated;
