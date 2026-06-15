import { createClient } from "@/lib/supabase/server";

export type Org = {
  id: string;
  name: string;
  slug: string;
  brand_color: string;
  logo_url: string | null;
  plan: string;
  booking_timezone: string;
};

// The org the signed-in user belongs to. RLS scopes the row to the caller,
// so this returns only their own organization (or null if none yet).
export async function getCurrentOrg(): Promise<Org | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("organizations")
    .select("id, name, slug, brand_color, logo_url, plan, booking_timezone")
    .limit(1);
  return (data?.[0] as Org) ?? null;
}
