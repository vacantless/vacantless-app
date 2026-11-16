-- S801: both functions already refuse non-members; signed-out callers have no use for them.
revoke execute on function public.claim_concierge_leaseup(uuid, text, uuid, integer) from public, anon;
revoke execute on function public.claim_lease_ocr_scan(uuid, text, integer) from public, anon;
grant execute on function public.claim_concierge_leaseup(uuid, text, uuid, integer) to authenticated, service_role;
grant execute on function public.claim_lease_ocr_scan(uuid, text, integer) to authenticated, service_role;
