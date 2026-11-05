import { prepareN13, recordN13Service, voidN13 } from "../n13-actions";
import { earliestN13TerminationDate, N13_PROBLEM_TEXT, type N13Problem } from "@/lib/n13";
import { formatMoneyCents } from "@/lib/payments";
import { formatLongDate } from "@/lib/n1-render";

// S751: "Prepare N13" on the tenancy page (demolish, repair or convert). The
// landlord describes the work and the permits; Vacantless checks the dates and
// works out the compensation, freezes the answers, and fills the official
// 2026/09 form for them to sign and serve.

export type N13NoticeView = {
  id: string;
  status: string;
  termination_date: string | null;
  total_owing_cents: number | null;
  compensation_required: boolean;
  reason: number;
  created_at: string;
};

const INPUT_CLS =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand";
const LABEL_CLS = "block text-xs font-medium text-gray-600 mb-1";
const BTN_PRIMARY = "inline-flex items-center rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:opacity-90";
const BTN_SECONDARY =
  "inline-flex items-center rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50";

const STATUS_LABEL: Record<string, string> = { draft: "Draft", served: "Served", filed: "Filed", void: "Void" };
const REASON_LABEL: Record<number, string> = { 1: "demolish", 2: "repairs", 3: "convert" };

const MSG: Record<string, { ok: boolean; text: string }> = {
  prepared: { ok: true, text: "N13 prepared. Download it, sign it, serve it, then record that you served it." },
  served: { ok: true, text: "Service recorded." },
  voided: { ok: true, text: "Notice voided." },
  notready: { ok: false, text: "An N13 needs an active tenancy." },
  notdraft: { ok: false, text: "That notice was already served." },
  badmethod: { ok: false, text: "Pick how you will serve the notice." },
  forbidden: { ok: false, text: "You don't have permission to prepare notices." },
  error: { ok: false, text: "Something went wrong. Please try again." },
};

export function TenancyN13Section({
  tenancyId,
  active,
  rentCents,
  endDate,
  landlordName,
  notices,
  today,
  msg,
}: {
  tenancyId: string;
  active: boolean;
  rentCents: number | null;
  endDate: string | null;
  landlordName: string;
  notices: N13NoticeView[];
  today: string;
  msg?: string;
}) {
  const fixedTermEndISO = endDate && endDate >= today ? endDate : null;
  const earliest = earliestN13TerminationDate({ serviceDateISO: today, method: "hand", dueDay: 1, fixedTermEndISO });
  const banner = msg
    ? MSG[msg] ?? (N13_PROBLEM_TEXT[msg as N13Problem] ? { ok: false, text: N13_PROBLEM_TEXT[msg as N13Problem] } : null)
    : null;
  const open = notices.filter((n) => n.status !== "void");

  return (
    <div className="space-y-4 border-t border-gray-200 pt-5">
      <h4 className="text-sm font-semibold text-gray-900">Form N13: demolish, renovate or convert the unit</h4>
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
        Vacantless fills the official 2026 N13, checks the dates and works out the compensation. You sign it and{" "}
        <strong>serve it yourself</strong>. For repairs or renovations, the work must need a building permit and an
        empty unit, and the tenant can move back in after.
      </p>

      {!active ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-600">
          An N13 is available for an active tenancy.
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 p-4">
          <div className="mb-3 grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500">Earliest end date</div>
              <div className="font-medium text-gray-900">{formatLongDate(earliest)}</div>
              <div className="text-xs text-gray-500">120 days, served by hand today, rent due on the 1st</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500">Compensation by the end date</div>
              <div className="font-medium text-gray-900">
                {rentCents != null
                  ? `${formatMoneyCents(rentCents)} (fewer than 5 units) or ${formatMoneyCents(rentCents * 3)} (5 or more)`
                  : "1 month's rent, or 3 months in a building with 5 or more units"}
              </div>
              <div className="text-xs text-gray-500">or another unit the tenant accepts</div>
            </div>
          </div>
          {fixedTermEndISO && (
            <p className="mb-3 text-xs text-amber-700">
              The lease is in a fixed term until {formatLongDate(fixedTermEndISO)}. The end date can&apos;t be before that.
            </p>
          )}

          <form action={prepareN13} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input type="hidden" name="tenancy_id" value={tenancyId} />
            <div className="sm:col-span-2">
              <span className={LABEL_CLS}>Reason</span>
              <label className="mr-4 block text-sm sm:inline">
                <input type="radio" name="reason" value="1" defaultChecked /> Reason 1: demolish the unit or building
              </label>
              <label className="mr-4 block text-sm sm:inline">
                <input type="radio" name="reason" value="2" /> Reason 2: repairs that need a permit and an empty unit
              </label>
              <label className="block text-sm sm:inline">
                <input type="radio" name="reason" value="3" /> Reason 3: convert to a non-residential use
              </label>
            </div>
            <div>
              <label className={LABEL_CLS}>Work planned (short)</label>
              <textarea name="work_planned" rows={3} className={INPUT_CLS} required placeholder="e.g. Replace all plumbing and electrical in the unit" />
            </div>
            <div>
              <label className={LABEL_CLS}>Details: what, when and how</label>
              <textarea name="work_details" rows={5} className={INPUT_CLS} required placeholder="e.g. Contractor, start and end dates, why the unit must be empty" />
              <p className="mt-1 text-xs text-gray-500">The box on the form holds about 20 lines. Attach a page for more.</p>
            </div>
            <div className="sm:col-span-2">
              <label className={LABEL_CLS}>Permits</label>
              <select name="permits" defaultValue="will_obtain" className={INPUT_CLS}>
                <option value="obtained">I have the building permits or other authorization</option>
                <option value="will_obtain">I will get the building permits or other authorization</option>
                <option value="none_needed">No permits are needed (demolish or convert only)</option>
              </select>
            </div>
            <div>
              <label className={LABEL_CLS}>Residential units in the building</label>
              <input name="units" type="number" min={1} defaultValue={1} className={INPUT_CLS} />
              <p className="mt-1 text-xs text-gray-500">5 or more: 3 months&apos; rent. Fewer: 1 month.</p>
            </div>
            <div>
              <label className={LABEL_CLS}>Was the work ordered under a law (a work or demolition order)?</label>
              <select name="ordered" defaultValue="no" className={INPUT_CLS}>
                <option value="no">No</option>
                <option value="yes">Yes, so no compensation is owed</option>
              </select>
            </div>
            <div>
              <label className={LABEL_CLS}>Landlord&apos;s name on the notice</label>
              <input name="landlord_name" defaultValue={landlordName} className={INPUT_CLS} required />
            </div>
            <div>
              <label className={LABEL_CLS}>Does the tenant own a mobile home on the site?</label>
              <select name="mobile_home" defaultValue="no" className={INPUT_CLS}>
                <option value="no">No</option>
                <option value="yes">Yes (1 year notice)</option>
              </select>
            </div>
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
              <label className={LABEL_CLS}>Day of the month rent is due</label>
              <input name="due_day" type="number" min={1} max={31} defaultValue={1} className={INPUT_CLS} />
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
                Prepare N13
              </button>
            </div>
          </form>
        </div>
      )}

      {open.length > 0 && (
        <div className="space-y-2">
          {open.map((n) => (
            <div key={n.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 p-3 text-sm">
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                {STATUS_LABEL[n.status] ?? n.status}
              </span>
              <span className="text-gray-900">
                {REASON_LABEL[n.reason] ?? ""}, ends {formatLongDate(n.termination_date) ?? ""}
              </span>
              <span className="text-xs text-gray-500">
                {!n.compensation_required
                  ? "no compensation owed (ordered under a law)"
                  : n.total_owing_cents != null
                    ? `compensation ${formatMoneyCents(n.total_owing_cents)} due by the end date${n.reason === 2 ? " (less if the tenant moves back and the work is shorter)" : ""}`
                    : "compensation due by the end date"}
              </span>
              <a
                href={`/dashboard/tenancies/${tenancyId}/n13/official?notice=${n.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className={BTN_SECONDARY}
              >
                Download official N13 (PDF)
              </a>
              {n.status === "draft" && (
                <form action={recordN13Service}>
                  <input type="hidden" name="tenancy_id" value={tenancyId} />
                  <input type="hidden" name="notice_id" value={n.id} />
                  <button type="submit" className={BTN_SECONDARY}>
                    Record service
                  </button>
                </form>
              )}
              <form action={voidN13} className="ml-auto">
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
