-- S801 (REVIEW-S799 items 13 and 14): service-only claim function, no public execute on trigger helpers, fixed search_path on three functions.
revoke execute on function public.claim_approved_distribution_run_item_for_worker(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.claim_approved_distribution_run_item_for_worker(uuid, uuid, text, uuid) to service_role;

revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
revoke execute on function public.enforce_showing_agent_same_org() from public, anon, authenticated;
revoke execute on function public.capture_property_leased_outcome() from public, anon, authenticated;
revoke execute on function public.lead_back_to_worklist_on_cancel() from public, anon, authenticated;
revoke execute on function public.set_showing_slot_lock() from public, anon, authenticated;

alter function public.distribution_channel_list_price_cents(text) set search_path = pg_catalog, public;
alter function public.organizations_guard_posting_addon() set search_path = pg_catalog, public;
alter function public.organizations_guard_billing() set search_path = pg_catalog, public;
