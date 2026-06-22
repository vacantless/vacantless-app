-- ============================================================================
-- 0056_directory_trade_use — the proof-loop flywheel write (trades directory
-- Slice 2, S309). See VACANTLESS-TRADES-DIRECTORY-MODULE-SPEC-2026-06-22.md.
--
-- addDirectoryTradeToRolodex (Slice 2) copies a network listing into the
-- adding org's private rolodex AND bumps the listing's used_count — the social
-- proof that powers "Used by N landlords near you" and the ranking flywheel.
--
-- The catch: that listing belongs to ANOTHER org. directory_trades' write RLS
-- (0055) is own-org-only (a tenant org can UPDATE only the rows IT contributed),
-- so a cross-org used_count++ is blocked by design. Rather than hand a broad
-- service_role client to a user-facing server action, the bump goes through this
-- ONE narrowly-scoped SECURITY DEFINER function. It mirrors the
-- anon-RPC-revalidate-server-side rule: it re-checks the gate in SQL (only a
-- LISTED, non-archived row), refuses to count an org inflating its OWN listing,
-- and can do nothing else — it returns void and touches a single counter column.
-- ============================================================================

create or replace function public.increment_directory_trade_use(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.directory_trades
     set used_count = used_count + 1,
         updated_at = now()
   where id = p_id
     and listed = true
     and archived = false
     -- no self-inflation: an org adding its own listing does not count.
     and (contributed_by_org is null
          or contributed_by_org not in (select public.user_org_ids()));
$$;

revoke all on function public.increment_directory_trade_use(uuid) from public;
grant execute on function public.increment_directory_trade_use(uuid) to authenticated, service_role;
