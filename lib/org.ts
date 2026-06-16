import { createClient } from "@/lib/supabase/server";

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
  feedback_enabled: boolean;
  feedback_delay_hours: number;
  nurture_enabled: boolean;
  sms_enabled: boolean;
  clustering_enabled: boolean;
  clustering_buffer_minutes: number;
  showing_block_capacity: number;
};

// The org the signed-in user belongs to. RLS scopes the row to the caller,
// so this returns only their own organization (or null if none yet).
export async function getCurrentOrg(): Promise<Org | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("organizations")
    .select(
      "id, name, slug, brand_color, brand_color_secondary, logo_url, reply_to_email, plan, stripe_customer_id, stripe_subscription_id, subscription_status, current_period_end, pilot_started_at, pilot_deposit_status, pilot_deposit_payment_intent_id, pilot_deposit_amount_cents, pilot_deposit_paid_at, booking_timezone, feedback_enabled, feedback_delay_hours, nurture_enabled, sms_enabled, clustering_enabled, clustering_buffer_minutes, showing_block_capacity",
    )
    .limit(1);
  return (data?.[0] as Org) ?? null;
}
