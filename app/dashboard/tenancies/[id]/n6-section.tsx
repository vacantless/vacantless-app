import { prepareN6, recordN6Service, voidN6 } from "../n6-actions";
import { earliestN6TerminationDate, N6_PROBLEM_TEXT, type N6Problem } from "@/lib/n6";
import { formatLongDate } from "@/lib/n1-render";

// S751: "Prepare N6" on the tenancy page: illegal acts, or misrepresenting income in
// rent-geared-to-income housing.

export type N6NoticeView = { id: string; status: string; termination_date: string | null; created_at: string };

const INPUT_CLS =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand";
const LABEL_CLS = "block text-xs font-medium text-gray-600 mb-1";
const BTN_PRIMARY = "inline-flex items-center rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:opacity-90";
const BTN_SECONDARY =
  "inline-flex items-center rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50";

const MSG: Record<string, { ok: boolean; text: string }> = {
  prepared: { ok: true, text: "N6 prepared. Download it, sign it, serve it, then record that you served it." },
  served: { ok: true, text: "Service recorded." },
  voided: { ok: true, text: "Notice voided." },
  notready: { ok: false, text: "An N6 needs an active tenancy." },
  notdraft: { ok: false, text: "That notice was already served." },
  forbidden: { ok: false, text: "You don't have permission to prepare notices." },
  error: { ok: false, text: "Something went wrong. Please try again." },
};

export function TenancyN6Section({
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
  notices: N6NoticeView[];
  today: string;
  msg?: string;
}) {
  const banner = msg
    ? MSG[msg] ?? (msg in N6_PROBLEM_TEXT ? { ok: false, text: N6_PROBLEM_TEXT[msg as N6Problem] } : null)
    : null;
  const open = notices.filter((n) => n.status !== "void");

  return (
    <div className="space-y-4 border-t border-gray-200 pt-5">
      <h4 className="text-sm font-semibold text-gray-900">Form N6: illegal act, or false income in rent-geared-to-income housing</h4>
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
        An N6 can&apos;t be voided by the tenant. For drugs only (production or trafficking), the end date is at least 10
        days away; for any other illegal act, or false income in rent-geared-to-income housing, at least 20 days (14 for a
        second notice after an N5). Earliest end date served by hand today:{" "}
        {formatLongDate(earliestN6TerminationDate(today, "hand", { drugs: true, illegal: false, income: false }, "first"))}{" "}
        (drugs only) or{" "}
        {formatLongDate(earliestN6TerminationDate(today, "hand", { drugs: false, illegal: true, income: false }, "first"))}.
        You sign it and <strong>serve it yourself</strong>, then apply with an L2 within 30 days after the end date. To
        collect extra rent owed without ending the tenancy, use the L9 instead.
      </p>

      {!active ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-600">
          An N6 is available for an active tenancy.
        </div>
      ) : (
        <form action={prepareN6} className="grid grid-cols-1 gap-3 rounded-xl border border-gray-200 p-4 sm:grid-cols-2">
          <input type="hidden" name="tenancy_id" value={tenancyId} />
          <div className="sm:col-span-2 space-y-1 text-sm">
            <span className={LABEL_CLS}>Reason (pick all that apply)</span>
            <label className="block">
              <input type="checkbox" name="reason_drugs" value="yes" /> Reason 1: drug production, trafficking or possession for trafficking
            </label>
            <label className="block">
              <input type="checkbox" name="reason_illegal" value="yes" /> Reason 2: another illegal act or business
            </label>
            <label className="block">
              <input type="checkbox" name="reason_income" value="yes" /> Reason 3: false income in rent-geared-to-income housing
            </label>
          </div>
          <div>
            <label className={LABEL_CLS}>First or second notice in 6 months?</label>
            <select name="which" defaultValue="first" className={INPUT_CLS}>
              <option value="first">First (20 days, or 10 for drugs only)</option>
              <option value="second">Second, after an N5 that gave 7 days to fix (14 days)</option>
            </select>
            <label className="mt-1 block text-xs text-gray-600">
              <input type="checkbox" name="first_confirmed" value="yes" /> I served that N5 in the past 6 months outside
              Vacantless
            </label>
          </div>
          <div>
            <label className={LABEL_CLS}>Landlord&apos;s name on the notice</label>
            <input name="landlord_name" defaultValue={landlordName} className={INPUT_CLS} required />
          </div>
          {[1, 2, 3].map((n) => (
            <div key={n} className="grid grid-cols-1 gap-2 sm:col-span-2 sm:grid-cols-4">
              <div>
                <label className={LABEL_CLS}>Event {n}: date and time</label>
                <input name={`event_when_${n}`} placeholder="e.g. 02/11/2026, 11:30 pm" className={INPUT_CLS} />
              </div>
              <div className="sm:col-span-3">
                <label className={LABEL_CLS}>What happened (who, what, who was affected)</label>
                <textarea name={`event_details_${n}`} rows={3} maxLength={900} className={INPUT_CLS} />
              </div>
            </div>
          ))}
          <p className="text-xs text-gray-500 sm:col-span-2">
            Be specific: dates, times, what happened, who was involved. For false income, give the amount not reported and
            how you worked it out. More than 3 events: put the rest on a separate page you give the tenant with the notice.
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
              Prepare N6
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
                href={`/dashboard/tenancies/${tenancyId}/n6/official?notice=${n.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className={BTN_SECONDARY}
              >
                Download official N6 (PDF)
              </a>
              {n.status === "draft" && (
                <form action={recordN6Service}>
                  <input type="hidden" name="tenancy_id" value={tenancyId} />
                  <input type="hidden" name="notice_id" value={n.id} />
                  <button type="submit" className={BTN_SECONDARY}>
                    Record service
                  </button>
                </form>
              )}
              <form action={voidN6} className="ml-auto">
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
