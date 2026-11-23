import { SubmitButton } from "@/components/submit-button";
import {
  addNsfCharge,
  removeNsfCharge,
  setNsfChargePaid,
  updateNsfCharge,
} from "@/app/dashboard/tenancies/nsf-actions";
import {
  NSF_GUIDANCE,
  NSF_MESSAGES,
  NSF_RULE_URL,
  nsfChargeTotalCents,
  nsfInputValue,
  nsfMoney,
  nsfOwingCents,
  type NsfChargeRow,
} from "@/lib/nsf-charge";

// S835c: NSF charges on a tenancy. A failed Stripe debit adds a row by itself
// (the bank charge filled in, the admin charge empty). The landlord can change
// both, add one by hand, mark it paid or remove it. A record only: nothing
// here takes money from the tenant.

const BOX = "w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm";
const SMALL_BTN =
  "inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60";

function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[(m ?? 1) - 1]} ${d}, ${y}`;
}

export default function TenancyNsfCharges({
  tenancyId,
  tenantName,
  rows,
  todayIso,
  message,
}: {
  tenancyId: string;
  tenantName: string | null;
  rows: NsfChargeRow[];
  todayIso: string;
  message: string | null;
}) {
  const owing = nsfOwingCents(rows);
  const msg = message ? NSF_MESSAGES[message] ?? null : null;
  return (
    <div id="nsf-charges" className="mb-8 scroll-mt-24 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-gray-700">NSF charges</h4>
        {owing > 0 && <span className="text-sm font-medium text-gray-900">{nsfMoney(owing)} not paid yet</span>}
      </div>
      {msg && (
        <p
          className={`mb-3 rounded-lg border px-3 py-2 text-sm ${
            msg.tone === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {msg.text}
        </p>
      )}
      <p className="mb-4 text-sm text-gray-600">
        When a rent payment fails, the bank charges you a fee. Keep what {tenantName || "your tenant"} owes you for it
        here. A failed Stripe or Rotessa payment is added for you. You can change the amounts.
      </p>

      {rows.length > 0 && (
        <ul className="mb-4 divide-y divide-gray-100 rounded-xl border border-gray-200">
          {rows.map((r) => (
            <li key={r.id} className="space-y-3 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-medium text-gray-900">
                  {dayLabel(r.incurred_on)}: {nsfMoney(nsfChargeTotalCents(r))}
                </span>
                <span className={r.paid_at ? "text-emerald-700" : "text-amber-700"}>{r.paid_at ? "Paid" : "Not paid yet"}</span>
              </div>
              <form action={updateNsfCharge} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenancy_id" value={tenancyId} />
                <input type="hidden" name="id" value={r.id} />
                <label className="block text-xs font-medium text-gray-600">
                  Date
                  <input type="date" name="incurred_on" required defaultValue={r.incurred_on} className="mt-1 block rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                </label>
                <label className="block text-xs font-medium text-gray-600">
                  Bank charge ($)
                  <input type="number" name="bank_charge" step="0.01" min="0" defaultValue={nsfInputValue(r.bank_charge_cents)} className={`mt-1 block ${BOX}`} />
                </label>
                <label className="block text-xs font-medium text-gray-600">
                  Admin charge ($, $20 at most)
                  <input type="number" name="admin_charge" step="0.01" min="0" max="20" defaultValue={nsfInputValue(r.admin_charge_cents)} className={`mt-1 block ${BOX}`} />
                </label>
                <label className="block min-w-[12rem] flex-1 text-xs font-medium text-gray-600">
                  Note
                  <input type="text" name="note" maxLength={200} defaultValue={r.note ?? ""} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                </label>
                <SubmitButton pendingLabel="Saving…" className={SMALL_BTN}>
                  Save
                </SubmitButton>
              </form>
              <div className="flex flex-wrap items-center gap-2">
                <form action={setNsfChargePaid}>
                  <input type="hidden" name="tenancy_id" value={tenancyId} />
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="paid" value={r.paid_at ? "no" : "yes"} />
                  <SubmitButton pendingLabel="Saving…" className={SMALL_BTN}>
                    {r.paid_at ? "Mark as not paid" : "Mark as paid"}
                  </SubmitButton>
                </form>
                <form action={removeNsfCharge}>
                  <input type="hidden" name="tenancy_id" value={tenancyId} />
                  <input type="hidden" name="id" value={r.id} />
                  <SubmitButton pendingLabel="Removing…" className={`${SMALL_BTN} text-red-700`}>
                    Remove
                  </SubmitButton>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}

      <details className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-3">
        <summary className="cursor-pointer text-sm font-medium text-gray-700">Add an NSF charge</summary>
        <form action={addNsfCharge} className="mt-3 flex flex-wrap items-end gap-3">
          <input type="hidden" name="tenancy_id" value={tenancyId} />
          <label className="block text-xs font-medium text-gray-600">
            Date the payment failed
            <input type="date" name="incurred_on" required defaultValue={todayIso} className="mt-1 block rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </label>
          <label className="block text-xs font-medium text-gray-600">
            Bank charge ($)
            <input type="number" name="bank_charge" step="0.01" min="0" placeholder="0.00" className={`mt-1 block ${BOX}`} />
          </label>
          <label className="block text-xs font-medium text-gray-600">
            Admin charge ($, $20 at most)
            <input type="number" name="admin_charge" step="0.01" min="0" max="20" placeholder="0.00" className={`mt-1 block ${BOX}`} />
          </label>
          <label className="block min-w-[12rem] flex-1 text-xs font-medium text-gray-600">
            Note
            <input type="text" name="note" maxLength={200} placeholder="Bounced cheque for December" className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </label>
          <SubmitButton pendingLabel="Adding…" className={SMALL_BTN}>
            Add
          </SubmitButton>
        </form>
      </details>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <p className="font-semibold">Before you charge your tenant</p>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          {NSF_GUIDANCE.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="mt-2">
          <a href={NSF_RULE_URL} target="_blank" rel="noopener noreferrer" className="font-medium underline">
            Read Ontario&apos;s rule (O. Reg. 516/06, section 17)
          </a>
        </p>
      </div>
    </div>
  );
}
