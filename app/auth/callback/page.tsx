"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { AuthShell, AUTH_BUTTON_CLASS } from "@/components/auth-shell";

// Finalizes an auth redirect for BOTH Supabase flows, then forwards to `next`:
//   - PKCE ("?code="): the forgot-password + signup-confirmation emails, where
//     the requesting browser holds the code verifier. We exchange it explicitly.
//   - Implicit ("#access_token=" in the URL hash): an operator-provisioned
//     recovery / set-password link (admin.generateLink) has no client verifier,
//     so GoTrue returns the session in the hash. A server route can't read a
//     hash; the browser client (detectSessionInUrl) consumes it on mount and
//     writes the session to cookies. This client page is that mount — which is
//     why a provisioned landlord no longer dead-ends on /login#access_token=...
function AuthCallbackInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    const rawNext = params.get("next") ?? "/dashboard";
    // Only allow an internal, same-origin relative path (guard against an
    // open redirect via a crafted ?next=//evil.com or ?next=https://...).
    const next =
      rawNext.startsWith("/") && !rawNext.startsWith("//")
        ? rawNext
        : "/dashboard";
    const code = params.get("code");
    const hashError =
      typeof window !== "undefined" && window.location.hash.includes("error");

    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const go = (dest: string) => {
      if (settled) return;
      settled = true;
      router.replace(dest);
    };

    async function finalize() {
      if (hashError) {
        setFailed(true);
        return;
      }
      // PKCE: explicit code exchange (the verifier lives in this browser).
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) setFailed(true);
        else go(next);
        return;
      }
      // Implicit (hash) flow: detectSessionInUrl consumes the hash during
      // client init, so the session is usually already present here.
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        go(next);
        return;
      }
      // Otherwise give hash detection a beat, then check once more.
      const { data: sub } = supabase.auth.onAuthStateChange(
        (_event, session) => {
          if (session) go(next);
        },
      );
      timeoutId = setTimeout(async () => {
        const { data: retry } = await supabase.auth.getSession();
        if (retry.session) go(next);
        else setFailed(true);
        sub.subscription.unsubscribe();
      }, 4000);
    }

    finalize();

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [params, router]);

  if (failed) {
    return (
      <AuthShell
        eyebrow="Account recovery"
        title="This link didn't work"
        subtitle="It may have expired or already been used. Request a fresh link and we'll email you a new one."
      >
        <Link
          href="/forgot-password"
          className={`${AUTH_BUTTON_CLASS} inline-block text-center`}
        >
          Request a new link
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow="Almost there"
      title="Finishing sign-in…"
      subtitle="Hang tight while we verify your link."
    >
      <p className="text-sm text-gray-500">This only takes a moment…</p>
    </AuthShell>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={null}>
      <AuthCallbackInner />
    </Suspense>
  );
}
