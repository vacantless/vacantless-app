-- ============================================================================
-- 0055_directory_trades — the local "trusted trades" network (trades directory),
-- the second half of the maintenance keystone (S308). See
-- VACANTLESS-TRADES-DIRECTORY-MODULE-SPEC-2026-06-22.md.
--
-- The work-order module (0054) lets an owner bring + track THEIR OWN trades in a
-- per-org-private rolodex (trade_contacts). This adds the other thing the wedge
-- needs: the ability to DISCOVER a local network of trades other landlords use —
-- without becoming the 8% property manager. The owner still chooses, contracts,
-- and pays the trade directly; the directory is a phonebook + a one-click "add
-- to my trades", never a dispatcher-and-payer. (Same "we record, we don't
-- process" discipline as the rent rail.)
--
-- *** THIS IS THE FIRST INTENTIONALLY CROSS-ORG-READABLE TABLE. ***
-- Every other table in the app is strict per-org RLS (an org sees only its own
-- rows, gated on organization_id in (select public.user_org_ids())). A directory
-- is by definition cross-org, so this is a real boundary change. It gets its own
-- table (we NEVER relax trade_contacts' per-org RLS) and a single, auditable
-- cross-org read policy. The rules baked in here:
--
--   1. Separate table. trade_contacts stays private; directory_trades is new and
--      has a deliberately different, narrower-than-it-looks read policy.
--   2. Opt-in. A private trade is NOT discoverable by default. A row only becomes
--      cross-org-visible when listed = true (an owner action), and the matching
--      trade_contacts.directory_opt_in marks the source rolodex row.
--   3. PII minimization. The cross-org read returns business name + trade type +
--      service area + blurb. phone/email live on the row but the application read
--      path strips them unless the viewer added the trade or it is contact_public
--      (lib/directory.ts publicListingView / canRevealContact). The casual
--      cross-org reader is not a contact-scraping vector.
--   4. Write-scoping stays per-org. An org can only insert/update/delete the rows
--      IT contributed (contributed_by_org in user_org_ids()). Self-registered +
--      curated rows (contributed_by_org is null) are written through the
--      service_role path (public signup + admin curation), never by a tenant org.
--
-- Conventions mirror 0054: free-ish text + CHECK whitelist (not a pg enum) for
-- `source`; explicit grants because auto-expose of new tables is OFF; service_role
-- gets DML for the public-signup + curation paths.
-- ============================================================================

create table if not exists public.directory_trades (
  id              uuid primary key default gen_random_uuid(),

  -- provenance / sourcing -----------------------------------------------------
  source          text not null default 'landlord'
                    check (source in ('landlord','self','curated')),
  -- the org that contributed a 'landlord' listing (null for self/curated). Used
  -- for WRITE-scoping ("edit your own listing"), NOT for read-scoping.
  contributed_by_org uuid references public.organizations(id) on delete set null,
  -- optional link back to the private rolodex row this was promoted from.
  source_trade_contact_id uuid references public.trade_contacts(id) on delete set null,

  -- public, minimized fields (safe to read cross-org) -------------------------
  business_name   text not null,
  trade_type      text,          -- 'Plumber','Roofer','HVAC', ... (free text, matches trade_contacts)
  service_area    text,          -- 'Windsor, ON' / 'GTA' — a region, never a street address
  blurb           text,          -- short description

  -- contact (revealed on add / intro, or when self-listed public) -------------
  phone           text,
  email           text,
  contact_public  boolean not null default false,  -- may contact show pre-add?

  -- lifecycle + growth signal -------------------------------------------------
  listed          boolean not null default false,  -- opt-in: discoverable only when true
  verified        boolean not null default false,  -- Vacantless-verified badge (curated only)
  archived        boolean not null default false,
  used_count      integer not null default 0
                    check (used_count >= 0),        -- proof-loop flywheel: ++ on each add-to-rolodex

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists directory_trades_listed_idx on public.directory_trades(listed, archived);
create index if not exists directory_trades_area_idx   on public.directory_trades(service_area);
create index if not exists directory_trades_org_idx    on public.directory_trades(contributed_by_org);

-- ---------------------------------------------------------------------------
-- RLS — the ONE place cross-org read is granted, plus per-org write-scoping.
-- ---------------------------------------------------------------------------
alter table public.directory_trades enable row level security;

-- READ (cross-org): any authenticated user may see LISTED, non-archived rows.
-- This is the deliberate boundary change — and it is auditable in this one
-- policy. Field minimization (hiding phone/email) is enforced in the app read
-- path, not here, because RLS gates rows not columns.
drop policy if exists directory_trades_read on public.directory_trades;
create policy directory_trades_read on public.directory_trades
  for select
  using (listed = true and archived = false);

-- READ (own): an org can always read its own contributed rows, even unlisted /
-- archived ones, so it can manage them.
drop policy if exists directory_trades_read_own on public.directory_trades;
create policy directory_trades_read_own on public.directory_trades
  for select
  using (contributed_by_org in (select public.user_org_ids()));

-- WRITE (own only): an org may insert/update/delete only the rows it contributed.
-- A null contributed_by_org (self/curated) is NOT writable by any tenant org —
-- those go through the service_role path. Splitting INSERT from UPDATE/DELETE so
-- the INSERT check can't be satisfied by a row that simply omits the org.
drop policy if exists directory_trades_insert_own on public.directory_trades;
create policy directory_trades_insert_own on public.directory_trades
  for insert
  with check (contributed_by_org in (select public.user_org_ids()));

drop policy if exists directory_trades_update_own on public.directory_trades;
create policy directory_trades_update_own on public.directory_trades
  for update
  using (contributed_by_org in (select public.user_org_ids()))
  with check (contributed_by_org in (select public.user_org_ids()));

drop policy if exists directory_trades_delete_own on public.directory_trades;
create policy directory_trades_delete_own on public.directory_trades
  for delete
  using (contributed_by_org in (select public.user_org_ids()));

-- ---------------------------------------------------------------------------
-- Grants — explicit (auto-expose of new tables is OFF). authenticated for the
-- dashboard; service_role for the public self-registration + curation paths.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.directory_trades to authenticated;
grant select, insert, update, delete on public.directory_trades to service_role;

-- ---------------------------------------------------------------------------
-- Opt-in marker on the private rolodex. The owner flips this when promoting a
-- trade into the directory; the promote action copies minimized fields across
-- (lib/directory.ts minimizeForDirectory). trade_contacts itself stays per-org
-- private — this column only records the owner's consent to be listed.
-- ---------------------------------------------------------------------------
alter table public.trade_contacts
  add column if not exists directory_opt_in boolean not null default false;
