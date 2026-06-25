-- 0072 — per-event accent color for the branded notification email (S332).
--
-- Notification parity for leasing.new_lead: alongside operator-editable copy +
-- recipients (0067), an org can set a per-event accent color for the email's top
-- stripe — the "urgency" cue that makes a new-lead email read like Agile's old
-- "ACTION REQUIRED" alert. NULL = follow the event's code default (leasing.new_lead
-- defaults to alert red) or, absent that, the org brand color. Stored as a strict
-- #RRGGBB hex; the column is operator-data only (a color), never raw HTML, so it
-- cannot inject into the email template (the template stays escaped).

alter table public.notification_settings
  add column if not exists accent_color text;

comment on column public.notification_settings.accent_color is
  'Per-event branded-email top-stripe color as a #RRGGBB hex (S332). NULL = use the event default accent (e.g. leasing.new_lead alert red) or the org brand color. Operator-data only; never HTML.';

-- Strict 7-char hex guard so only a real color reaches the email shell.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'notification_settings_accent_color_hex'
  ) then
    alter table public.notification_settings
      add constraint notification_settings_accent_color_hex
      check (accent_color is null or accent_color ~ '^#[0-9a-fA-F]{6}$');
  end if;
end $$;
