"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  AuthShell,
  AUTH_BUTTON_CLASS,
  AUTH_INPUT_CLASS,
} from "@/components/auth-shell";
import {
  EXISTING_ACCOUNT_MESSAGE,
  signupEyebrow,
  signupHitExistingAccount,
  signupSubtitle,
} from "@/lib/signup-copy";

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
  // S714d: the plan picked on the homepage, and who (if anyone) is already
  // signed in in this browser.
  const [plan, setPlan] = useState<string | null>(null);
  const [signedInAs, setSignedInAs] = useState<string | null>(null);
  const [existingAccount, setExistingAccount] = useState(false);

  useEffect(() => {
    setPlan(new URLSearchParams(window.location.search).get("plan"));
    createClient()
      .auth.getUser()
      .then(({ data }) => setSignedInAs(data.user?.email ?? null))
      .catch(() => setSignedInAs(null));
  }, []);

  async function handleSignOut() {
    await createClient().auth.signOut();
    setSignedInAs(null);
    setEmail("");
    setPassword("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({ email, password });
    setExistingAccount(false);
    if (
      signupHitExistingAccount({
        errorMessage: error?.message ?? null,
        identitiesCount: data?.user?.identities?.length ?? null,
        hasUser: !!data?.user,
      })
    ) {
      setExistingAccount(true);
      setError(EXISTING_ACCOUNT_MESSAGE);
      setLoading(false);
      return;
    }
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    // Carry any referral token (/signup?ref=...) through to onboarding, where
    // the new org gets attributed to the referrer once it's created. Read it
    // from the URL at submit time (no useSearchParams -> no Suspense boundary).
    const search =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search)
        : new URLSearchParams();
    const ref = search.get("ref");
    // Carry the chosen paid plan (/signup?plan=growth|premium from the pricing
    // CTAs) through onboarding so paid intent lands on billing instead of
    // dead-ending on the free plan (Codex P2). Best-effort: only survives the
    // immediate-session path; the email-confirm path lands on free (upgrade in
    // billing) as before.
    const plan = search.get("plan");
    const onboardingHref = (() => {
      const qp = new URLSearchParams();
      if (ref) qp.set("ref", ref);
      if (plan) qp.set("plan", plan);
      const qs = qp.toString();
      return qs ? `/onboarding?${qs}` : "/onboarding";
    })();
    // If email confirmation is enabled, there is no active session yet — show
    // the confirmation panel instead of dropping the user at a dead end.
    if (!data.session) {
      setRefToken(ref);
      setConfirmEmail(email);
      setLoading(false);
      return;
    }
    router.push(onboardingHref);
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

  // S714d: already signed in here. Say who, instead of a blank form that
  // Chrome fills with the other login.
  if (signedInAs) {
    return (
      <AuthShell
        eyebrow={signupEyebrow(plan)}
        title="You're already signed in"
        subtitle={`This browser is signed in as ${signedInAs}.`}
      >
        <div className="space-y-3">
          <Link href="/dashboard" className={AUTH_BUTTON_CLASS + " block text-center"}>
            Go to my dashboard
          </Link>
          <button
            type="button"
            onClick={handleSignOut}
            className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Sign out and create a new login
          </button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow={signupEyebrow(plan)}
      title="Create your login"
      subtitle={signupSubtitle(plan)}
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
          <label
            htmlFor="signup-email"
            className="mb-1 block text-sm font-medium text-gray-700"
          >
            Email
          </label>
          <input
            id="signup-email"
            type="email"
            required
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={AUTH_INPUT_CLASS}
          />
        </div>
        <div>
          <label
            htmlFor="signup-password"
            className="mb-1 block text-sm font-medium text-gray-700"
          >
            Password
          </label>
          <input
            id="signup-password"
            type="password"
            required
            minLength={6}
            placeholder="At least 6 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={AUTH_INPUT_CLASS}
          />
        </div>
        {error && (
          <p className="text-sm text-red-600">
            {error}
            {existingAccount && (
              <>
                {" "}
                <Link href="/login" className="font-semibold underline">
                  Log in
                </Link>
              </>
            )}
          </p>
        )}
        <button type="submit" disabled={loading} className={AUTH_BUTTON_CLASS}>
          {loading ? "Creating..." : "Create login"}
        </button>
        <p className="mt-3 text-center text-xs text-gray-500">
          By creating a login you agree to the{" "}
          <a href="https://www.vacantless.com/terms" className="underline" target="_blank" rel="noopener noreferrer">
            Terms
          </a>{" "}
          and{" "}
          <a href="https://www.vacantless.com/privacy" className="underline" target="_blank" rel="noopener noreferrer">
            Privacy Policy
          </a>
          . We email you about your account and your renters; every other email has an unsubscribe link.
        </p>
      </form>
    </AuthShell>
  );
}
