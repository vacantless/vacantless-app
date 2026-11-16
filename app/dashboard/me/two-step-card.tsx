"use client";

// S803: turn two-step sign-in on or off for this login (lib/two-step.ts).
// Offered, never required. Talks to Supabase from the browser, so the code
// and the secret never pass through our server.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cleanCode } from "@/lib/two-step";

type Factor = { id: string; friendly_name?: string | null; status: string; created_at: string };
type Setup = { factorId: string; qr: string; secret: string };

const BUTTON =
  "rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50";
const PRIMARY =
  "rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50";

export function TwoStepCard({ pitch }: { pitch: string }) {
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(async () => {
    const { data } = await createClient().auth.mfa.listFactors();
    setFactors(((data?.totp ?? []) as Factor[]).filter((f) => f.status === "verified"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function start() {
    setBusy(true);
    setMessage(null);
    const supabase = createClient();
    // A half-finished setup from before blocks a new one; clear it first.
    const { data: list } = await supabase.auth.mfa.listFactors();
    for (const f of (list?.all ?? []) as Factor[]) {
      if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `Phone ${new Date().toISOString().slice(0, 10)}`,
    });
    setBusy(false);
    if (error || !data) {
      setMessage({ tone: "err", text: "That did not work. Refresh the page and try again." });
      return;
    }
    setSetup({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!setup) return;
    const clean = cleanCode(code);
    if (!clean) {
      setMessage({ tone: "err", text: "Type the 6 numbers your app shows." });
      return;
    }
    setBusy(true);
    const { error } = await createClient().auth.mfa.challengeAndVerify({
      factorId: setup.factorId,
      code: clean,
    });
    setBusy(false);
    if (error) {
      setMessage({ tone: "err", text: "That code did not work. Type the one showing now." });
      return;
    }
    setSetup(null);
    setCode("");
    setMessage({ tone: "ok", text: "Two-step sign-in is on. Next time you sign in, we will ask for the code." });
    load();
  }

  async function cancelSetup() {
    if (setup) await createClient().auth.mfa.unenroll({ factorId: setup.factorId });
    setSetup(null);
    setCode("");
    setMessage(null);
  }

  async function turnOff(factorId: string) {
    if (!window.confirm("Turn off two-step sign-in? Your password alone will get you in again.")) return;
    setBusy(true);
    const { error } = await createClient().auth.mfa.unenroll({ factorId });
    setBusy(false);
    if (error) {
      setMessage({ tone: "err", text: "Could not turn it off. Sign out, sign in with your code, then try again." });
      return;
    }
    setMessage({ tone: "ok", text: "Two-step sign-in is off." });
    load();
  }

  const on = (factors?.length ?? 0) > 0;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm" id="two-step">
      <h3 className="text-sm font-semibold text-gray-900">
        Two-step sign-in{" "}
        {factors && (
          <span className={`ml-1 rounded-full px-2 py-0.5 text-xs font-medium ${on ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-600"}`}>
            {on ? "On" : "Off"}
          </span>
        )}
      </h3>
      {!on && !setup && <p className="mt-1 text-sm text-gray-600">{pitch}</p>}
      {on && !setup && (
        <p className="mt-1 text-sm text-gray-600">
          After your password or Google, we ask for the 6-digit code from your phone. Lost your phone? Email
          hello@vacantless.com and we will help you back in.
        </p>
      )}

      {message && (
        <p className={`mt-3 text-sm ${message.tone === "ok" ? "text-green-700" : "text-red-600"}`}>{message.text}</p>
      )}

      {!setup && factors && !on && (
        <button type="button" onClick={start} disabled={busy} className={`${PRIMARY} mt-3`}>
          {busy ? "One moment…" : "Turn on two-step sign-in"}
        </button>
      )}

      {!setup && on && (
        <div className="mt-3 flex flex-wrap gap-2">
          {factors!.map((f) => (
            <button key={f.id} type="button" onClick={() => turnOff(f.id)} disabled={busy} className={BUTTON}>
              Turn off
            </button>
          ))}
        </div>
      )}

      {setup && (
        <form onSubmit={confirm} className="mt-3 space-y-3">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-gray-700">
            <li>Open an authenticator app on your phone. Google Authenticator, Microsoft Authenticator, Authy and 1Password all work.</li>
            <li>Add an account and scan this code.</li>
            <li>Type the 6 numbers the app shows.</li>
          </ol>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={setup.qr} alt="Code to scan with your authenticator app" className="h-44 w-44 rounded border border-gray-200" />
          <p className="text-xs text-gray-500">
            Cannot scan? Type this key in the app instead: <span className="font-mono text-gray-800 break-all">{setup.secret}</span>
          </p>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={9}
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="w-40 rounded-lg border border-gray-300 px-3 py-2 text-sm"
            aria-label="6-digit code"
          />
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className={PRIMARY}>
              {busy ? "Checking…" : "Turn on"}
            </button>
            <button type="button" onClick={cancelSetup} className={BUTTON}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
