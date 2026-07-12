"use client";

import { useState } from "react";
import { upsertRentGuidelineAction } from "./actions";

// Superadmin form to set the Ontario rent-increase guideline for a year (S465).
// Writes to the rent_guidelines table via the double-gated server action, so the
// value takes effect with no redeploy. A year not set here falls back to the
// shipped code default (ONTARIO_GUIDELINE).
export function GuidelineForm() {
  const [year, setYear] = useState("");
  const [percent, setPercent] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    try {
      const r = await upsertRentGuidelineAction({
        year: Number(year),
        percent: Number(percent),
      });
      if (r.ok) {
        setMsg({ ok: true, text: `Saved ${r.year}: ${r.percent}%` });
        setYear("");
        setPercent("");
      } else {
        setMsg({ ok: false, text: r.error });
      }
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    "block w-28 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand";

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
      <label className="text-xs text-slate-500">
        Year
        <input
          className={inputClass}
          inputMode="numeric"
          placeholder="2028"
          value={year}
          onChange={(e) => setYear(e.target.value)}
        />
      </label>
      <label className="text-xs text-slate-500">
        Guideline %
        <input
          className={inputClass}
          inputMode="decimal"
          placeholder="1.9"
          value={percent}
          onChange={(e) => setPercent(e.target.value)}
        />
      </label>
      <button
        type="submit"
        disabled={loading}
        className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {loading ? "Saving..." : "Save guideline"}
      </button>
      {msg && (
        <span className={`text-xs ${msg.ok ? "text-green-700" : "text-red-600"}`}>
          {msg.text}
        </span>
      )}
    </form>
  );
}
