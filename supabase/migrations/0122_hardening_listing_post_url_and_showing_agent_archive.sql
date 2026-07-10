-- ============================================================================
-- 0122_hardening_listing_post_url_and_showing_agent_archive
--
-- Defense-in-depth from the S447 Paul-Schwartz production dogfood (Codex P2s):
-- close two gaps where a server action guarded a rule but the DB did not, so an
-- authenticated DIRECT table write (PostgREST under the user's RLS) could bypass
-- it.
--
-- (1) listing_posts: a 'live' post with no url can't be tracked or reopened.
--     lib/listing-distribution.validateListingPost blocks it in the server
--     action, but a direct authenticated insert/update did not. Enforce it with
--     a CHECK. One pre-existing anomalous row (Maple Door, kijiji, url null,
--     status live, created 2026-06-16) is demoted to 'draft' first so the
--     constraint can be added cleanly.
--
-- (2) showing_agents is archive-only (the `archived` flag; a showing's
--     assignment history must survive, and assigned_agent_id is ON DELETE SET
--     NULL). But DELETE was granted to `authenticated`, so a direct delete could
--     erase that history. Revoke DELETE from authenticated; `service_role` keeps
--     it (crons + the organizations ON DELETE CASCADE), so the app is
--     archive-only by construction. The app has no hard-delete path today.
--
-- Reversible: drop the CHECK; re-grant delete on showing_agents to authenticated.
-- ============================================================================

-- (1) listing_posts: a live post must carry a usable url ------------------------
update public.listing_posts
   set status = 'draft'
 where status = 'live' and (url is null or btrim(url) = '');

alter table public.listing_posts
  drop constraint if exists listing_posts_live_needs_url_chk;
alter table public.listing_posts
  add constraint listing_posts_live_needs_url_chk
  check (status <> 'live' or (url is not null and btrim(url) <> ''));

-- (2) showing_agents: archive-only (no hard delete from the app) ----------------
revoke delete on public.showing_agents from authenticated;
