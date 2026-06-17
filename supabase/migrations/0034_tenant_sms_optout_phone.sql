-- ============================================================================
-- 0034_tenant_sms_optout_phone — wire inbound STOP to tenants
--
-- 0033 added tenants.sms_opt_out + honored it on send, but nothing FLIPPED it
-- from an inbound STOP yet (the webhook matched leads only). This migration adds
-- the match key + audit timestamp so app/api/sms/inbound can suppress a tenant
-- who texts STOP, exactly like a lead.
--
--   * phone_e164    — the tenant's phone normalized to E.164, the column the
--                     inbound webhook matches on in SQL (mirrors leads.phone_e164
--                     from 0023). The app sets it at every tenant write via
--                     normalizePhoneE164; this migration backfills existing rows
--                     for the common North-American (+1) cases.
--   * sms_opt_out_at — when the opt-out last changed (parity with leads), for a
--                     clean audit; null when opted back in.
--
-- Why a normalized column (not a JS scan): a STOP must never be silently
-- dropped, and the SQL match has no row cap (the 0023 lesson that retired the
-- capped free-text JS scan for leads — see feedback_sms_optout_phone_e164).
-- ============================================================================

alter table public.tenants
  add column if not exists phone_e164      text,
  add column if not exists sms_opt_out_at  timestamptz;

-- Backfill phone_e164 from the existing free-text phone, matching the JS
-- normalizePhoneE164 default-region (+1 / NANP) behavior:
--   - already-"+"-prefixed: keep the digits if 8..15 long  -> '+' || digits
--   - exactly 10 digits                                    -> '+1' || digits
--   - 11 digits starting with 1                            -> '+'  || digits
--   - anything else                                        -> NULL (ambiguous)
update public.tenants t
set phone_e164 = sub.e164
from (
  select
    id,
    case
      when phone is null or btrim(phone) = '' then null
      when left(btrim(phone), 1) = '+' then
        case
          when length(regexp_replace(phone, '\D', '', 'g')) between 8 and 15
            then '+' || regexp_replace(phone, '\D', '', 'g')
          else null
        end
      when length(regexp_replace(phone, '\D', '', 'g')) = 10
        then '+1' || regexp_replace(phone, '\D', '', 'g')
      when length(regexp_replace(phone, '\D', '', 'g')) = 11
           and left(regexp_replace(phone, '\D', '', 'g'), 1) = '1'
        then '+' || regexp_replace(phone, '\D', '', 'g')
      else null
    end as e164
  from public.tenants
) sub
where t.id = sub.id
  and t.phone_e164 is null;

create index if not exists tenants_phone_e164_idx
  on public.tenants(phone_e164);
