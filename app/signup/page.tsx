"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  AuthShell,
  AUTH_BUTTON_CLASS,
  AUTH_INPUT_CLASS,
} from "@/components/auth-shell";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  // When email confirmation is enabled there's no session yet; we switch to a
  // "check your inbox" panel with real next actions instead of a bare notice.
  const [confirmEmail, setConfirmEmail] = useState<string | null>(null);
  const [refToken, setRefToken] = useState<string | null>(null);
  const [resendMsg, setResendMsg] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    // Carry any referral token (/signup?ref=...) through to onboarding, where
    // the new org gets attributed to the referrer once it's created. Read it
    // from the URL at submit time (no useSearchParams -> no Suspense boundary).
    const ref =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("ref")
        : null;
    // If email confirmation is enabled, there is no active session yet — show
    // the confirmation panel instead of dropping the user at a dead end.
    if (!data.session) {
      setRefToken(ref);
      setConfirmEmail(email);
      setLoading(false);
      return;
    }
    router.push(ref ? `/onboarding?ref=${encodeURIComponent(ref)}` : "/onboarding");
    router.refresh();
  }

  async function handleResend() {
    if (!confirmEmail) return;
    setResending(true);
    setResendMsg(null);
    const supabase = createClient();
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: confirmEmail,
    });
    setResendMsg(
      error
        ? error.message
        : "Sent. Check your inbox again in a minute (and your spam folder).",
    );
    setResending(false);
  }

  // Email-confirmation next-action panel: clear "what now" instead of a notice.
  if (confirmEmail) {
    const loginHref = refToken
      ? `/login?ref=${encodeURIComponent(refToken)}`
      : "/login";
    return (
      <AuthShell
        eyebrow="One more step"
        title="Confirm your email"
        subtitle={`We sent a confirmation link to ${confirmEmail}. Open it to activate your login, then log in to set up your business.`}
        footer={
          <>
            Wrong email?{" "}
            <button
              type="button"
              onClick={() => {
                setConfirmEmail(null);
                setResendMsg(null);
              }}
              className="font-semibold text-brand"
            >
              Start over
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <Link href={loginHref} className={AUTH_BUTTON_CLASS + " block text-center"}>
            Open login
          </Link>
          <button
            type="button"
            onClick={handleResend}
            disabled={resending}
            className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            {resending ? "Resending…" : "Resend confirmation email"}
          </button>
          {resendMsg && <p className="text-sm text-gray-600">{resendMsg}</p>}
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow="Start a 30-day pilot"
      title="Create your login"
      subtitle="First, set up your sign-in details. Next you'll name your business. No credit card to start."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-brand">
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Email
          </label>
          <input
            type="email"
            required
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={AUTH_INPUT_CLASS}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Password
          </label>
          <input
            type="password"
            required
            minLength={6}
            placeholder="At least 6 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={AUTH_INPUT_CLASS}
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={loading} className={AUTH_BUTTON_CLASS}>
          {loading ? "Creating…" : "Create login"}
        </button>
      </form>
    </AuthShell>
  );
}
