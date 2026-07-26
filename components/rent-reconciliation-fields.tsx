"use client";

import { useEffect, useState } from "react";

type ReconciliationStatus = "unchanged" | "changed" | "";

type Props = {
  rentInputId: string;
  defaultRentCents?: number | null;
  defaultCurrentEffectiveDate?: string | null;
  source?: "lease_ocr" | "landlord_confirm";
  visible?: boolean;
  title?: string;
  description?: string;
  className?: string;
};

const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";
const labelCls = "mb-1 block text-xs font-medium text-gray-600";

function centsToDollars(cents: number | null | undefined): string {
  return cents == null ? "" : (cents / 100).toString();
}

function parseDollars(value: string): number | null {
  const n = Number.parseFloat(value.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

function formatRent(cents: number | null): string {
  if (cents == null) return "the rent above";
  return `$${(cents / 100).toLocaleString("en-CA", {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}/mo`;
}

export function RentReconciliationFields({
  rentInputId,
  defaultRentCents = null,
  defaultCurrentEffectiveDate = null,
  source = "landlord_confirm",
  visible = true,
  title = "Confirm the current rent",
  description = "Before rent-increase tracking starts, confirm whether the lease rent is still the rent the tenant pays today.",
  className = "",
}: Props) {
  const [active, setActive] = useState(visible);
  const [status, setStatus] = useState<ReconciliationStatus>("");
  const [knownRentCents, setKnownRentCents] = useState<number | null>(
    defaultRentCents ?? null,
  );
  const [currentRent, setCurrentRent] = useState(centsToDollars(defaultRentCents));
  const [currentEffectiveDate, setCurrentEffectiveDate] = useState(
    defaultCurrentEffectiveDate ?? "",
  );
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    const input = document.getElementById(rentInputId) as HTMLInputElement | null;
    const syncFromInput = () => {
      if (!input) return;
      const cents = parseDollars(input.value);
      setKnownRentCents(cents);
      setCurrentRent((value) => (value.trim() ? value : input.value));
    };
    syncFromInput();
    input?.addEventListener("input", syncFromInput);

    const onLeaseOcr = (event: Event) => {
      const custom = event as CustomEvent<{ rentCents?: number | null }>;
      const rentCents =
        typeof custom.detail?.rentCents === "number" ? custom.detail.rentCents : null;
      setActive(true);
      if (rentCents != null) {
        setKnownRentCents(rentCents);
        setCurrentRent(centsToDollars(rentCents));
      } else {
        syncFromInput();
      }
      setStatus("");
    };
    document.addEventListener("vacantless:lease-ocr-rent-confirmation", onLeaseOcr);
    return () => {
      input?.removeEventListener("input", syncFromInput);
      document.removeEventListener(
        "vacantless:lease-ocr-rent-confirmation",
        onLeaseOcr,
      );
    };
  }, [rentInputId]);

  return (
    <div className={`${active ? "" : "hidden"} ${className}`}>
      <input
        type="hidden"
        name="rent_reconciliation_required"
        value={active ? "1" : "0"}
      />
      <input type="hidden" name="rent_reconciliation_source" value={source} />
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
        <p className="text-sm font-semibold text-gray-800">{title}</p>
        <p className="mt-1 text-xs text-gray-500">{description}</p>
        <p className="mt-2 text-xs text-gray-500">
          Lease rent on file:{" "}
          <span className="font-semibold text-gray-800">
            {formatRent(knownRentCents)}
          </span>
        </p>

        <fieldset className="mt-3 space-y-2">
          <legend className="sr-only">Current rent confirmation</legend>
          <label className="flex items-start gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
            <input
              type="radio"
              name="rent_current_status"
              value="unchanged"
              required={active}
              checked={status === "unchanged"}
              onChange={() => setStatus("unchanged")}
              className="mt-0.5"
            />
            <span>This is still the current rent.</span>
          </label>
          <label className="flex items-start gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
            <input
              type="radio"
              name="rent_current_status"
              value="changed"
              required={active}
              checked={status === "changed"}
              onChange={() => setStatus("changed")}
              className="mt-0.5"
            />
            <span>The current rent has changed since the lease was signed.</span>
          </label>
        </fieldset>

        {status === "changed" && (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={labelCls}>Current monthly rent ($)</label>
                <input
                  type="number"
                  name="current_rent"
                  step="0.01"
                  min="0"
                  required
                  value={currentRent}
                  onChange={(e) => setCurrentRent(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Date this rent took effect</label>
                <input
                  type="date"
                  name="current_rent_effective_date"
                  required
                  value={currentEffectiveDate}
                  onChange={(e) => setCurrentEffectiveDate(e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              className="text-xs font-medium text-brand hover:underline"
            >
              {showHistory ? "Hide earlier change" : "Add an earlier change"}
            </button>

            {showHistory && (
              <div className="grid grid-cols-1 gap-3 rounded-lg border border-gray-200 bg-white p-3 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>Earlier effective date</label>
                  <input
                    type="date"
                    name="rent_adjustment_effective_date"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Earlier rent ($)</label>
                  <input
                    type="number"
                    name="rent_adjustment_rent"
                    step="0.01"
                    min="0"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Change type</label>
                  <select name="rent_adjustment_kind" className={inputCls} defaultValue="increase">
                    <option value="increase">Increase</option>
                    <option value="reduction">Reduction</option>
                    <option value="altered_term">Altered term</option>
                    <option value="correction">Correction</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Note (optional)</label>
                  <input
                    name="rent_adjustment_note"
                    placeholder="e.g. 2024 N1 served"
                    className={inputCls}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
