import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { perRequest } from "@/lib/request-cache";

// Server-side Supabase client for Server Components, Route Handlers, and
// Server Actions. Still anon-key + RLS scoped to the signed-in user.
export function createClient() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: {
            name: string;
            value: string;
            options?: Record<string, unknown>;
          }[],
        ) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if middleware refreshes the session.
          }
        },
      },
    },
  );
}

// S839c: the signed-in user, asked once per page render (lib/request-cache.ts).
// Still a real check with the auth server, never the cookie taken on trust.
export const getRequestUser = perRequest(async () => {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});
