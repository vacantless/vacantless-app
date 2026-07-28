import { createClient } from "@/lib/supabase/server";
import { readSelectedOrgCookie, validateSelectedOrg } from "@/lib/selected-org";

export type Org = {
  id: string;
  name: string;
  slug: string;
  brand_color: string;
  brand_color_secondary: string | null;
  logo_url: string | null;
  reply_to_email: string | null;
  plan: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string | null;
  current_period_end: string | null;
  pilot_started_at: string | null;
  pilot_deposit_status: string;
  pilot_deposit_payment_intent_id: string | null;
  pilot_deposit_amount_cents: number | null;
  pilot_deposit_paid_at: string | null;
  booking_timezone: string;
  booking_requires_confirmation: boolean;
  feedback_enabled: boolean;
  feedback_delay_hours: number;
  nurture_enabled: boolean;
  sms_enabled: boolean;
  clustering_enabled: boolean;
  clustering_buffer_minutes: number;
  showing_block_capacity: number;
  // S443: opt-in auto-assign of self-booked viewings to a showing agent.
  auto_assign_agents: boolean;
  showing_confirm_mode: "auto" | "agent";
  auto_release_unconfirmed_enabled: boolean;
  auto_release_unconfirmed_hours: number;
  showing_autoclose_enabled: boolean;
  showing_autoclose_after_hours: number;
  // S445: post-showing outcome-nudge cadence cap. 1 = just once, 3 = follow up
  // until answered. "Off" is the event toggle in Automations & Templates.
  outcome_nudge_max: number;
  screening_enabled: boolean;
  screening_income_multiple: number | null;
  screening_max_movein_days: number | null;
  screening_flag_pets: boolean;
  screening_reason_income: string | null;
  screening_reason_movein: string | null;
  screening_reason_pets: string | null;
  screening_ask_income: boolean;
  screening_ask_movein: boolean;
  screening_ask_pets: boolean;
  screening_ask_occupants: boolean;
  public_contact_phone: string | null;
  public_contact_email: string | null;
  landlord_campaign_email: string | null;
  showing_arrival_phone: string | null;
  // Standard-policy profile defaults (0048). Inherited by every unit unless the
  // unit overrides them. lease_term defaults to '1_year' in the DB.
  policy_lease_term: string;
  policy_smoking: string | null;
  policy_ac_type: string | null;
  policy_on_site_management: boolean | null;
  // Utilities + pets standard-policy defaults (0050). null = no default set.
  policy_heat_included: boolean | null;
  policy_hydro_included: boolean | null;
  policy_water_included: boolean | null;
  policy_pets_cats: boolean | null;
  policy_pets_dogs: boolean | null;
  policy_pets_dog_size: string | null;
  // Slice 0 Block C: one-time per-org acknowledgment that gates in-app trade
  // dispatch go-live. Null until an operator accepts on /dashboard/maintenance.
  dispatch_terms_accepted_at: string | null;
};

const ORG_COLUMNS =
  "id, name, slug, brand_color, brand_color_secondary, logo_url, reply_to_email, plan, stripe_customer_id, stripe_subscription_id, subscription_status, current_period_end, pilot_started_at, pilot_deposit_status, pilot_deposit_payment_intent_id, pilot_deposit_amount_cents, pilot_deposit_paid_at, booking_timezone, booking_requires_confirmation, feedback_enabled, feedback_delay_hours, nurture_enabled, sms_enabled, clustering_enabled, clustering_buffer_minutes, showing_block_capacity, auto_assign_agents, showing_confirm_mode, auto_release_unconfirmed_enabled, auto_release_unconfirmed_hours, showing_autoclose_enabled, showing_autoclose_after_hours, outcome_nudge_max, screening_enabled, screening_income_multiple, screening_max_movein_days, screening_flag_pets, screening_reason_income, screening_reason_movein, screening_reason_pets, screening_ask_income, screening_ask_movein, screening_ask_pets, screening_ask_occupants, public_contact_phone, public_contact_email, landlord_campaign_email, showing_arrival_phone, policy_lease_term, policy_smoking, policy_ac_type, policy_on_site_management, policy_heat_included, policy_hydro_included, policy_water_included, policy_pets_cats, policy_pets_dogs, policy_pets_dog_size, dispatch_terms_accepted_at";

// The active org for the signed-in user. A user can belong to several orgs
// (multi-org agents); the ACTIVE one is resolved from the `selected_org` cookie,
// validated against the caller's memberships, falling back to their first
// membership when the cookie is unset or invalid. Single-org users are wholly
// unaffected (their one org is always the fallback). Returns null when the user
// has no membership yet (pre-onboarding).
//
// Historically this did a bare `.limit(1)` and let RLS surface an arbitrary one
// of the caller's orgs; the cookie now makes the choice deterministic.
export async function getCurrentOrg(): Promise<Org | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // The caller's membership org ids (RLS: only their own rows are readable).
  const { data: memberships } = await supabase
    .from("memberships")
    .select("organization_id")
    .eq("user_id", user.id);
  const membershipOrgIds = (memberships ?? [])
    .map((m) => (m as { organization_id: string | null }).organization_id)
    .filter((id): id is string => id != null);

  const selectedId = validateSelectedOrg(
    readSelectedOrgCookie(),
    membershipOrgIds,
  );
  if (!selectedId) return null;

  const { data } = await supabase
    .from("organizations")
    .select(ORG_COLUMNS)
    .eq("id", selectedId)
    .limit(1);
  return (data?.[0] as Org) ?? null;
}

// The caller's orgs (id + name), for the org switcher. RLS on `organizations`
// (id in user_org_ids()) scopes the read to just the orgs the caller belongs to.
export async function listMyOrgs(): Promise<{ id: string; name: string }[]> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from("organizations")
    .select("id, name")
    .order("name", { ascending: true });
  return (data ?? []).map((o) => ({
    id: (o as { id: string }).id,
    name: (o as { name: string | null }).name ?? "Untitled org",
  }));
}
