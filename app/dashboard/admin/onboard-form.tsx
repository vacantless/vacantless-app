"use client";

import { useState } from "react";
import { onboardLandlordAction } from "./actions";
import { failureMessage, type ProvisionOutcome } from "@/lib/provisioning";

// Operator console form. Calls the server action, then renders either the
// success card (with the copyable set-password link to paste into the warm
// email) or a friendly error. Account creation stays operator-triggered; the
// landlord proves control of their email by completing this link themselves.
export function OnboardLandlordForm() {
  const [email, setEmail] = useState("");
  const [orgName, setOrgName] = useState("");
  const [landlordName, setLandlordName] = useState("");
  const [loading, setLoading] = useState(false);
  const [outcome, setOutcome] = useState<ProvisionOutcome | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setOutcome(null);
    setCopied(false);
    try {
      const result = await onboardLandlordAction({
        email,
        orgName,
        landlordName: landlordName || null,
      });
      setOutcome(result);
      if (result.ok) {
        setEmail("");
        setOrgName("");
        setLandlordName("");
      }
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
      /* clipboard blocked — the link is selectable in the field as a fallback */
    }
  }

  const inputClass =
    "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand";

  return (
    <div className="space-y-4">
      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-lg border border-slate-200 bg-white p-4"
      >
        <div>
          <label
            htmlFor="onboard-landlord-email"
            className="mb-1 block text-sm font-medium text-slate-700"
          >
            Landlord email
          </label>
          <input
            id="onboard-landlord-email"
            type="email"
            required
            placeholder="landlord@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label
            htmlFor="onboard-org-name"
            className="mb-1 block text-sm font-medium text-slate-700"
          >
            Account / organization name
          </label>
          <input
            id="onboard-org-name"
            type="text"
            required
            placeholder="e.g. Zak Smith"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label
            htmlFor="onboard-landlord-name"
            className="mb-1 block text-sm font-medium text-slate-700"
          >
            Landlord name <span className="text-slate-400">(optional)</span>
          </label>
          <input
            id="onboard-landlord-name"
            type="text"
            placeholder="Their full name"
            value={landlordName}
            onChange={(e) => setLandlordName(e.target.value)}
            className={inputClass}
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {loading ? "Provisioning…" : "Provision account"}
        </button>
      </form>

      {outcome && outcome.ok && (
        <div className="space-y-3 rounded-lg border border-green-200 bg-green-50 p-4">
          <p className="text-sm font-medium text-green-800">
            Provisioned {outcome.orgName} ({outcome.email}).
          </p>
          {outcome.inviteLink ? (
            <div className="space-y-2">
              <p className="text-xs text-green-700">
                Send this set-password link to the landlord (it logs them into
                their new account, where they choose a password):
              </p>
              <div className="flex gap-2">
                <input
                  readOnly
                  aria-label="Invite link"
                  value={outcome.inviteLink}
                  onFocus={(e) => e.currentTarget.select()}
                  className="w-full rounded-md border border-green-300 bg-white px-2 py-1 text-xs text-slate-700"
                />
                <button
                  type="button"
                  onClick={() => copyLink(outcome.inviteLink as string)}
                  className="shrink-0 rounded-md bg-green-700 px-3 py-1 text-xs font-semibold text-white"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-amber-700">
              The account exists, but the set-password link could not be
              generated. Send them the &ldquo;Forgot password&rdquo; flow at
              the login page instead.
            </p>
          )}
        </div>
      )}

      {outcome && !outcome.ok && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">
            {outcome.detail || failureMessage(outcome.reason)}
          </p>
        </div>
      )}
    </div>
  );
}
