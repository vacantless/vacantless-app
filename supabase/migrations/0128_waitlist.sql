-- ============================================================================
-- 0128_waitlist — waiting list: capture interested renters + notify on vacancy (S457)
--
-- When a renter reaches a listing that is no longer available (leased/paused),
-- today the lead is lost. This table captures them onto a per-property (or
-- org-wide) waiting list so that when the unit becomes available again the
-- operator can notify everyone waiting with one tap. It is the Rentsync
-- "waiting lists" gap and a sticky top-of-funnel capture.
--
-- Shape mirrors the recent per-record features (tenancy_violations 0092 /
-- tenancy_insurance 0091):
--   * organization_id is DENORMALIZED onto the row so RLS gates on
--     organization_id IN user_org_ids() with no join, and the operator
--     notify/match runs filter by org directly.
--   * property_id is NULLABLE: a row tied to a property waits for THAT unit; a
--     null property_id is an org-wide "notify me about anything" entry. ON
--     DELETE SET NULL so deleting a property demotes its waiters to org-wide
--     rather than dropping them.
--   * explicit grants (auto-expose of new tables is OFF); service_role gets DML
--     for any future sweep; authenticated for the operator dashboard.
--
-- PUBLIC capture path: the renter-facing /r listing page inserts via the
-- SECURITY DEFINER join_waitlist() RPC below (mirrors submit_public_lead), so
-- anon NEVER gets a direct table grant — the RPC resolves the org from the
-- property server-side and re-validates (KI348/715). The RPC stores only
-- contact + preference facts the renter volunteers (name/email/phone/beds/rent/
-- move-in); NO DL/SIN/credit PII ever lands here, per the standing rule.
--
-- PII posture: same as leads — volunteered contact + preferences only.
--
-- All additive; ships inert (no rows until a renter joins or an operator adds
-- one). The operator manage/notify surface is gated by the `waitlist`
-- entitlement (Growth+) in lib/billing.ts, so the feature ships dark for
-- ungated plans (their public form still captures, which is the upgrade hook).
-- ============================================================================

create table if not exists public.waitlist_entries (
  id                        uuid primary key default gen_random_uuid(),
  organization_id           uuid not null references public.organizations(id) on delete cascade,
  -- The unit they are waiting for. NULL = org-wide ("notify me about anything").
  property_id               uuid references public.properties(id) on delete set null,

  -- Volunteered contact. At least one of email / phone is required (enforced in
  -- the RPC and the operator action); both nullable at the column level so an
  -- operator can log a partial record.
  name                      text,
  email                     text,
  phone                     text,
  phone_e164                text,

  -- Optional matching preferences. When set, the vacancy must satisfy them for
  -- this entry to be considered a match (see lib/waitlist.matchesVacancy).
  beds_min                  integer,
  max_rent_cents            integer,
  move_in_by                date,

  -- Freeform note from the renter (public form) and/or the operator.
  message                   text,
  notes                     text,

  -- Where the row came from: 'public' (the /r join form) or 'operator' (manual).
  source                    text not null default 'public'
                              check (source in ('public', 'operator')),

  -- Lifecycle. 'active' = still waiting (the only state the notify match acts
  -- on); 'converted' = became a lead/tenant; 'removed' = operator dismissed.
  status                    text not null default 'active'
                              check (status in ('active', 'converted', 'removed')),

  -- Notify idempotency: the vacancy this entry was last notified about, so
  -- re-running "Notify waitlist" for the SAME available unit never double-sends.
  -- Clearing it (or a different property becoming available) re-arms.
  last_notified_at          timestamptz,
  last_notified_property_id uuid references public.properties(id) on delete set null,

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index if not exists waitlist_entries_org_idx      on public.waitlist_entries(organization_id);
create index if not exists waitlist_entries_property_idx on public.waitlist_entries(property_id);
create index if not exists waitlist_entries_status_idx   on public.waitlist_entries(organization_id, status);

comment on table public.waitlist_entries is
  'Waiting list (S457): interested renters captured for a property (or org-wide) so the operator can notify them when a unit becomes available. Volunteered contact + preferences only — no DL/SIN/credit PII. Public capture via join_waitlist(); operator manage/notify gated by the `waitlist` entitlement.';
comment on column public.waitlist_entries.property_id is
  'The unit waited for; NULL = org-wide. ON DELETE SET NULL demotes waiters to org-wide instead of dropping them.';
comment on column public.waitlist_entries.last_notified_property_id is
  'The available property this entry was last notified about; the once-per-vacancy idempotency stamp for the operator notify action.';

-- ---------------------------------------------------------------------------
-- RLS — per-org, identical shape to tenancy_violations (0092).
-- ---------------------------------------------------------------------------
alter table public.waitlist_entries enable row level security;

drop policy if exists waitlist_entries_all on public.waitlist_entries;
create policy waitlist_entries_all on public.waitlist_entries
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

-- ---------------------------------------------------------------------------
-- Grants — explicit (auto-expose of new tables is OFF). authenticated for the
-- dashboard; service_role for any future sweep. Anon gets NO table grant — it
-- reaches the table only through the SECURITY DEFINER RPC below.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.waitlist_entries to authenticated;
grant select, insert, update, delete on public.waitlist_entries to service_role;

-- ---------------------------------------------------------------------------
-- Public join RPC. Anon-safe: resolves the org from the property server-side,
-- re-validates (property must exist; a reachable contact is required), and
-- inserts a 'public' active entry. Mirrors submit_public_lead — the renter can
-- add themselves to a waiting list but can never read or target another org's
-- data. Returns the new id, or NULL if the property is unknown or no contact
-- was given (the caller treats NULL as a soft no-op, never an error).
-- ---------------------------------------------------------------------------
create or replace function public.join_waitlist(
  p_property_id     uuid,
  p_name            text,
  p_email           text,
  p_phone           text,
  p_beds_min        integer,
  p_max_rent_cents  integer,
  p_move_in_by      date,
  p_message         text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org     uuid;
  v_email   text := nullif(btrim(p_email), '');
  v_phone   text := nullif(btrim(p_phone), '');
  v_digits  text;
  v_e164    text;
  v_id      uuid;
begin
  -- Resolve the org from the property. Unknown property -> soft no-op.
  select organization_id into v_org
    from public.properties
   where id = p_property_id;
  if v_org is null then
    return null;
  end if;

  -- Need a reachable contact.
  if v_email is null and v_phone is null then
    return null;
  end if;

  -- Best-effort E.164 for a NANP number: keep digits, drop a leading country 1,
  -- and only accept exactly 10 remaining digits. Anything else stays null (the
  -- raw phone is still stored for the operator to read).
  if v_phone is not null then
    v_digits := regexp_replace(v_phone, '\D', '', 'g');
    if length(v_digits) = 11 and left(v_digits, 1) = '1' then
      v_digits := right(v_digits, 10);
    end if;
    if length(v_digits) = 10 then
      v_e164 := '+1' || v_digits;
    end if;
  end if;

  insert into public.waitlist_entries (
    organization_id, property_id, name, email, phone, phone_e164,
    beds_min, max_rent_cents, move_in_by, message, source, status
  ) values (
    v_org,
    p_property_id,
    nullif(btrim(p_name), ''),
    v_email,
    v_phone,
    v_e164,
    -- Guard the preference ints to sane ranges so a malformed client can't store junk.
    case when p_beds_min between 0 and 20 then p_beds_min else null end,
    case when p_max_rent_cents between 0 and 100000000 then p_max_rent_cents else null end,
    p_move_in_by,
    nullif(btrim(p_message), ''),
    'public',
    'active'
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.join_waitlist(uuid, text, text, text, integer, integer, date, text) from public;
grant execute on function public.join_waitlist(uuid, text, text, text, integer, integer, date, text) to anon, authenticated;
