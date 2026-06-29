import { addViolation, updateViolation, removeViolation } from "./violation-actions";
import {
  VIOLATION_TYPES,
  VIOLATION_STATUSES,
  violationTypeLabel,
  violationLifecycleLabel,
  type ViolationLifecycle,
  type FollowupStatus,
} from "@/lib/lease-violations";

// Per-tenancy lease-violation / notice log capture surface (S383) — the
// tenancy-scoped sibling of the renter's-insurance section (insurance-section.tsx).
// Server component: the add/edit forms post to server actions and the per-row
// edit form uses a native <details> disclosure (no client JS). The page computes
// each record's follow-up status (lib/lease-violations) and passes it in, so this
// file stays presentational.

export type ViolationView = {
  id: string;
  violation_type: string | null;
  occurred_on: string | null;
  description: string | null;
  notice_type: string | null;
  notice_served_on: string | null;
  remedy_due_on: string | null;
  status: string | null; // lifecycle: open/remedied/escalated/closed
  resolved_on: string | null;
  notes: string | null;
  followup: FollowupStatus; // computed deadline band
};

const LIFECYCLE_META: Record<ViolationLifecycle, { cls: string }> = {
  open: { cls: "bg-amber-100 text-amber-800" },
  remedied: { cls: "bg-green-100 text-green-800" },
  escalated: { cls: "bg-red-100 text-red-800" },
  closed: { cls: "bg-gray-100 text-gray-600" },
};

const FOLLOWUP_META: Partial<Record<FollowupStatus, { label: string; cls: string }>> = {
  overdue: { label: "Remedy overdue", cls: "bg-red-100 text-red-800" },
  approaching: { label: "Deadline soon", cls: "bg-amber-100 text-amber-800" },
};

const INPUT_CLS =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand";
const LABEL_CLS = "block text-xs font-medium text-gray-600 mb-1";

function lifecycleOf(v: ViolationView): ViolationLifecycle {
  const t = (v.status ?? "open").trim();
  return (VIOLATION_STATUSES as readonly string[]).includes(t)
    ? (t as ViolationLifecycle)
    : "open";
}

/** The shared field grid, reused by the add form and each row's edit form. */
function ViolationFields({ d }: { d?: ViolationView }) {
  const currentType = d?.violation_type ?? "other";
  const currentStatus = d ? lifecycleOf(d) : "open";
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div>
        <label className={LABEL_CLS}>Type</label>
        <select name="violation_type" defaultValue={currentType} className={INPUT_CLS}>
          {VIOLATION_TYPES.map((t) => (
            <option key={t} value={t}>
              {violationTypeLabel(t)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={LABEL_CLS}>Status</label>
        <select name="status" defaultValue={currentStatus} className={INPUT_CLS}>
          {VIOLATION_STATUSES.map((st) => (
            <option key={st} value={st}>
              {violationLifecycleLabel(st)}
            </option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-2">
        <label className={LABEL_CLS}>What happened</label>
        <textarea
          name="description"
          defaultValue={d?.description ?? ""}
          rows={2}
          placeholder="e.g. Repeated noise complaints from the unit below on Apr 3 and Apr 7"
          className={INPUT_CLS}
        />
      </div>
      <div>
        <label className={LABEL_CLS}>Date observed (optional)</label>
        <input
          name="occurred_on"
          type="date"
          defaultValue={d?.occurred_on ?? ""}
          className={INPUT_CLS}
        />
      </div>
      <div>
        <label className={LABEL_CLS}>Notice given (optional)</label>
        <input
          name="notice_type"
          defaultValue={d?.notice_type ?? ""}
          placeholder="e.g. Written warning, N5"
          className={INPUT_CLS}
        />
      </div>
      <div>
        <label className={LABEL_CLS}>Notice served on (optional)</label>
        <input
          name="notice_served_on"
          type="date"
          defaultValue={d?.notice_served_on ?? ""}
          className={INPUT_CLS}
        />
      </div>
      <div>
        <label className={LABEL_CLS}>Remedy due by (optional)</label>
        <input
          name="remedy_due_on"
          type="date"
          defaultValue={d?.remedy_due_on ?? ""}
          className={INPUT_CLS}
        />
      </div>
      <div>
        <label className={LABEL_CLS}>Resolved on (optional)</label>
        <input
          name="resolved_on"
          type="date"
          defaultValue={d?.resolved_on ?? ""}
          className={INPUT_CLS}
        />
      </div>
      <div className="sm:col-span-2">
        <label className={LABEL_CLS}>Notes (optional)</label>
        <input
          name="notes"
          defaultValue={d?.notes ?? ""}
          placeholder="e.g. tenant acknowledged; agreed to quiet hours"
          className={INPUT_CLS}
        />
      </div>
    </div>
  );
}

function metaLine(d: ViolationView): string {
  const parts: string[] = [];
  if (d.occurred_on?.trim()) parts.push(`observed ${d.occurred_on}`);
  if (d.notice_type?.trim()) parts.push(`notice: ${d.notice_type.trim()}`);
  if (d.remedy_due_on?.trim()) parts.push(`remedy due ${d.remedy_due_on}`);
  else if (d.resolved_on?.trim()) parts.push(`resolved ${d.resolved_on}`);
  return parts.join(" · ");
}

export function TenancyViolationSection({
  tenancyId,
  violations,
}: {
  tenancyId: string;
  violations: ViolationView[];
}) {
  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-600">
        Keep a record of lease breaches and the notices you serve &mdash; the history an
        LTB application later depends on. Set a &ldquo;remedy due by&rdquo; date and turn on the
        &ldquo;Lease violation follow-up due&rdquo; reminder in Settings &rarr; Notifications, and
        we email you as that deadline nears (and again if it passes) so you can check whether
        it was fixed and then close it or escalate. The reminder goes to your team, never the
        tenant. This logs what happened; it does not file LTB forms for you.
      </p>

      {violations.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
          No violations logged. Add one below if you need to track a breach or notice.
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          {violations.map((d) => {
            const lifecycle = lifecycleOf(d);
            const lcMeta = LIFECYCLE_META[lifecycle];
            const followup = FOLLOWUP_META[d.followup];
            return (
              <li key={d.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-gray-900">
                        {violationTypeLabel(d.violation_type)}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${lcMeta.cls}`}
                      >
                        {violationLifecycleLabel(lifecycle)}
                      </span>
                      {followup ? (
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${followup.cls}`}
                        >
                          {followup.label}
                        </span>
                      ) : null}
                    </div>
                    {d.description?.trim() ? (
                      <div className="mt-0.5 truncate text-sm text-gray-700">
                        {d.description.trim()}
                      </div>
                    ) : null}
                    {metaLine(d) ? (
                      <div className="mt-0.5 text-xs text-gray-500">{metaLine(d)}</div>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-3">
                    <details className="group">
                      <summary className="cursor-pointer list-none text-sm font-medium text-brand hover:underline [&::-webkit-details-marker]:hidden">
                        Edit
                      </summary>
                      <form
                        action={updateViolation}
                        className="mt-3 w-full rounded-xl border border-gray-200 bg-gray-50 p-4"
                      >
                        <input type="hidden" name="id" value={d.id} />
                        <input type="hidden" name="tenancy_id" value={tenancyId} />
                        <ViolationFields d={d} />
                        <div className="mt-3">
                          <button
                            type="submit"
                            className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:opacity-90"
                          >
                            Save changes
                          </button>
                        </div>
                      </form>
                    </details>
                    <form action={removeViolation}>
                      <input type="hidden" name="id" value={d.id} />
                      <input type="hidden" name="tenancy_id" value={tenancyId} />
                      <button
                        type="submit"
                        className="text-sm font-medium text-gray-400 hover:text-red-600"
                      >
                        Remove
                      </button>
                    </form>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <details className="group rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <summary className="cursor-pointer list-none text-sm font-semibold text-gray-900 [&::-webkit-details-marker]:hidden">
          + Log a violation
        </summary>
        <form action={addViolation} className="mt-4">
          <input type="hidden" name="tenancy_id" value={tenancyId} />
          <ViolationFields />
          <div className="mt-3">
            <button
              type="submit"
              className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Log violation
            </button>
          </div>
        </form>
      </details>
    </div>
  );
}
