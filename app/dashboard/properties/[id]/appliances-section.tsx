import {
  addAppliance,
  updateAppliance,
  removeAppliance,
  markConsumableReplaced,
  uploadApplianceReceipt,
  removeApplianceReceipt,
  scanAppliancePlate,
} from "../actions";
import {
  applianceTypeLabel,
  APPLIANCE_TYPES,
  type ApplianceType,
  type ApplianceStatus,
} from "@/lib/appliance-care";
import type { AppliancePrefill } from "@/lib/asset-capture";

// Per-unit appliance inventory capture surface (S362) — the sibling of
// detectors-section.tsx / equipment-section.tsx (fridge, stove, dishwasher,
// washer, dryer, microwave). Server component: the add/edit forms post to server
// actions and the per-row edit form uses a native <details> disclosure (no client
// JS), matching CollapsibleSection. The page computes each appliance's warranty
// expiry + recurring-consumable due date + their statuses (lib/appliance-care)
// and passes them in, so this file stays presentational.
//
// Two reminders ride each appliance, shown as two independent chips: WARRANTY
// (one-shot, before the manufacturer warranty lapses) and CONSUMABLE (recurring,
// e.g. a fridge water filter every N months). A one-tap "Mark replaced" rolls the
// consumable's clock forward one cycle (the recurrence).

/** One receipt / purchase proof attached to an appliance (a document-vault row,
 * 0083). signedUrl is a short-lived URL into the private bucket, minted by the
 * page; null if the mint failed. */
export type ApplianceReceiptView = {
  id: string;
  title: string;
  mime_type: string;
  signedUrl: string | null;
};

export type ApplianceView = {
  id: string;
  appliance_type: ApplianceType;
  make: string | null;
  model: string | null;
  serial: string | null;
  location: string | null;
  purchase_date: string | null;
  install_year: number | null;
  quantity: number;
  warranty_months: number | null;
  consumable_label: string | null;
  consumable_interval_months: number | null;
  consumable_anchor_date: string | null;
  notes: string | null;
  warrantyExpiry: string | null;
  warrantyStatus: ApplianceStatus;
  consumableDue: string | null;
  consumableStatus: ApplianceStatus;
  receipts: ApplianceReceiptView[];
};

const STATUS_META: Record<ApplianceStatus, { label: string; cls: string }> = {
  overdue: { label: "Overdue", cls: "bg-red-100 text-red-800" },
  due_soon: { label: "Due soon", cls: "bg-amber-100 text-amber-800" },
  ok: { label: "OK", cls: "bg-green-100 text-green-800" },
  unknown: { label: "No date", cls: "bg-gray-100 text-gray-600" },
};

const INPUT_CLS =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand";
const LABEL_CLS = "block text-xs font-medium text-gray-600 mb-1";

function TypeSelect({ value }: { value?: ApplianceType }) {
  return (
    <select name="appliance_type" defaultValue={value ?? "fridge"} className={INPUT_CLS}>
      {APPLIANCE_TYPES.map((t) => (
        <option key={t} value={t}>
          {applianceTypeLabel(t)}
        </option>
      ))}
    </select>
  );
}

/** The shared field grid, reused by the add form and each row's edit form. When
 * `prefill` is set (from a plate/receipt scan, S364) its values seed the inputs
 * that the scan could read — type/make/model/serial/year/warranty — while every
 * field stays editable so the landlord confirms before saving. An existing row
 * (`d`) always wins over a scan prefill. */
function ApplianceFields({ d, prefill }: { d?: ApplianceView; prefill?: AppliancePrefill | null }) {
  const installYearVal = d?.install_year ?? prefill?.install_year ?? null;
  const installYear = installYearVal != null ? String(installYearVal) : "";
  const warrantyVal = d?.warranty_months ?? prefill?.warranty_months ?? null;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={LABEL_CLS}>Type</label>
          <TypeSelect value={d?.appliance_type ?? prefill?.appliance_type ?? undefined} />
        </div>
        <div>
          <label className={LABEL_CLS}>Location</label>
          <input
            name="location"
            defaultValue={d?.location ?? ""}
            placeholder="e.g. Kitchen"
            className={INPUT_CLS}
          />
        </div>
        <div>
          <label className={LABEL_CLS}>Make</label>
          <input
            name="make"
            defaultValue={d?.make ?? prefill?.make ?? ""}
            placeholder="e.g. Whirlpool"
            className={INPUT_CLS}
          />
        </div>
        <div>
          <label className={LABEL_CLS}>Model</label>
          <input
            name="model"
            defaultValue={d?.model ?? prefill?.model ?? ""}
            placeholder="e.g. WRF555SDFZ"
            className={INPUT_CLS}
          />
        </div>
        <div>
          <label className={LABEL_CLS}>Serial</label>
          <input
            name="serial"
            defaultValue={d?.serial ?? prefill?.serial ?? ""}
            placeholder="from the plate"
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
          <label className={LABEL_CLS}>Purchase year</label>
          <input
            name="install_year"
            type="number"
            min={1950}
            max={2100}
            defaultValue={installYear}
            placeholder="e.g. 2023"
            className={INPUT_CLS}
          />
        </div>
        <div>
          <label className={LABEL_CLS}>Exact purchase date (optional)</label>
          <input
            name="purchase_date"
            type="date"
            defaultValue={d?.purchase_date ?? ""}
            className={INPUT_CLS}
          />
        </div>
      </div>

      <fieldset className="rounded-xl border border-gray-200 p-3">
        <legend className="px-1 text-xs font-semibold text-gray-700">
          Warranty reminder (optional)
        </legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={LABEL_CLS}>Warranty length (months)</label>
            <input
              name="warranty_months"
              type="number"
              min={1}
              max={600}
              defaultValue={warrantyVal != null ? String(warrantyVal) : ""}
              placeholder="e.g. 24"
              className={INPUT_CLS}
            />
          </div>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          We remind you ~6 weeks before the manufacturer warranty lapses, so you can register or
          claim it. Leave blank for none.
        </p>
      </fieldset>

      <fieldset className="rounded-xl border border-gray-200 p-3">
        <legend className="px-1 text-xs font-semibold text-gray-700">
          Recurring consumable (optional)
        </legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className={LABEL_CLS}>What</label>
            <input
              name="consumable_label"
              defaultValue={d?.consumable_label ?? prefill?.consumable_label ?? ""}
              placeholder="e.g. Water filter"
              className={INPUT_CLS}
            />
          </div>
          <div>
            <label className={LABEL_CLS}>Every (months)</label>
            <input
              name="consumable_interval_months"
              type="number"
              min={1}
              max={120}
              defaultValue={
                (d?.consumable_interval_months ?? prefill?.consumable_interval_months) != null
                  ? String(d?.consumable_interval_months ?? prefill?.consumable_interval_months)
                  : ""
              }
              placeholder="e.g. 6"
              className={INPUT_CLS}
            />
          </div>
          <div>
            <label className={LABEL_CLS}>Last replaced (optional)</label>
            <input
              name="consumable_anchor_date"
              type="date"
              defaultValue={d?.consumable_anchor_date ?? ""}
              className={INPUT_CLS}
            />
          </div>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          For things that get replaced on a cycle (a fridge water filter, a range-hood filter). We
          remind you when it&apos;s due; one tap on &ldquo;Mark replaced&rdquo; rolls the schedule
          forward. Defaults to counting from the purchase date.
        </p>
      </fieldset>

      <div>
        <label className={LABEL_CLS}>Notes (optional)</label>
        <input
          name="notes"
          defaultValue={d?.notes ?? ""}
          placeholder="anything else worth remembering"
          className={INPUT_CLS}
        />
      </div>
    </div>
  );
}

function purchaseLabel(d: ApplianceView): string {
  if (d.purchase_date) return d.purchase_date;
  if (d.install_year != null) return String(d.install_year);
  return "—";
}

/** A small status chip with a prefix label (e.g. "Warranty: Overdue"). */
function Chip({ prefix, status }: { prefix: string; status: ApplianceStatus }) {
  const meta = STATUS_META[status];
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${meta.cls}`}>
      {prefix}: {meta.label}
    </span>
  );
}

/** Receipts / purchase proof attached to one appliance (S363). Lists each stored
 * receipt with a View link (a short-lived signed URL into the private vault) +
 * Remove, and an inline upload form. PDFs or scan images, one per upload. */
function ReceiptsBlock({ d, propertyId }: { d: ApplianceView; propertyId: string }) {
  return (
    <div className="mt-2 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-xs font-medium text-gray-600">Receipts:</span>

        {d.receipts.length === 0 ? (
          <span className="text-xs text-gray-400">none yet</span>
        ) : (
          <ul className="flex flex-wrap items-center gap-2">
            {d.receipts.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2 py-1"
              >
                {r.signedUrl ? (
                  <a
                    href={r.signedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="max-w-[12rem] truncate text-xs font-medium text-brand hover:underline"
                    title={r.title}
                  >
                    {r.title}
                  </a>
                ) : (
                  <span className="max-w-[12rem] truncate text-xs text-gray-400" title={r.title}>
                    {r.title} (unavailable)
                  </span>
                )}
                <form action={removeApplianceReceipt}>
                  <input type="hidden" name="document_id" value={r.id} />
                  <input type="hidden" name="property_id" value={propertyId} />
                  <button
                    type="submit"
                    className="text-xs text-gray-400 hover:text-red-600"
                    title="Remove this receipt"
                    aria-label={`Remove receipt ${r.title}`}
                  >
                    &times;
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}

        <details className="group ml-auto">
          <summary className="cursor-pointer list-none text-xs font-medium text-brand hover:underline [&::-webkit-details-marker]:hidden">
            + Add receipt
          </summary>
          <form action={uploadApplianceReceipt} className="mt-2 flex flex-wrap items-center gap-2">
            <input type="hidden" name="appliance_id" value={d.id} />
            <input type="hidden" name="property_id" value={propertyId} />
            <input
              type="file"
              name="receipt"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              required
              className="text-xs text-gray-600 file:mr-2 file:rounded-lg file:border-0 file:bg-brand file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:opacity-90"
            />
            <button
              type="submit"
              className="rounded-lg border border-brand px-2.5 py-1.5 text-xs font-medium text-brand hover:bg-brand/5"
            >
              Upload
            </button>
          </form>
          <p className="mt-1 text-xs text-gray-500">
            PDF or photo of the receipt, up to 25 MB. Stored privately; only you can open it.
          </p>
        </details>
      </div>
    </div>
  );
}

/** Maps a scan outcome (the ?scan= query the scanAppliancePlate action sets) to
 * a one-line note above the add form. "ok" is handled by the prefill banner, so
 * only the non-ok outcomes surface here. */
const SCAN_NOTE: Record<string, { msg: string; tone: string }> = {
  unconfigured: {
    msg: "Plate scanning isn’t switched on yet. Enter the details by hand for now.",
    tone: "bg-gray-100 text-gray-600",
  },
  empty: {
    msg: "Couldn’t read that photo clearly — try a sharper, straight-on shot of the plate, or enter the details by hand.",
    tone: "bg-amber-100 text-amber-800",
  },
  failed: {
    msg: "Something went wrong reading that photo. Try again, or enter the details by hand.",
    tone: "bg-amber-100 text-amber-800",
  },
  badtype: {
    msg: "Please choose a photo (JPEG, PNG or WebP) of the plate or receipt.",
    tone: "bg-amber-100 text-amber-800",
  },
  none: {
    msg: "No photo was selected. Pick a photo of the plate or receipt to scan.",
    tone: "bg-amber-100 text-amber-800",
  },
};

/** The "scan a plate / receipt" capture affordance (S364). A single file input
 * that opens the phone camera (capture=environment); posting it runs the
 * multimodal parse and reopens the Add form prefilled. */
function ScanCapture({ propertyId }: { propertyId: string }) {
  return (
    <form action={scanAppliancePlate} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="property_id" value={propertyId} />
      <input
        type="file"
        name="plate"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        required
        className="text-xs text-gray-600 file:mr-2 file:rounded-lg file:border-0 file:bg-brand file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:opacity-90"
      />
      <button
        type="submit"
        className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:opacity-90"
      >
        Scan plate / receipt
      </button>
    </form>
  );
}

export function AppliancesSection({
  propertyId,
  appliances,
  prefill,
  scanStatus,
}: {
  propertyId: string;
  appliances: ApplianceView[];
  prefill?: AppliancePrefill | null;
  scanStatus?: string | null;
}) {
  const scanNote = scanStatus && scanStatus !== "ok" ? SCAN_NOTE[scanStatus] : null;
  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-600">
        Log this unit&apos;s appliances &mdash; fridge, stove, dishwasher, washer, dryer, microwave.
        Keep the make / model / serial for warranty claims and ordering the right parts, and turn on
        two optional reminders per appliance: a <strong>warranty</strong> nudge before the
        manufacturer coverage lapses, and a <strong>recurring</strong> nudge for consumables like a
        fridge water filter. Enable them under the &ldquo;Appliance warranty&rdquo; and
        &ldquo;Appliance consumable&rdquo; reminders in Settings &rarr; Notifications.
      </p>

      {appliances.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
          No appliances logged yet. Add the first one below.
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          {appliances.map((d) => {
            const hasWarranty = d.warrantyStatus !== "unknown" || d.warranty_months != null;
            const hasConsumable = !!(d.consumable_label && d.consumable_interval_months);
            const ident = [d.make, d.model].filter(Boolean).join(" ");
            return (
              <li key={d.id} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-gray-900">
                        {applianceTypeLabel(d.appliance_type)}
                        {d.quantity > 1 ? ` ×${d.quantity}` : ""}
                      </span>
                      {hasWarranty ? <Chip prefix="Warranty" status={d.warrantyStatus} /> : null}
                      {hasConsumable ? (
                        <Chip prefix={d.consumable_label || "Consumable"} status={d.consumableStatus} />
                      ) : null}
                    </div>
                    <div className="mt-0.5 text-xs text-gray-500">
                      {ident ? `${ident} · ` : ""}
                      {d.location ? `${d.location} · ` : ""}
                      purchased {purchaseLabel(d)}
                      {hasWarranty && d.warrantyExpiry ? ` · warranty to ${d.warrantyExpiry}` : ""}
                      {hasConsumable && d.consumableDue
                        ? ` · ${d.consumable_label} due ${d.consumableDue}`
                        : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {hasConsumable ? (
                      <form action={markConsumableReplaced}>
                        <input type="hidden" name="id" value={d.id} />
                        <input type="hidden" name="property_id" value={propertyId} />
                        <button
                          type="submit"
                          className="rounded-lg border border-brand px-2.5 py-1.5 text-xs font-medium text-brand hover:bg-brand/5"
                          title={`Reset the ${d.consumable_label} schedule to today`}
                        >
                          Mark replaced
                        </button>
                      </form>
                    ) : null}
                    <details className="group">
                      <summary className="cursor-pointer list-none text-sm font-medium text-brand hover:underline [&::-webkit-details-marker]:hidden">
                        Edit
                      </summary>
                      <form
                        action={updateAppliance}
                        className="mt-3 w-full rounded-xl border border-gray-200 bg-gray-50 p-4"
                      >
                        <input type="hidden" name="id" value={d.id} />
                        <input type="hidden" name="property_id" value={propertyId} />
                        <ApplianceFields d={d} />
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
                    <form action={removeAppliance}>
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
                <ReceiptsBlock d={d} propertyId={propertyId} />
              </li>
            );
          })}
        </ul>
      )}

      {/* Photo-OCR capture (S364): snap the plate / receipt to prefill the form. */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900">Scan a plate or receipt</p>
            <p className="mt-0.5 text-xs text-gray-500">
              Snap the appliance data plate or the purchase receipt — we read the make, model and
              serial (and any recommended replacement schedule) and prefill the form for you to
              confirm.
            </p>
          </div>
          <ScanCapture propertyId={propertyId} />
        </div>
        {scanNote ? (
          <p className={`mt-3 rounded-lg px-3 py-2 text-xs ${scanNote.tone}`}>{scanNote.msg}</p>
        ) : null}
      </div>

      <details
        className="group rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
        open={!!prefill}
      >
        <summary className="cursor-pointer list-none text-sm font-semibold text-gray-900 [&::-webkit-details-marker]:hidden">
          + Add appliance
        </summary>
        {prefill ? (
          <p className="mt-3 rounded-lg bg-green-100 px-3 py-2 text-xs text-green-800">
            Scanned the photo — review the details below and save. Anything we couldn’t read is left
            blank.
          </p>
        ) : null}
        <form action={addAppliance} className="mt-4">
          <input type="hidden" name="property_id" value={propertyId} />
          <ApplianceFields prefill={prefill} />
          <div className="mt-3">
            <button
              type="submit"
              className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Add appliance
            </button>
          </div>
        </form>
      </details>
    </div>
  );
}
