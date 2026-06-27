"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createReferralAction, type CreateReferralResult } from "./actions";

// Generate-a-referral-link form. The optional name/email is the landlord's own
// note about who they're inviting (it shows up in "Your referrals"); a link can
// be generated with no details at all. On success it shows the copyable link.
export function ReferAFriendForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CreateReferralResult | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    setCopied(false);
    try {
      const origin =
        typeof window !== "undefined" ? window.location.origin : "";
      const res = await createReferralAction({ name: name || null, email: email || null, origin });
      setResult(res);
      if (res.ok) {
        setName("");
        setEmail("");
        // Refresh the "Your referrals" list to show the new pending row.
        router.refresh();
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
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Their name <span className="text-slate-400">(optional)</span>
            </label>
            <input
              type="text"
              placeholder="e.g. Zak Smith"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Their email <span className="text-slate-400">(optional)</span>
            </label>
            <input
              type="email"
              placeholder="landlord@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
        <p className="text-xs text-slate-500">
          Name and email are just for your own tracking — your friend still
          creates their own account.
        </p>
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {loading ? "Generating…" : "Generate referral link"}
        </button>
      </form>

      {result && result.ok && (
        <div className="space-y-2 rounded-lg border border-green-200 bg-green-50 p-4">
          <p className="text-xs text-green-700">
            Share this link with the landlord — it sets them up with their own
            free account:
          </p>
          <div className="flex gap-2">
            <input
              readOnly
              value={result.link}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full rounded-md border border-green-300 bg-white px-2 py-1 text-xs text-slate-700"
            />
            <button
              type="button"
              onClick={() => copyLink(result.link)}
              className="shrink-0 rounded-md bg-green-700 px-3 py-1 text-xs font-semibold text-white"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}

      {result && !result.ok && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">{result.error}</p>
        </div>
      )}
    </div>
  );
}
