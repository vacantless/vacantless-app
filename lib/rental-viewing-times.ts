import type { SupabaseClient } from "@supabase/supabase-js";
import { generateSlots, type Availability } from "./booking";

// S743: the reply a renter gets on Facebook or Kijiji said "You can pick a
// viewing time here" even when the rental had no viewing times, so the link
// opened a form with nothing to pick and a renter (Rez, Assumption 9) wrote
// back "it's not taking me anywhere". The replies now ask this first. Same RPC
// and same slot maker as the renter page, so the words match what the renter
// sees. Any read error keeps the old wording (true).

/** True when the rental's renter page offers at least one viewing time. */
export async function rentalHasViewingTimes(
  client: SupabaseClient | null | undefined,
  propertyId: string,
): Promise<boolean> {
  if (!client) return true;
  try {
    const { data, error } = await client.rpc("get_public_availability", { p_property_id: propertyId });
    if (error || !data) return true;
    return generateSlots(data as Availability).some((d) => d.slots.length > 0);
  } catch {
    return true;
  }
}
