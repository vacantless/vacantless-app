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

type Phase = "checking" | "ready" | "no-session";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  // The recovery link routes through /auth/callback, which establishes a
  // recovery session before forwarding here. If there's no session (link
  // expired, already used, or opened directly) there's nothing to update.
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setPhase(data.user ? "ready" : "no-session");
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    setDone(true);
    setLoading(false);
    // The recovery session is a full session, so the user is now logged in.
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <AuthShell
      eyebrow="Account recovery"
      title="Choose a new password"
      subtitle="Set a new password for your account. You'll be signed in right after."
      footer={
        <>
          Back to{" "}
          <Link href="/login" className="font-semibold text-brand">
            log in
          </Link>
        </>
      }
    >
      {phase === "checking" ? (
        <p className="text-sm text-gray-500">Checking your reset link…</p>
      ) : phase === "no-session" ? (
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-gray-700">
            This reset link is invalid or has expired. Request a fresh one and
            we&apos;ll email you a new link.
          </p>
          <Link
            href="/forgot-password"
            className={`${AUTH_BUTTON_CLASS} inline-block text-center`}
          >
            Request a new link
          </Link>
        </div>
      ) : done ? (
        <p className="text-sm text-green-700">
          Password updated. Taking you to your dashboard…
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              New password
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
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Confirm new password
            </label>
            <input
              type="password"
              required
              minLength={6}
              placeholder="Re-enter your new password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={AUTH_INPUT_CLASS}
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={loading} className={AUTH_BUTTON_CLASS}>
            {loading ? "Saving…" : "Update password"}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
