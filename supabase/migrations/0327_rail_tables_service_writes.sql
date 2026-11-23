-- 0327_rail_tables_service_writes.sql
-- S835e (REVIEW-S835 finding 7). stripe_connect_accounts and rotessa_accounts
-- hold which Stripe account and which Rotessa key an account collects rent
-- with. Any signed-in member could write their own account's row straight
-- through the API, skipping the manage_rent check, and so point their account
-- at another landlord's Stripe account id. From S835e the app writes both
-- tables with the service role only (settings/stripe-connect-actions.ts and
-- settings/rotessa-actions.ts, after the rent check). These restrictive
-- policies refuse insert, update and delete from a signed-in session; reads
-- are unchanged. The service role is not subject to row security.
-- APPLY ONLY AFTER the S835e app is live: the older app wrote as the user.
-- Additive: nothing is dropped.

create policy stripe_connect_accounts_no_user_insert on public.stripe_connect_accounts
  as restrictive for insert to authenticated with check (false);
create policy stripe_connect_accounts_no_user_update on public.stripe_connect_accounts
  as restrictive for update to authenticated using (false) with check (false);
create policy stripe_connect_accounts_no_user_delete on public.stripe_connect_accounts
  as restrictive for delete to authenticated using (false);

create policy rotessa_accounts_no_user_insert on public.rotessa_accounts
  as restrictive for insert to authenticated with check (false);
create policy rotessa_accounts_no_user_update on public.rotessa_accounts
  as restrictive for update to authenticated using (false) with check (false);
create policy rotessa_accounts_no_user_delete on public.rotessa_accounts
  as restrictive for delete to authenticated using (false);
