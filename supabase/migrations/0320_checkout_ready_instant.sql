-- S829f (Noam, 2026-11-22): the ready-to-pay email goes out the moment the
-- robot leaves a paid ad at checkout, not at the next 15-minute sweep. His
-- first one arrived 15 minutes late; "people will walk away and leave before
-- checking out".
--
-- When a run item turns needs_payment, the database calls
-- /api/cron/checkout-ready through pg_net, proving itself with the vault's
-- sweep secret (0245). pg_net sends after the change commits. The route is
-- idempotent (claimNull on checkout_notified_at), and the 15-minute sweep
-- stays on as the backup. A failed call never blocks the robot's write.
--
-- GRANT check: one trigger function, not callable by any API role. No new table.

create or replace function public.notify_checkout_ready()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  begin
    select decrypted_secret into v_secret
      from vault.decrypted_secrets
     where name = 'sweep_trigger_secret';
    if v_secret is not null then
      perform net.http_get(
        url := 'https://vacantless-app.vercel.app/api/cron/checkout-ready',
        headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
        timeout_milliseconds := 60000
      );
    end if;
  exception when others then
    null; -- the 15-minute sweep sends it instead
  end;
  return new;
end
$$;

revoke all on function public.notify_checkout_ready() from public, anon, authenticated;

drop trigger if exists distribution_run_items_checkout_ready on public.distribution_run_items;
create trigger distribution_run_items_checkout_ready
  after update of publish_status, operator_action_url on public.distribution_run_items
  for each row
  when (
    new.publish_status = 'needs_payment'
    and new.operator_action_url is not null
    and new.checkout_notified_at is null
    and (
      old.publish_status is distinct from new.publish_status
      or old.operator_action_url is distinct from new.operator_action_url
    )
  )
  execute function public.notify_checkout_ready();
