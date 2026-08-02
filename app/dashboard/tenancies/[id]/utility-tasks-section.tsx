import {
  addUtilityTask,
  removeUtilityTask,
  seedDefaultUtilityTasks,
  updateUtilityTask,
} from "./utility-actions";
import {
  RESPONSIBLE_PARTIES,
  UTILITY_TASK_STATUSES,
  responsiblePartyLabel,
  utilityTaskStatusLabel,
  type ResponsibleParty,
  type UtilityTaskStatus,
} from "@/lib/utility-tasks";

export type UtilityTaskView = {
  id: string;
  label: string;
  responsible_party: string | null;
  target_date: string | null;
  status: string | null;
  confirmation_note: string | null;
  sort_order: number | null;
};

const INPUT_CLS =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand";
const LABEL_CLS = "block text-xs font-medium text-gray-600 mb-1";

const STATUS_META: Record<UtilityTaskStatus, { cls: string }> = {
  todo: { cls: "bg-gray-100 text-gray-700" },
  in_progress: { cls: "bg-amber-100 text-amber-800" },
  done: { cls: "bg-green-100 text-green-800" },
  na: { cls: "bg-gray-100 text-gray-600" },
};

const PARTY_META: Record<ResponsibleParty, { cls: string }> = {
  tenant: { cls: "bg-blue-100 text-blue-800" },
  landlord: { cls: "bg-purple-100 text-purple-800" },
  na: { cls: "bg-gray-100 text-gray-600" },
};

function validStatus(value: string | null): UtilityTaskStatus {
  const clean = value ?? "";
  return UTILITY_TASK_STATUSES.includes(clean as UtilityTaskStatus)
    ? (clean as UtilityTaskStatus)
    : "todo";
}

function validParty(value: string | null): ResponsibleParty {
  const clean = value ?? "";
  return RESPONSIBLE_PARTIES.includes(clean as ResponsibleParty)
    ? (clean as ResponsibleParty)
    : "tenant";
}

function StatusBadge({ status }: { status: string | null }) {
  const clean = validStatus(status);
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_META[clean].cls}`}>
      {utilityTaskStatusLabel(clean)}
    </span>
  );
}

function PartyBadge({ party }: { party: string | null }) {
  const clean = validParty(party);
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PARTY_META[clean].cls}`}>
      {responsiblePartyLabel(clean)}
    </span>
  );
}

function UtilityFields({
  task,
  sortOrder,
}: {
  task?: UtilityTaskView;
  sortOrder: number;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <input type="hidden" name="sort_order" value={String(task?.sort_order ?? sortOrder)} />
      <div>
        <label className={LABEL_CLS}>Task</label>
        <input
          name="label"
          required
          defaultValue={task?.label ?? ""}
          placeholder="Hydro transfer"
          className={INPUT_CLS}
        />
      </div>
      <div>
        <label className={LABEL_CLS}>Responsible party</label>
        <select
          name="responsible_party"
          defaultValue={validParty(task?.responsible_party ?? null)}
          className={INPUT_CLS}
        >
          {RESPONSIBLE_PARTIES.map((party) => (
            <option key={party} value={party}>
              {responsiblePartyLabel(party)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={LABEL_CLS}>Target date (optional)</label>
        <input
          name="target_date"
          type="date"
          defaultValue={task?.target_date ?? ""}
          className={INPUT_CLS}
        />
      </div>
      <div>
        <label className={LABEL_CLS}>Status</label>
        <select
          name="status"
          defaultValue={validStatus(task?.status ?? null)}
          className={INPUT_CLS}
        >
          {UTILITY_TASK_STATUSES.map((status) => (
            <option key={status} value={status}>
              {utilityTaskStatusLabel(status)}
            </option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-2">
        <label className={LABEL_CLS}>Confirmation note</label>
        <input
          name="confirmation_note"
          defaultValue={task?.confirmation_note ?? ""}
          placeholder="Account number received; proof requested"
          className={INPUT_CLS}
        />
      </div>
    </div>
  );
}

export function TenancyUtilitySection({
  tenancyId,
  utilities,
}: {
  tenancyId: string;
  utilities: UtilityTaskView[];
}) {
  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-600">
        Track tenant and landlord handoffs for hydro, water, internet, insurance proof,
        and mail forwarding separately from the rental included-in-rent settings.
      </p>

      {utilities.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
          No utility transfer tasks yet.
          <form action={seedDefaultUtilityTasks} className="mt-3">
            <input type="hidden" name="tenancy_id" value={tenancyId} />
            <button
              type="submit"
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              Add standard utilities
            </button>
          </form>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          {utilities.map((task) => (
            <li key={task.id} className="px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gray-900">{task.label}</span>
                    <PartyBadge party={task.responsible_party} />
                    <StatusBadge status={task.status} />
                  </div>
                  {task.target_date ? (
                    <p className="mt-1 text-xs text-gray-500">Target {task.target_date}</p>
                  ) : null}
                  {task.confirmation_note?.trim() ? (
                    <p className="mt-1 text-sm text-gray-600">
                      {task.confirmation_note.trim()}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-3">
                  <details className="group">
                    <summary className="cursor-pointer list-none text-sm font-medium text-brand hover:underline [&::-webkit-details-marker]:hidden">
                      Edit
                    </summary>
                    <form
                      action={updateUtilityTask}
                      className="mt-3 w-full rounded-xl border border-gray-200 bg-gray-50 p-4"
                    >
                      <input type="hidden" name="id" value={task.id} />
                      <input type="hidden" name="tenancy_id" value={tenancyId} />
                      <UtilityFields task={task} sortOrder={utilities.length} />
                      <div className="mt-3">
                        <button
                          type="submit"
                          className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:opacity-90"
                        >
                          Save task
                        </button>
                      </div>
                    </form>
                  </details>
                  <form action={removeUtilityTask}>
                    <input type="hidden" name="id" value={task.id} />
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
          ))}
        </ul>
      )}

      <details className="group rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <summary className="cursor-pointer list-none text-sm font-semibold text-gray-900 [&::-webkit-details-marker]:hidden">
          + Add utility task
        </summary>
        <form action={addUtilityTask} className="mt-4">
          <input type="hidden" name="tenancy_id" value={tenancyId} />
          <UtilityFields sortOrder={utilities.length} />
          <div className="mt-3">
            <button
              type="submit"
              className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Add task
            </button>
          </div>
        </form>
      </details>
    </div>
  );
}
