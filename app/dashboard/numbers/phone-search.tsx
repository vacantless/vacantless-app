"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { dialTarget, matchesBook, prettyPhone, type BookEntry } from "@/lib/phone-book";

// S816b: one box over every renter, applicant, tenant, agent and trade number.
export function PhoneSearch({ entries }: { entries: BookEntry[] }) {
  const [q, setQ] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const shown = useMemo(() => entries.filter((e) => matchesBook(e, q)).slice(0, 200), [entries, q]);
  return (
    <div>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search a name, address, trade or part of a number"
        className="w-full rounded-xl border border-gray-300 px-4 py-3 text-base"
        autoFocus
      />
      <p className="mt-2 text-xs text-gray-500">
        {shown.length === entries.length ? `${entries.length} people` : `${shown.length} of ${entries.length}`}
      </p>
      <ul className="mt-2 divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white">
        {shown.map((e) => (
          <li key={e.key} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900">
                {e.href ? (
                  <Link href={e.href} className="hover:underline">
                    {e.name}
                  </Link>
                ) : (
                  e.name
                )}{" "}
                <span className="ml-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">{e.kind}</span>
              </p>
              <p className="text-xs text-gray-500">
                {prettyPhone(e.phone)}
                {e.detail ? ` · ${e.detail}` : ""}
              </p>
            </div>
            <div className="flex gap-2">
              <a href={`tel:${dialTarget(e.phone)}`} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700">
                Call
              </a>
              <a href={`sms:${dialTarget(e.phone).split(",")[0]}`} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700">
                Text
              </a>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(prettyPhone(e.phone));
                    setCopied(e.key);
                    setTimeout(() => setCopied(null), 1500);
                  } catch {
                    window.prompt("Copy this:", prettyPhone(e.phone));
                  }
                }}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700"
              >
                {copied === e.key ? "Copied" : "Copy"}
              </button>
            </div>
          </li>
        ))}
        {shown.length === 0 ? <li className="px-4 py-6 text-center text-sm text-gray-500">Nobody matches that.</li> : null}
      </ul>
    </div>
  );
}
