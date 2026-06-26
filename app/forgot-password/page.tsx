"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  AuthShell,
  AUTH_BUTTON_CLASS,
  AUTH_INPUT_CLASS,
} from "@/components/auth-shell";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    // The recovery email links back through /auth/callback, which exchanges
    // the code for a (recovery) session and forwards to /reset-password where
    // the user picks a new password.
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    // Always show the same confirmation, whether or not an account exists, so
    // this page can't be used to probe which emails are registered.
    setSent(true);
    setLoading(false);
  }

  return (
    <AuthShell
      eyebrow="Account recovery"
      title="Reset your password"
      subtitle="Enter the email you log in with and we'll send you a link to set a new password."
      footer={
        <>
          Remembered it?{" "}
          <Link href="/login" className="font-semibold text-brand">
            Back to log in
          </Link>
        </>
      }
    >
      {sent ? (
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-gray-700">
            If an account exists for{" "}
            <span className="font-semibold text-gray-900">{email}</span>, a
            password-reset link is on its way. Check your inbox (and spam) and
            click the link to choose a new password.
          </p>
          <p className="text-sm text-gray-500">
            The link expires after a short while. Didn&apos;t get it?{" "}
            <button
              type="button"
              onClick={() => setSent(false)}
              className="font-semibold text-brand underline-offset-2 hover:underline"
            >
              Try again
            </button>
            .
          </p>
        </div>
      ) : (
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
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={loading} className={AUTH_BUTTON_CLASS}>
            {loading ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
