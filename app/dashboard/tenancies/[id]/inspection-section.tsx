import { addInspection, updateInspection, removeInspection } from "./inspection-actions";
import {
  INSPECTION_TYPES,
  INSPECTION_STATUSES,
  inspectionTypeLabel,
  inspectionLifecycleLabel,
  type InspectionLifecycle,
  type InspectionDueStatus,
} from "@/lib/property-inspections";

// Per-tenancy property-inspection capture surface (S385) — the tenancy-scoped
// sibling of the lease-violation section (violation-section.tsx). Server
// component: the add/edit forms post to server actions and the per-row edit form
// uses a native <details> disclosure (no client JS). The page computes each
// record's due status (lib/property-inspections) and passes it in, so this file
// stays presentational.

export type InspectionView = {
  id: string;
  inspection_type: string | null;
  scheduled_for: string | null;
  status: string | null; // lifecycle: scheduled/completed/skipped/canceled
  completed_on: string | null;
  condition_notes: string | null;
  notes: string | null;
  due: InspectionDueStatus; // computed planned-date band
};

const LIFECYCLE_META: Record<InspectionLifecycle, { cls: string }> = {
  scheduled: { cls: "bg-amber-100 text-amber-800" },
  completed: { cls: "bg-green-100 text-green-800" },
  skipped: { cls: "bg-gray-100 text-gray-600" },
  canceled: { cls: "bg-gray-100 text-gray-600" },
};

const DUE_META: Partial<Record<InspectionDueStatus, { label: string; cls: string }>> = {
  overdue: { label: "Overdue", cls: "bg-red-100 text-red-800" },
  approaching: { label: "Due soon", cls: "bg-amber-100 text-amber-800" },
};

const INPUT_CLS =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand";
const LABEL_CLS = "block text-xs font-medium text-gray-600 mb-1";

function lifecycleOf(v: InspectionView): InspectionLifecycle {
  const t = (v.status ?? "scheduled").trim();
  return (INSPECTION_STATUSES as readonly string[]).includes(t)
    ? (t as InspectionLifecycle)
    : "scheduled";
}

/** The shared field grid, reused by the add form and each row's edit form. */
function InspectionFields({ d }: { d?: InspectionView }) {
  const currentType = d?.inspection_type ?? "periodic";
  const currentStatus = d ? lifecycleOf(d) : "scheduled";
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div>
        <label className={LABEL_CLS}>Type</label>
        <select name="inspection_type" defaultValue={currentType} className={INPUT_CLS}>
          {INSPECTION_TYPES.map((t) => (
            <option key={t} value={t}>
              {inspectionTypeLabel(t)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={LABEL_CLS}>Status</label>
        <select name="status" defaultValue={currentStatus} className={INPUT_CLS}>
          {INSPECTION_STATUSES.map((st) => (
            <option key={st} value={st}>
              {inspectionLifecycleLabel(st)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={LABEL_CLS}>Planned date (optional)</label>
        <input
          name="scheduled_for"
          type="date"
          defaultValue={d?.scheduled_for ?? ""}
          className={INPUT_CLS}
        />
      </div>
      <div>
        <label className={LABEL_CLS}>Completed on (optional)</label>
        <input
          name="completed_on"
          type="date"
          defaultValue={d?.completed_on ?? ""}
          className={INPUT_CLS}
        />
      </div>
      <div className="sm:col-span-2">
        <label className={LABEL_CLS}>Condition notes / findings</label>
        <textarea
          name="condition_notes"
          defaultValue={d?.condition_notes ?? ""}
          rows={2}
          placeholder="e.g. Walls clean; small scuff by the front door; fridge seal worn — flagged for follow-up"
          className={INPUT_CLS}
        />
      </div>
      <div className="sm:col-span-2">
        <label className={LABEL_CLS}>Notes (optional)</label>
        <input
          name="notes"
          defaultValue={d?.notes ?? ""}
          placeholder="e.g. 24h notice given Apr 1; tenant will be home"
          className={INPUT_CLS}
        />
      </div>
    </div>
  );
}

function metaLine(d: InspectionView): string {
  const parts: string[] = [];
  if (d.scheduled_for?.trim()) parts.push(`planned ${d.scheduled_for}`);
  if (d.completed_on?.trim()) parts.push(`completed ${d.completed_on}`);
  return parts.join(" · ");
}

export function TenancyInspectionSection({
  tenancyId,
  inspections,
}: {
  tenancyId: string;
  inspections: InspectionView[];
}) {
  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-600">
        Schedule and keep a record of your move-in, move-out, and periodic inspections &mdash;
        the condition history that protects you in a deposit or damage dispute. Set a
        &ldquo;planned date&rdquo; and turn on the &ldquo;Property inspection due&rdquo; reminder in
        Automations &amp; Templates, and we email you about a week before so you can give the
        tenant the required written notice and book a time. The reminder goes to your team, never
        the tenant. This logs the inspection; it does not file a condition-report form for you.
      </p>

      {inspections.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
          No inspections logged. Add one below to schedule a move-in, move-out, or periodic check.
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          {inspections.map((d) => {
            const lifecycle = lifecycleOf(d);
            const lcMeta = LIFECYCLE_META[lifecycle];
            const due = DUE_META[d.due];
            return (
              <li key={d.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-gray-900">
                        {inspectionTypeLabel(d.inspection_type)}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${lcMeta.cls}`}
                      >
                        {inspectionLifecycleLabel(lifecycle)}
                      </span>
                      {due ? (
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${due.cls}`}
                        >
                          {due.label}
                        </span>
                      ) : null}
                    </div>
                    {d.condition_notes?.trim() ? (
                      <div className="mt-0.5 truncate text-sm text-gray-700">
                        {d.condition_notes.trim()}
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
                        action={updateInspection}
                        className="mt-3 w-full rounded-xl border border-gray-200 bg-gray-50 p-4"
                      >
                        <input type="hidden" name="id" value={d.id} />
                        <input type="hidden" name="tenancy_id" value={tenancyId} />
                        <InspectionFields d={d} />
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
                    <form action={removeInspection}>
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
          + Schedule an inspection
        </summary>
        <form action={addInspection} className="mt-4">
          <input type="hidden" name="tenancy_id" value={tenancyId} />
          <InspectionFields />
          <div className="mt-3">
            <button
              type="submit"
              className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Add inspection
            </button>
          </div>
        </form>
      </details>
    </div>
  );
}
