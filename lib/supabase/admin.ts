import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

// SERVER-ONLY service-role Supabase client.
//
// This BYPASSES Row-Level Security, so it must never be imported into client
// components or shipped to the browser. It exists only for trusted background
// jobs (the reminder cron sweep) that legitimately need to read upcoming
// showings across every organization — something RLS deliberately hides from
// ordinary user sessions.
//
// DEGRADES GRACEFULLY: returns null if SUPABASE_SERVICE_ROLE_KEY (or the URL)
// is not set, so the rest of the app keeps building/running and the cron route
// can report a clear "not configured" status instead of throwing. Add the key
// in Vercel as SUPABASE_SERVICE_ROLE_KEY (server-only, NO NEXT_PUBLIC_).
export function createAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;

  return createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
