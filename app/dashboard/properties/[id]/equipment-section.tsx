import { addEquipment, updateEquipment, removeEquipment } from "../actions";
import {
  equipmentTypeLabel,
  TYPE_SERVICE_LIFE_YEARS,
  type EquipmentType,
  type EquipmentStatus,
} from "@/lib/equipment-eol";

// Per-unit major-equipment inventory capture surface (S361) — the sibling of
// detectors-section.tsx (water heaters + furnaces). Server component: the
// add/edit forms post to server actions and the per-row edit form uses a native
// <details> disclosure (no client JS), matching CollapsibleSection. The page
// computes each item's EOL date + status (lib/equipment-eol, with the per-type
// lead window) and passes them in, so this file stays presentational.

export type EquipmentView = {
  id: string;
  equipment_type: EquipmentType;
  location: string | null;
  install_date: string | null;
  install_year: number | null;
  service_life_years: number | null;
  quantity: number;
  notes: string | null;
  eolDate: string | null;
  status: EquipmentStatus;
};

const STATUS_META: Record<EquipmentStatus, { label: string; cls: string }> = {
  overdue: { label: "Overdue", cls: "bg-red-100 text-red-800" },
  due_soon: { label: "Due soon", cls: "bg-amber-100 text-amber-800" },
  ok: { label: "OK", cls: "bg-green-100 text-green-800" },
  unknown: { label: "No date", cls: "bg-gray-100 text-gray-600" },
};

const INPUT_CLS =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand";
const LABEL_CLS = "block text-xs font-medium text-gray-600 mb-1";

function TypeSelect({ value }: { value?: EquipmentType }) {
  return (
    <select name="equipment_type" defaultValue={value ?? "water_heater"} className={INPUT_CLS}>
      <option value="water_heater">Water heater</option>
      <option value="furnace">Furnace</option>
    </select>
  );
}

/** The shared field grid, reused by the add form and each row's edit form. */
function EquipmentFields({ d }: { d?: EquipmentView }) {
  const installYear = d?.install_year != null ? String(d.install_year) : "";
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div>
        <label className={LABEL_CLS}>Type</label>
        <TypeSelect value={d?.equipment_type} />
      </div>
      <div>
        <label className={LABEL_CLS}>Location</label>
        <input
          name="location"
          defaultValue={d?.location ?? ""}
          placeholder="e.g. Basement mechanical room"
          className={INPUT_CLS}
        />
      </div>
      <div>
        <label className={LABEL_CLS}>Install year</label>
        <input
          name="install_year"
          type="number"
          min={1950}
          max={2100}
          defaultValue={installYear}
          placeholder="e.g. 2014"
          className={INPUT_CLS}
        />
      </div>
      <div>
        <label className={LABEL_CLS}>Exact install date (optional)</label>
        <input
          name="install_date"
          type="date"
          defaultValue={d?.install_date ?? ""}
          className={INPUT_CLS}
        />
      </div>
      <div>
        <label className={LABEL_CLS}>Quantity</label>
        <input
          name="quantity"
          type="number"
          min={1}
          max={999}
          defaultValue={d?.quantity != null ? String(d.quantity) : "1"}
          className={INPUT_CLS}
        />
      </div>
      <div>
        <label className={LABEL_CLS}>Service life override (years, optional)</label>
        <input
          name="service_life_years"
          type="number"
          min={1}
          max={40}
          defaultValue={d?.service_life_years != null ? String(d.service_life_years) : ""}
          placeholder={`Default: water heater ${TYPE_SERVICE_LIFE_YEARS.water_heater} / furnace ${TYPE_SERVICE_LIFE_YEARS.furnace}`}
          className={INPUT_CLS}
        />
      </div>
      <div className="sm:col-span-2">
        <label className={LABEL_CLS}>Notes (optional)</label>
        <input
          name="notes"
          defaultValue={d?.notes ?? ""}
          placeholder="e.g. tankless, make / model / serial"
          className={INPUT_CLS}
        />
      </div>
    </div>
  );
}

function installLabel(d: EquipmentView): string {
  if (d.install_date) return d.install_date;
  if (d.install_year != null) return String(d.install_year);
  return "—";
}

export function EquipmentSection({
  propertyId,
  equipment,
}: {
  propertyId: string;
  equipment: EquipmentView[];
}) {
  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-600">
        Log this unit&apos;s major equipment &mdash; water heaters and furnaces. We compute
        each one&apos;s manufacturer end-of-life from its install date (~10 years for a tank
        water heater, ~15 for a furnace) and, when you turn on the &ldquo;Major equipment
        reaching end of life&rdquo; reminder in Automations &amp; Templates, email you ahead
        of time &mdash; with enough lead to plan a replacement on your schedule (before a water
        heater leaks, or a furnace dies mid-winter) instead of paying emergency rates. Always
        confirm each item&apos;s manufacturer date.
      </p>

      {equipment.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
          No equipment logged yet. Add the first one below.
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          {equipment.map((d) => {
            const meta = STATUS_META[d.status];
            return (
              <li key={d.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">
                        {equipmentTypeLabel(d.equipment_type)}
                        {d.quantity > 1 ? ` ×${d.quantity}` : ""}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${meta.cls}`}
                      >
                        {meta.label}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-gray-500">
                      {d.location ? `${d.location} · ` : ""}
                      installed {installLabel(d)}
                      {d.eolDate ? ` · end of life ${d.eolDate}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <details className="group">
                      <summary className="cursor-pointer list-none text-sm font-medium text-brand hover:underline [&::-webkit-details-marker]:hidden">
                        Edit
                      </summary>
                      <form
                        action={updateEquipment}
                        className="mt-3 w-full rounded-xl border border-gray-200 bg-gray-50 p-4"
                      >
                        <input type="hidden" name="id" value={d.id} />
                        <input type="hidden" name="property_id" value={propertyId} />
                        <EquipmentFields d={d} />
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
                    <form action={removeEquipment}>
                      <input type="hidden" name="id" value={d.id} />
                      <input type="hidden" name="property_id" value={propertyId} />
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
          + Add equipment
        </summary>
        <form action={addEquipment} className="mt-4">
          <input type="hidden" name="property_id" value={propertyId} />
          <EquipmentFields />
          <div className="mt-3">
            <button
              type="submit"
              className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Add equipment
            </button>
          </div>
        </form>
      </details>
    </div>
  );
}
