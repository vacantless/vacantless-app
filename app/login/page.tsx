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

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <AuthShell
      eyebrow="Welcome back"
      title="Log in to Vacantless"
      subtitle="Pick up right where you left off with your renters and viewings."
      footer={
        <>
          No account?{" "}
          <Link href="/signup" className="font-semibold text-brand">
            Start a 30-day pilot
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
          <div className="mb-1 flex items-center justify-between">
            <label className="block text-sm font-medium text-gray-700">
              Password
            </label>
            <Link
              href="/forgot-password"
              className="text-sm font-medium text-brand hover:underline"
            >
              Forgot password?
            </Link>
          </div>
          <input
            type="password"
            required
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={AUTH_INPUT_CLASS}
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={loading} className={AUTH_BUTTON_CLASS}>
          {loading ? "Logging in…" : "Log in"}
        </button>
      </form>
    </AuthShell>
  );
}
