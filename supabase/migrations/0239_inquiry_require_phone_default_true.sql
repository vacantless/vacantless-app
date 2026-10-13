-- S712 (Noam, 2026-10-13): new landlords ask renters for a phone by default.
-- Agile data since 2026-07-16: renters with a phone booked 64 and showed 16;
-- renters without one booked 7 and showed 0 (2 no-shows). The landlord can
-- still turn it off (Leasing > Questions for renters). Existing orgs keep
-- whatever they have; only the default for new orgs changes.
alter table public.organizations
  alter column inquiry_require_phone set default true;
