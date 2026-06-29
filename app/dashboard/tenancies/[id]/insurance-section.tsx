import { addInsurance, updateInsurance, removeInsurance } from "./insurance-actions";
import {
  formatCoverageCents,
  type InsuranceStatus,
} from "@/lib/tenancy-insurance";

// Per-tenancy renter's-insurance capture surface (S382) — the tenancy-scoped
// sibling of the unit asset sections (equipment-section.tsx). Server component:
// the add/edit forms post to server actions and the per-row edit form uses a
// native <details> disclosure (no client JS), matching CollapsibleSection. The
// page computes each policy's status (lib/tenancy-insurance) and passes it in,
// so this file stays presentational.

export type InsuranceView = {
  id: string;
  provider: string | null;
  policy_number: string | null;
  coverage_amount_cents: number | null;
  effective_date: string | null;
  expiry_date: string | null;
  notes: string | null;
  status: InsuranceStatus;
};

const STATUS_META: Record<InsuranceStatus, { label: string; cls: string }> = {
  lapsed: { label: "Lapsed", cls: "bg-red-100 text-red-800" },
  expiring_soon: { label: "Expiring soon", cls: "bg-amber-100 text-amber-800" },
  ok: { label: "Active", cls: "bg-green-100 text-green-800" },
  unknown: { label: "No expiry", cls: "bg-gray-100 text-gray-600" },
};

const INPUT_CLS =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand";
const LABEL_CLS = "block text-xs font-medium text-gray-600 mb-1";

/** The shared field grid, reused by the add form and each row's edit form. */
function InsuranceFields({ d }: { d?: InsuranceView }) {
  const coverage =
    d?.coverage_amount_cents != null
      ? String(Math.round(d.coverage_amount_cents / 100))
      : "";
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div>
        <label className={LABEL_CLS}>Insurer / provider</label>
        <input
          name="provider"
          defaultValue={d?.provider ?? ""}
          placeholder="e.g. Square One, TD Insurance"
          className={INPUT_CLS}
        />
      </div>
      <div>
        <label className={LABEL_CLS}>Policy number</label>
        <input
          name="policy_number"
          defaultValue={d?.policy_number ?? ""}
          placeholder="e.g. POL-123456"
          className={INPUT_CLS}
        />
      </div>
      <div>
        <label className={LABEL_CLS}>Effective date (optional)</label>
        <input
          name="effective_date"
          type="date"
          defaultValue={d?.effective_date ?? ""}
          className={INPUT_CLS}
        />
      </div>
      <div>
        <label className={LABEL_CLS}>Expiry date</label>
        <input
          name="expiry_date"
          type="date"
          defaultValue={d?.expiry_date ?? ""}
          className={INPUT_CLS}
        />
      </div>
      <div>
        <label className={LABEL_CLS}>Liability coverage ($, optional)</label>
        <input
          name="coverage_amount"
          type="text"
          inputMode="numeric"
          defaultValue={coverage}
          placeholder="e.g. 1000000"
          className={INPUT_CLS}
        />
      </div>
      <div className="sm:col-span-2">
        <label className={LABEL_CLS}>Notes (optional)</label>
        <input
          name="notes"
          defaultValue={d?.notes ?? ""}
          placeholder="e.g. covers contents + personal liability"
          className={INPUT_CLS}
        />
      </div>
    </div>
  );
}

function policyTitle(d: InsuranceView): string {
  return (d.provider ?? "").trim() || "Renter's insurance";
}

function metaLine(d: InsuranceView): string {
  const parts: string[] = [];
  if (d.policy_number?.trim()) parts.push(`policy ${d.policy_number.trim()}`);
  const coverage = formatCoverageCents(d.coverage_amount_cents);
  if (coverage) parts.push(`${coverage} liability`);
  parts.push(d.expiry_date ? `expires ${d.expiry_date}` : "no expiry on file");
  return parts.join(" · ");
}

export function TenancyInsuranceSection({
  tenancyId,
  policies,
}: {
  tenancyId: string;
  policies: InsuranceView[];
}) {
  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-600">
        If your lease requires the tenant to carry renter&apos;s (contents + liability)
        insurance, log their policy here. When you turn on the &ldquo;Renter&apos;s insurance
        expiring or lapsed&rdquo; reminder in Settings &rarr; Notifications, we email you about a
        month before it expires &mdash; and again if it lapses &mdash; so you can ask for renewed
        proof before any coverage gap. The reminder goes to your team, never the tenant.
      </p>

      {policies.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
          No insurance logged yet. Add the tenant&apos;s policy below.
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          {policies.map((d) => {
            const meta = STATUS_META[d.status];
            return (
              <li key={d.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">{policyTitle(d)}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${meta.cls}`}
                      >
                        {meta.label}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-gray-500">{metaLine(d)}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <details className="group">
                      <summary className="cursor-pointer list-none text-sm font-medium text-brand hover:underline [&::-webkit-details-marker]:hidden">
                        Edit
                      </summary>
                      <form
                        action={updateInsurance}
                        className="mt-3 w-full rounded-xl border border-gray-200 bg-gray-50 p-4"
                      >
                        <input type="hidden" name="id" value={d.id} />
                        <input type="hidden" name="tenancy_id" value={tenancyId} />
                        <InsuranceFields d={d} />
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
                    <form action={removeInsurance}>
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
          + Add insurance
        </summary>
        <form action={addInsurance} className="mt-4">
          <input type="hidden" name="tenancy_id" value={tenancyId} />
          <InsuranceFields />
          <div className="mt-3">
            <button
              type="submit"
              className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Add insurance
            </button>
          </div>
        </form>
      </details>
    </div>
  );
}
