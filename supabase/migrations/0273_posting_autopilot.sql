-- S754 (review item 3): standing consent for the free robot sites. When on,
-- an ad the posting worker has prepared for Kijiji, Rentals.ca or Zumper is
-- approved at once and the robot posts it; the landlord no longer presses
-- "Approve and post" on every ad. Paid Kijiji ads still stop at the site's
-- checkout (needs_payment) for the landlord's card. The landlord can turn it
-- off on Billing. Default on: buying Posting and signing in to the site is
-- the consent. The Posting add-on gate (posting_addon_active) still applies.
alter table public.organizations
  add column if not exists posting_autopilot boolean not null default true;
comment on column public.organizations.posting_autopilot is
  'S754: post prepared free robot ads without a per-ad approval. Paid ads always wait at checkout.';
