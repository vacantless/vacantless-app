import { prepareN5, recordN5Service, voidN5 } from "../n5-actions";
import { earliestN5TerminationDate, N5_PROBLEM_TEXT, type N5Problem } from "@/lib/n5";
import { formatLongDate } from "@/lib/n1-render";

// S748g: "Prepare N5" on the tenancy page: interference, damage or overcrowding.

export type N5NoticeView = { id: string; status: string; termination_date: string | null; created_at: string };

const INPUT_CLS =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand";
const LABEL_CLS = "block text-xs font-medium text-gray-600 mb-1";
const BTN_PRIMARY = "inline-flex items-center rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:opacity-90";
const BTN_SECONDARY =
  "inline-flex items-center rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50";

const MSG: Record<string, { ok: boolean; text: string }> = {
  prepared: { ok: true, text: "N5 prepared. Download it, sign it, serve it, then record that you served it." },
  served: { ok: true, text: "Service recorded." },
  voided: { ok: true, text: "Notice voided." },
  notready: { ok: false, text: "An N5 needs an active tenancy." },
  notdraft: { ok: false, text: "That notice was already served." },
  forbidden: { ok: false, text: "You don't have permission to prepare notices." },
  error: { ok: false, text: "Something went wrong. Please try again." },
};

export function TenancyN5Section({
  tenancyId,
  active,
  landlordName,
  notices,
  today,
  msg,
}: {
  tenancyId: string;
  active: boolean;
  landlordName: string;
  notices: N5NoticeView[];
  today: string;
  msg?: string;
}) {
  const banner = msg
    ? MSG[msg] ?? (msg in N5_PROBLEM_TEXT ? { ok: false, text: N5_PROBLEM_TEXT[msg as N5Problem] } : null)
    : null;
  const open = notices.filter((n) => n.status !== "void");

  return (
    <div className="space-y-4 border-t border-gray-200 pt-5">
      <h4 className="text-sm font-semibold text-gray-900">Form N5: interference, damage or overcrowding</h4>
      {banner && (
        <div
          className={`rounded-lg border px-3 py-2 text-sm ${
            banner.ok ? "border-green-200 bg-green-50 text-green-800" : "border-amber-200 bg-amber-50 text-amber-800"
          }`}
        >
          {banner.text}
        </div>
      )}
      <p className="text-sm text-gray-600">
        A first N5 gives the tenant 7 days to fix the problem (stop the behaviour, repair or pay for the damage, or
        reduce the people living there). If they fix it, the notice is void. A second N5 within 6 months can&apos;t be
        voided. Earliest end date served by hand today: first {formatLongDate(earliestN5TerminationDate(today, "hand", "first"))},
        second {formatLongDate(earliestN5TerminationDate(today, "hand", "second"))}. You sign it and{" "}
        <strong>serve it yourself</strong>, then apply with an L2 within 30 days after the end date.
      </p>

      {!active ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-600">
          An N5 is available for an active tenancy.
        </div>
      ) : (
        <form action={prepareN5} className="grid grid-cols-1 gap-3 rounded-xl border border-gray-200 p-4 sm:grid-cols-2">
          <input type="hidden" name="tenancy_id" value={tenancyId} />
          <div className="sm:col-span-2 space-y-1 text-sm">
            <span className={LABEL_CLS}>Reason (pick all that apply)</span>
            <label className="block">
              <input type="checkbox" name="reason_interference" value="yes" /> Interfering with other tenants or with you
            </label>
            <label className="block">
              <input type="checkbox" name="reason_damage" value="yes" /> Damage to the unit or building
            </label>
            <label className="block">
              <input type="checkbox" name="reason_overcrowding" value="yes" /> More people living there than allowed
            </label>
          </div>
          <div>
            <label className={LABEL_CLS}>First or second N5 in 6 months?</label>
            <select name="which" defaultValue="first" className={INPUT_CLS}>
              <option value="first">First (tenant gets 7 days to fix it)</option>
              <option value="second">Second (can&apos;t be voided)</option>
            </select>
            <label className="mt-1 block text-xs text-gray-600">
              <input type="checkbox" name="first_confirmed" value="yes" /> For a second N5: I served a first N5 in the past
              6 months outside Vacantless
            </label>
          </div>
          <div>
            <label className={LABEL_CLS}>Landlord&apos;s name on the notice</label>
            <input name="landlord_name" defaultValue={landlordName} className={INPUT_CLS} required />
          </div>
          <div>
            <label className={LABEL_CLS}>Damage: repair estimate (optional)</label>
            <input name="repair_cost" inputMode="decimal" placeholder="e.g. 450.00" className={INPUT_CLS} />
          </div>
          <div>
            <label className={LABEL_CLS}>Damage: replacement estimate (optional)</label>
            <input name="replace_cost" inputMode="decimal" className={INPUT_CLS} />
          </div>
          <div>
            <label className={LABEL_CLS}>Overcrowding: most people allowed</label>
            <input name="max_people" className={INPUT_CLS} />
          </div>
          <div />
          {[1, 2, 3].map((n) => (
            <div key={n} className="grid grid-cols-1 gap-2 sm:col-span-2 sm:grid-cols-4">
              <div>
                <label className={LABEL_CLS}>Event {n}: date and time</label>
                <input name={`event_when_${n}`} placeholder="e.g. 02/11/2026, 11:30 pm" className={INPUT_CLS} />
              </div>
              <div className="sm:col-span-3">
                <label className={LABEL_CLS}>What happened (who, what, who was affected)</label>
                <textarea name={`event_details_${n}`} rows={2} maxLength={600} className={INPUT_CLS} />
              </div>
            </div>
          ))}
          <p className="text-xs text-gray-500 sm:col-span-2">
            Be specific. For overcrowding, name the by-law or law that sets the limit. More than 3 events: put the rest on
            a separate page you give the tenant with the notice.
          </p>
          <div>
            <label className={LABEL_CLS}>Date you will serve it</label>
            <input type="date" name="service_date" defaultValue={today} className={INPUT_CLS} />
          </div>
          <div>
            <label className={LABEL_CLS}>How you will serve it</label>
            <select name="method" defaultValue="hand" className={INPUT_CLS}>
              <option value="hand">By hand, mailbox or under the door</option>
              <option value="mail">Mail or Xpresspost (adds 5 days)</option>
              <option value="courier">Courier (adds 1 business day)</option>
            </select>
          </div>
          <div>
            <label className={LABEL_CLS}>End date (leave blank for the earliest)</label>
            <input type="date" name="termination_date" className={INPUT_CLS} />
          </div>
          <div>
            <label className={LABEL_CLS}>Your first name (signature block)</label>
            <input name="signer_first" className={INPUT_CLS} />
          </div>
          <div>
            <label className={LABEL_CLS}>Your last name</label>
            <input name="signer_last" className={INPUT_CLS} />
          </div>
          <div>
            <label className={LABEL_CLS}>Your phone</label>
            <input name="signer_phone" className={INPUT_CLS} />
          </div>
          <div className="flex items-end">
            <button type="submit" className={BTN_PRIMARY}>
              Prepare N5
            </button>
          </div>
        </form>
      )}

      {open.length > 0 && (
        <div className="space-y-2">
          {open.map((n) => (
            <div key={n.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 p-3 text-sm">
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium capitalize text-gray-700">{n.status}</span>
              <span className="text-gray-900">ends {formatLongDate(n.termination_date) ?? ""}</span>
              <a
                href={`/dashboard/tenancies/${tenancyId}/n5/official?notice=${n.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className={BTN_SECONDARY}
              >
                Download official N5 (PDF)
              </a>
              {n.status === "draft" && (
                <form action={recordN5Service}>
                  <input type="hidden" name="tenancy_id" value={tenancyId} />
                  <input type="hidden" name="notice_id" value={n.id} />
                  <button type="submit" className={BTN_SECONDARY}>
                    Record service
                  </button>
                </form>
              )}
              <form action={voidN5} className="ml-auto">
                <input type="hidden" name="tenancy_id" value={tenancyId} />
                <input type="hidden" name="notice_id" value={n.id} />
                <button type="submit" className="text-xs text-gray-400 hover:text-red-600">
                  Void
                </button>
              </form>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
