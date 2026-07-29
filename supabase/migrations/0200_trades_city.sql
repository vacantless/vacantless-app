-- 0200_trades_city.sql
-- City/location scoping for the private trade rolodex (trade_contacts) and the
-- trade network (directory_trades). Additive + nullable, so this is safe to
-- apply ahead of the deploy (KI962). The app ignores the column until the S599
-- city-scoping UI ships.
alter table public.trade_contacts add column if not exists city text;
alter table public.directory_trades add column if not exists city text;

-- Backfill the S599 seed rows (Davis Muscovitch Rentals) from their seed notes.
update public.trade_contacts set city = 'Toronto'
  where organization_id = '9315e41e-1c03-43e3-9c8f-78563512f302'
    and name in ('Aviv Plumbing Inc.','Keystone Mechanical Group Inc.','Joe Silva','Micro Moves Inc.','Steve Campbell')
    and city is null;
update public.trade_contacts set city = 'Blue Mountains'
  where organization_id = '9315e41e-1c03-43e3-9c8f-78563512f302'
    and name in ('Georgian Lawn & Property Care Inc.','Alexa Jackson Creative')
    and city is null;
