import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { nextParamFor } from "@/lib/safe-next";

// Refreshes the Supabase auth session on every request and guards
// authenticated routes.
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: {
            name: string;
            value: string;
            options?: Record<string, unknown>;
          }[],
        ) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  // S728: a browser that still carries a dead session cookie (signed out
  // elsewhere, token rotated) makes every public page log "Invalid Refresh
  // Token" as an error. Drop the dead cookies once, so it stops.
  if (!user && authError && /refresh token/i.test(authError.message)) {
    for (const c of request.cookies.getAll()) {
      if (c.name.startsWith("sb-") && /-auth-token/.test(c.name)) {
        supabaseResponse.cookies.set(c.name, "", { maxAge: 0, path: "/" });
      }
    }
  }

  const path = request.nextUrl.pathname;
  const isProtected =
    path.startsWith("/dashboard") || path.startsWith("/onboarding");

  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // S716: keep the page they asked for, so an emailed link still lands
    // there after they log in (lib/safe-next.ts). The browser keeps any
    // #anchor across the redirect on its own.
    url.search = "";
    const next = nextParamFor(path, request.nextUrl.search);
    if (next) url.searchParams.set("next", next);
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
