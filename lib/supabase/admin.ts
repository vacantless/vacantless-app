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
    // S467: opt every service-role read out of Next.js's fetch Data Cache. The
    // App Router caches cookieless GET fetches (which this service-role client
    // makes) in the Data Cache, so without this a public route (e.g. /n1/[token])
    // or a cron sweep can read FROZEN rows / a stale guideline for the life of the
    // cache - the blank-N1 bug (KI740). User-client reads carry auth cookies and
    // are never cached, which is why the operator N1 rendered correctly while the
    // public one was blank. `dynamic="force-dynamic"` did NOT cover these fetches
    // (Next 14.2), so pin no-store on the client itself.
    global: {
      fetch: (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
        fetch(input, { ...init, cache: "no-store" }),
    },
  });
}
