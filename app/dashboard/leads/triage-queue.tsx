import Link from "next/link";
import {
  followUpStatus,
  followUpLabel,
} from "@/lib/lead-detail";
import type { LeadStatus } from "@/lib/pipeline";
import {
  triageLead,
  TRIAGE_BUCKET_ORDER,
  TRIAGE_BUCKET_LABEL,
  type TriageBucket,
} from "@/lib/lead-triage";
import { StatusSelect } from "./status-select";

// TriageQueue — the Inquiries triage queue (Codex design audit #4, S377).
// Replaces the flat chronological table (+ separate mobile cards) with a single
// responsive queue grouped into "Needs you now / Working / Closed" and ordered
// most-actionable first. Ordering + bucketing come from the pure triageLead();
// this file is presentation only. Works at every width (no <table>), so it
// reads as a queue on phone and desktop alike.

export type QueueLead = {
  id: string;
  name: string | null;
  email: string | null;
  source: string | null;
  status: LeadStatus;
  created_at: string;
  next_action_at: string | null;
  qualified_out: boolean;
  property: { address: string } | null;
};

// Reason-chip colour by urgency (needs-you rows only).
const REASON_CHIP: Record<string, string> = {
  "Needs a reply": "bg-brand/10 text-brand",
  "Follow-up overdue": "bg-red-100 text-red-700",
  "Follow-up due today": "bg-amber-100 text-amber-700",
};

export function TriageQueue({
  rows,
  today,
  timeZone,
}: {
  rows: QueueLead[];
  today: string;
  timeZone: string;
}) {
  const triaged = rows.map((l) => ({
    l,
    t: triageLead({
      status: l.status,
      followUp: followUpStatus(l.next_action_at, today),
      qualifiedOut: l.qualified_out,
    }),
  }));

  const byBucket = new Map<TriageBucket, typeof triaged>();
  for (const item of triaged) {
    const list = byBucket.get(item.t.bucket) ?? [];
    list.push(item);
    byBucket.set(item.t.bucket, list);
  }

  return (
    <div className="space-y-6">
      {TRIAGE_BUCKET_ORDER.map((bucket) => {
        const items = (byBucket.get(bucket) ?? []).sort(
          (a, b) =>
            a.t.rank - b.t.rank || b.l.created_at.localeCompare(a.l.created_at),
        );
        if (items.length === 0) return null;
        return (
          <section key={bucket}>
            <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
              {TRIAGE_BUCKET_LABEL[bucket]}
              <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-500">
                {items.length}
              </span>
            </h3>
            <ul className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
              {items.map(({ l, t }) => (
                <QueueRow
                  key={l.id}
                  lead={l}
                  reason={t.reason}
                  today={today}
                  timeZone={timeZone}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function QueueRow({
  lead: l,
  reason,
  today,
  timeZone,
}: {
  lead: QueueLead;
  reason: string | null;
  today: string;
  timeZone: string;
}) {
  const fStatus = followUpStatus(l.next_action_at, today);

  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/dashboard/leads/${l.id}`}
            className="font-semibold text-gray-900 hover:text-brand"
          >
            {l.name || l.email || "Unnamed renter"}
          </Link>
          {reason && (
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                REASON_CHIP[reason] ?? "bg-gray-100 text-gray-600"
              }`}
            >
              {reason}
            </span>
          )}
          {/* An upcoming follow-up isn't "needs you now" but is worth a cue. */}
          {!reason && fStatus === "upcoming" && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">
              {followUpLabel(l.next_action_at, today)}
            </span>
          )}
          {l.qualified_out && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
              Possible mismatch
            </span>
          )}
        </div>
        <p className="mt-1 truncate text-sm text-gray-500">
          {l.property?.address ?? "No rental linked"}
          {l.source && <span className="text-gray-400"> · via {l.source}</span>}
          <span className="text-gray-400">
            {" · "}
            {new Date(l.created_at).toLocaleDateString("en-CA", { timeZone })}
          </span>
        </p>
      </div>
      <div className="sm:shrink-0">
        <StatusSelect
          leadId={l.id}
          status={l.status}
          label={`Stage for ${l.name || l.email || "unnamed renter"}`}
        />
      </div>
    </li>
  );
}
