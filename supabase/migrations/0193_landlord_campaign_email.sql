-- ============================================================================
-- 0193_landlord_campaign_email — explicit LANDLORD recipient for the campaign
--
-- The landlord feature-reveal campaign (Tier 1 C) must email the LANDLORD, not
-- the org member. For a proxy-onboarded org the sole member is the AGENT (e.g.
-- the brokerage), so routing to the member emails the wrong person. This column
-- holds the landlord's email; the cron sweep routes here and SKIPS any org where
-- it is unset (it never falls back to the member). Nullable + additive.
-- ============================================================================

alter table public.organizations
  add column if not exists landlord_campaign_email text;

comment on column public.organizations.landlord_campaign_email is
  'Recipient for the landlord feature-reveal campaign. Must be the landlord, not the org member/agent. NULL => the campaign skips this org.';
