"use client";

// S803: the second step of sign-in for a login that turned on two-step
// sign-in (lib/two-step.ts). The middleware sends account pages here until
// the 6-digit code from the phone is typed.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { safeNextPath } from "@/lib/safe-next";
import { cleanCode } from "@/lib/two-step";
import {
  AuthShell,
  AUTH_BUTTON_CLASS,
  AUTH_INPUT_CLASS,
} from "@/components/auth-shell";

export default function TwoStepCodePage() {
  const router = useRouter();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [noFactor, setNoFactor] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.mfa.listFactors().then(({ data }) => {
      const factor = data?.totp?.find((f) => f.status === "verified");
      if (factor) setFactorId(factor.id);
      else setNoFactor(true);
    });
  }, []);

  function goNext() {
    const next = safeNextPath(new URLSearchParams(window.location.search).get("next"));
    router.replace(next);
    router.refresh();
  }

  useEffect(() => {
    // Nothing to type (signed out, or two-step turned off): carry on.
    if (noFactor) goNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noFactor]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const clean = cleanCode(code);
    if (!clean) {
      setError("Type the 6 numbers your app shows.");
      return;
    }
    if (!factorId) return;
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code: clean,
    });
    if (error) {
      setError("That code did not work. Codes change every 30 seconds; type the one showing now.");
      setLoading(false);
      return;
    }
    goNext();
  }

  return (
    <AuthShell
      eyebrow="Two-step sign-in"
      title="Type the code from your phone"
      subtitle="Open your authenticator app and type the 6 numbers it shows for Vacantless."
      footer={
        <>
          Lost your phone? Email{" "}
          <a href="mailto:hello@vacantless.com" className="font-semibold text-brand">
            hello@vacantless.com
          </a>{" "}
          and we will help you back in.
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="two-step-code" className="mb-1 block text-sm font-medium text-gray-700">
            6-digit code
          </label>
          <input
            id="two-step-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={9}
            required
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className={AUTH_INPUT_CLASS}
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={loading || !factorId} className={AUTH_BUTTON_CLASS}>
          {loading ? "Checking…" : "Sign in"}
        </button>
      </form>
      <form action="/auth/signout" method="post" className="mt-4 text-center">
        <button type="submit" className="text-sm font-medium text-gray-500 hover:underline">
          Sign out instead
        </button>
      </form>
    </AuthShell>
  );
}
