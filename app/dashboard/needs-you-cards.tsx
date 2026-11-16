import Link from "next/link";
import type { NeedsYouNotice } from "@/lib/needs-you";

// S761: one amber card per site that signed the landlord out, above the lane
// on Today. One sentence, one line, one button.
// S805: the same card also says when a site took an ad down (lib/site-row-notes).
type Card = Pick<NeedsYouNotice, "title" | "line" | "action"> & { channel?: string; key?: string };

export function NeedsYouCards({ notices }: { notices: Card[] }) {
  if (notices.length === 0) return null;
  return (
    <div className="mb-6 space-y-3">
      {notices.map((n) => (
        <div
          key={n.key ?? n.channel}
          role="status"
          className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <p className="text-base font-semibold text-amber-900">{n.title}</p>
            <p className="mt-1 text-sm text-amber-900">{n.line}</p>
          </div>
          <Link
            href={n.action.href}
            className="inline-flex items-center justify-center rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white shadow-sm"
          >
            {n.action.label} →
          </Link>
        </div>
      ))}
    </div>
  );
}
