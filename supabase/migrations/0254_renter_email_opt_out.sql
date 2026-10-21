-- S728: a renter's unsubscribe is recorded on the lead itself, so it stands
-- even after Brevo's blocklist entry is lifted for the renter's own
-- transactional email (booking confirmation, reminders).
--
-- Marketing emails (nurture, new viewing times, waitlist, price drop) skip any
-- lead with email_opt_out_at set. Transactional email still goes out: a renter
-- who books a viewing has asked for the confirmation.

alter table public.leads
  add column if not exists email_opt_out_at timestamptz;

create index if not exists leads_email_opt_out_idx
  on public.leads (email_opt_out_at) where email_opt_out_at is not null;

-- Backfill from the blocklist rows the guard sweep already recorded.
update public.leads l
   set email_opt_out_at = e.occurred_at
  from public.email_delivery_events e
 where e.kind = 'blocklist'
   and e.reason in ('unsubscribedViaEmail', 'unsubscribedViaApi', 'unsubscribedViaMA')
   and lower(l.email) = lower(e.email)
   and l.email_opt_out_at is null;

-- S728: the Brevo webhook stored its local-time "date" as UTC, so every event
-- it wrote sits 4 hours early (the rows are 4 h older than created_at, which
-- is impossible for a webhook that fires within seconds). Shift those rows.
update public.email_delivery_events
   set occurred_at = occurred_at + interval '4 hours'
 where message_id is not null
   and created_at - occurred_at between interval '3 hours 50 minutes' and interval '5 hours 10 minutes';

-- S728: sweep-all keeps what each sweep answered (reason, sent), so a sweep
-- switched off by a flag or quietly sending nothing shows in the health email.
alter table public.sweep_runs
  add column if not exists details jsonb not null default '{}'::jsonb;


-- ---------------------------------------------------------------------------
-- S728: pre-screening can gate self-booking. Off by default. When on, a renter
-- whose answers qualify out (income, move-in or pets only; never occupants or
-- any protected ground) is filed as a lead and told the team will be in
-- touch, instead of booking a slot themselves. The lead and its answers are
-- stored exactly as before; the operator still decides.
-- ---------------------------------------------------------------------------
alter table public.organizations
  add column if not exists screening_gate_booking boolean not null default false;
comment on column public.organizations.screening_gate_booking is
  'S728: when true, a renter whose pre-screening answers qualify out cannot self-book a viewing; the lead is filed and the team follows up.';

-- submit_public_lead: two more keys in the result (qualified_out, gate_booking).
-- Patched by anchors like 0230 and 0238, so their patches survive.
do $mig$
declare
  v_sig text := 'public.submit_public_lead(uuid,text,text,text,date,text,uuid,integer,integer,boolean,text,jsonb,boolean,text,text,text)';
  v_def text;
  a_decl text := E'  v_lead_has_showing boolean := false;\n';
  a_ret  text := E'    ''lead_has_showing'', v_lead_has_showing,\n';
  a_sel  text := E'  select t.subject, t.body\n';
begin
  v_def := pg_get_functiondef(v_sig::regprocedure);
  if position('v_gate_booking' in v_def) > 0 then
    raise notice '0254 already applied';
    return;
  end if;
  if position(a_decl in v_def) = 0 then raise exception '0254 anchor decl not found'; end if;
  if position(a_ret in v_def) = 0 then raise exception '0254 anchor return not found'; end if;
  if position(a_sel in v_def) = 0 then raise exception '0254 anchor select not found'; end if;

  v_def := replace(v_def, a_decl,
    a_decl || E'  v_gate_booking boolean := false;\n  v_lead_qualout boolean := false;\n');
  v_def := replace(v_def, a_sel,
       E'  -- S728: the booking gate. The app skips self-booking when the account\n'
    || E'  -- gates it and this renter qualified out (income, move-in or pets only).\n'
    || E'  select coalesce(o.screening_gate_booking, false) into v_gate_booking\n'
    || E'    from public.organizations o where o.id = v_org;\n'
    || E'  select coalesce(l.qualified_out, false) into v_lead_qualout\n'
    || E'    from public.leads l where l.id = v_lead;\n\n'
    || a_sel);
  v_def := replace(v_def, a_ret,
    a_ret || E'    ''qualified_out'',    v_lead_qualout,\n    ''gate_booking'',     v_gate_booking,\n');
  execute v_def;
end
$mig$;
