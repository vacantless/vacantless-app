-- 0319_checkout_ready_email.sql
-- S829c: email the landlord when the robot leaves a paid ad waiting at a
-- site's checkout, and remind once if it is still unpaid. People approve and
-- walk away; without this the ad sat unpaid with nothing telling them.
-- Stamps live on the run item; both clear when the item leaves needs_payment.
alter table public.distribution_run_items
  add column if not exists checkout_notified_at timestamptz,
  add column if not exists checkout_reminded_at timestamptz;

comment on column public.distribution_run_items.checkout_notified_at is
  'S829c: when the "ready to pay" email went out for this checkout.';
comment on column public.distribution_run_items.checkout_reminded_at is
  'S829c: when the one reminder went out, if the ad was still unpaid.';
