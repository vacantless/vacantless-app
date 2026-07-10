"use client";

import { useState } from "react";
import { handoffLandlordAction } from "./actions";
import {
  handoffFailureMessage,
  type HandoffOutcome,
} from "@/lib/provisioning";

export function HandoffLandlordForm({
  inviteId,
  intendedOwnerEmail,
  disabled,
}: {
  inviteId: string;
  intendedOwnerEmail: string | null;
  disabled: boolean;
}) {
  const [confirmEmail, setConfirmEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [outcome, setOutcome] = useState<HandoffOutcome | null>(null);
  const [copied, setCopied] = useState(false);

  if (disabled || !intendedOwnerEmail) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setOutcome(null);
    setCopied(false);
    try {
      setOutcome(await handoffLandlordAction({ inviteId, confirmEmail }));
      setConfirmEmail("");
    } finally {
      setLoading(false);
    }
  }

  async function copyLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* The field stays selectable if clipboard access is blocked. */
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <input
        type="email"
        required
        value={confirmEmail}
        onChange={(e) => setConfirmEmail(e.target.value)}
        placeholder={intendedOwnerEmail}
        aria-label="Confirm landlord handoff email"
        className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
      />
      <button
        type="submit"
        disabled={loading}
        className="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-60"
      >
        {loading ? "Handing off..." : "Hand off"}
      </button>
      {outcome && outcome.ok && (
        <div className="space-y-1">
          <p className="text-xs text-green-700">
            Login moved to {outcome.email}.
          </p>
          {outcome.inviteLink ? (
            <div className="flex gap-1">
              <input
                readOnly
                aria-label="Handoff set-password link"
                value={outcome.inviteLink}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full rounded-md border border-green-300 bg-white px-2 py-1 text-xs text-slate-700"
              />
              <button
                type="button"
                onClick={() => copyLink(outcome.inviteLink as string)}
                className="shrink-0 rounded-md bg-green-700 px-2 py-1 text-xs font-semibold text-white"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          ) : (
            <p className="text-xs text-amber-700">Use Forgot password if needed.</p>
          )}
        </div>
      )}
      {outcome && !outcome.ok && (
        <p className="text-xs text-red-700">
          {outcome.detail || handoffFailureMessage(outcome.reason)}
        </p>
      )}
    </form>
  );
}
