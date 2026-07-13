import { prepareN4, recordN4Service, fileN4ToVault, voidN4 } from "../n4-actions";
import { buildN4Snapshot, n4SnapshotBlocker } from "@/lib/n4-snapshot";
import { N4_TEMPLATE_VERSION } from "@/lib/n4-official-pdf";
import { formatMoneyCents, type PaymentRow } from "@/lib/payments";
import { formatLongDate } from "@/lib/n1-render";

// Operator "Prepare N4" surface — Slice C of the N-form library
// (N-FORM-LIBRARY-DESIGN-2026-07-12.md). PREPARE-FIRST: the operator reviews the
// derived arrears + termination date, prepares an immutable notice, downloads the
// official Board-approved Form N4, serves the tenant THEMSELVES, then records the
// service and (optionally) files the served copy to the vault. No serve-on-behalf.
// Server component: every form posts to a server action (../n4-actions); the
// preview is derived here from the same pure libs the action freezes into the
// snapshot, so what the operator sees is what gets prepared.

export type N4NoticeView = {
  id: string;
  status: string;
  service_token: string;
  total_owing_cents: number | null;
  termination_date: string | null;
  created_at: string;
  filed_document_id: string | null;
};

const INPUT_CLS =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand";
const LABEL_CLS = "block text-xs font-medium text-gray-600 mb-1";
const BTN_PRIMARY =
  "inline-flex items-center rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:opacity-90";
const BTN_SECONDARY =
  "inline-flex items-center rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50";

const STATUS_META: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-gray-100 text-gray-700" },
  served: { label: "Served", cls: "bg-amber-100 text-amber-800" },
  filed: { label: "Filed", cls: "bg-green-100 text-green-800" },
  void: { label: "Void", cls: "bg-red-100 text-red-700" },
};

const MSG_META: Record<string, { cls: string; text: string }> = {
  prepared: { cls: "bg-green-50 text-green-800 border-green-200", text: "N4 prepared. Download the official form to serve it, then record how you served it." },
  served: { cls: "bg-green-50 text-green-800 border-green-200", text: "Service recorded — the tenant can now view the notice." },
  filed: { cls: "bg-green-50 text-green-800 border-green-200", text: "Filed the served N4 to the document vault." },
  voided: { cls: "bg-gray-50 text-gray-700 border-gray-200", text: "Notice voided." },
  no_arrears: { cls: "bg-amber-50 text-amber-800 border-amber-200", text: "Nothing to serve — the rent ledger shows no arrears owing." },
  unresolved_credits: { cls: "bg-amber-50 text-amber-800 border-amber-200", text: "Some payments aren't assigned to a rental period. Assign them under Rent first, so the N4 can't overstate arrears." },
  not_reconciling: { cls: "bg-amber-50 text-amber-800 border-amber-200", text: "The arrears table doesn't reconcile. Review the rent ledger before preparing an N4." },
  notready: { cls: "bg-amber-50 text-amber-800 border-amber-200", text: "An N4 needs an active tenancy with a rent and start date." },
  notdraft: { cls: "bg-amber-50 text-amber-800 border-amber-200", text: "That notice was already served." },
  notserved: { cls: "bg-amber-50 text-amber-800 border-amber-200", text: "Record service before filing the notice to the vault." },
  badmethod: { cls: "bg-amber-50 text-amber-800 border-amber-200", text: "Pick how the notice was served." },
  forbidden: { cls: "bg-red-50 text-red-700 border-red-200", text: "You don't have permission to prepare notices." },
  error: { cls: "bg-red-50 text-red-700 border-red-200", text: "Something went wrong. Please try again." },
  failed: { cls: "bg-red-50 text-red-700 border-red-200", text: "Could not file the notice to the vault." },
};

export function TenancyN4Section({
  tenancyId,
  active,
  rentCents,
  startDate,
  address,
  tenantNames,
  landlordName,
  landlordPhone,
  payments,
  notices,
  appUrl,
  today,
  msg,
}: {
  tenancyId: string;
  active: boolean;
  rentCents: number | null;
  startDate: string | null;
  address: string | null;
  tenantNames: string[];
  landlordName: string;
  landlordPhone: string | null;
  payments: PaymentRow[];
  notices: N4NoticeView[];
  appUrl: string;
  today: string;
  msg?: string;
}) {
  const canPrepare = active && rentCents != null && !!startDate;

  // Live preview from the SAME pure libs the action freezes — no override.
  let preview: {
    computedOwingCents: number;
    conservativeOwingCents: number;
    terminationDateISO: string;
    rows: { fromISO: string; toISO: string; chargedCents: number; paidCents: number; owingCents: number }[];
    blocker: ReturnType<typeof n4SnapshotBlocker>;
    hadUnresolvedCredits: boolean;
    unassignedPaidCents: number;
    outOfWindowPaidCents: number;
  } | null = null;

  if (canPrepare) {
    const snap = buildN4Snapshot({
      landlordName,
      landlordPhone,
      rentalUnitAddress: address,
      tenantNames,
      rentCents: rentCents as number,
      startDateISO: startDate as string,
      noticeDateISO: today,
      payments,
      formVersion: N4_TEMPLATE_VERSION,
      capturedAtIso: new Date().toISOString(),
    });
    preview = {
      computedOwingCents: snap.computedOwingCents,
      conservativeOwingCents: snap.conservativeOwingCents,
      terminationDateISO: snap.terminationDateISO,
      rows: snap.arrearsRows,
      blocker: n4SnapshotBlocker(snap),
      hadUnresolvedCredits: snap.hadUnresolvedCredits,
      unassignedPaidCents: snap.unassignedPaidCents,
      outOfWindowPaidCents: snap.outOfWindowPaidCents,
    };
  }

  const banner = msg ? MSG_META[msg] : null;
  const openNotices = notices.filter((n) => n.status !== "void");
  const voidNotices = notices.filter((n) => n.status === "void");

  return (
    <div className="space-y-5">
      {banner && (
        <div className={`rounded-lg border px-3 py-2 text-sm ${banner.cls}`}>{banner.text}</div>
      )}

      <p className="text-sm text-gray-600">
        Prepare an Ontario <strong>Form N4</strong> (Notice to End a Tenancy Early for Non-payment
        of Rent) from this tenancy's rent ledger. Vacantless fills the official Board-approved form
        for you to review and <strong>serve yourself</strong> — it does not serve the tenant on your
        behalf. An N4 that overstates arrears or gives too little notice is void, so review every
        figure.
      </p>

      {/* Arrears preview + prepare form */}
      {!canPrepare ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-600">
          An N4 is available once the tenancy is active with a rent and start date set.
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 p-4">
          <div className="mb-3 flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500">Total owing (default)</div>
              <div className="text-2xl font-bold text-gray-900">
                {formatMoneyCents(preview?.conservativeOwingCents ?? 0)}
              </div>
            </div>
            {preview && preview.computedOwingCents !== preview.conservativeOwingCents && (
              <div className="text-xs text-gray-500">
                Itemized (upper bound): {formatMoneyCents(preview.computedOwingCents)}
              </div>
            )}
            {preview && (
              <div>
                <div className="text-xs uppercase tracking-wide text-gray-500">Pay-by / termination</div>
                <div className="text-sm font-medium text-gray-900">
                  {formatLongDate(preview.terminationDateISO) ?? "—"}{" "}
                  <span className="text-gray-400">(as of a notice served today)</span>
                </div>
              </div>
            )}
          </div>

          {preview && preview.rows.length > 0 && (
            <table className="mb-3 w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="border-b border-gray-200 py-1 pr-2">Rental period</th>
                  <th className="border-b border-gray-200 py-1 pr-2 text-right">Charged</th>
                  <th className="border-b border-gray-200 py-1 pr-2 text-right">Paid</th>
                  <th className="border-b border-gray-200 py-1 text-right">Owing</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r, i) => (
                  <tr key={i} className="text-gray-800">
                    <td className="border-b border-gray-100 py-1 pr-2">
                      {formatLongDate(r.fromISO)} – {formatLongDate(r.toISO)}
                    </td>
                    <td className="border-b border-gray-100 py-1 pr-2 text-right tabular-nums">{formatMoneyCents(r.chargedCents)}</td>
                    <td className="border-b border-gray-100 py-1 pr-2 text-right tabular-nums">{formatMoneyCents(r.paidCents)}</td>
                    <td className="border-b border-gray-100 py-1 text-right tabular-nums">{formatMoneyCents(r.owingCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {preview?.blocker === "unresolved_credits" && (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {formatMoneyCents(preview.unassignedPaidCents + preview.outOfWindowPaidCents)} of payments
              aren't assigned to a rental period in the window. Assign them under{" "}
              <a href="#rent" className="font-medium underline">Rent</a> so the N4 can't overstate arrears — then re-check here.
            </div>
          )}
          {preview?.blocker === "no_arrears" && (
            <div className="mb-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
              The ledger shows no arrears owing right now, so there is nothing to serve.
            </div>
          )}

          <form action={prepareN4} className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <input type="hidden" name="tenancy_id" value={tenancyId} />
            <div>
              <label className={LABEL_CLS}>Notice (service) date</label>
              <input type="date" name="notice_date" defaultValue={today} className={INPUT_CLS} />
            </div>
            <div>
              <label className={LABEL_CLS}>Override total owing (optional)</label>
              <input
                name="override_owing"
                inputMode="decimal"
                placeholder="e.g. 2400.00"
                className={INPUT_CLS}
              />
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                className={BTN_PRIMARY}
                disabled={preview?.blocker === "unresolved_credits" || preview?.blocker === "no_arrears"}
              >
                Prepare N4
              </button>
            </div>
          </form>
          <p className="mt-2 text-xs text-gray-400">
            The default uses the tenant-protective figure. An override is your legal responsibility.
            Preparing freezes an immutable copy of these figures.
          </p>
        </div>
      )}

      {/* Prepared / served notices */}
      {openNotices.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-gray-900">Prepared notices</h4>
          {openNotices.map((n) => {
            const meta = STATUS_META[n.status] ?? STATUS_META.draft;
            const served = n.status === "served" || n.status === "filed";
            const pdfUrl = `/dashboard/tenancies/${tenancyId}/n4/official?notice=${n.id}`;
            const tenantUrl = `${appUrl}/notice/${n.service_token}`;
            return (
              <div key={n.id} className="rounded-lg border border-gray-200 p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${meta.cls}`}>{meta.label}</span>
                  <span className="text-sm font-medium text-gray-900">{formatMoneyCents(n.total_owing_cents)}</span>
                  <span className="text-xs text-gray-500">
                    pay-by {formatLongDate(n.termination_date) ?? "—"}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <a href={pdfUrl} target="_blank" rel="noopener noreferrer" className={BTN_SECONDARY}>
                    Download official N4 (PDF)
                  </a>

                  {n.status === "draft" && (
                    <form action={recordN4Service} className="flex items-center gap-2">
                      <input type="hidden" name="tenancy_id" value={tenancyId} />
                      <input type="hidden" name="notice_id" value={n.id} />
                      <select name="method" className="rounded-lg border border-gray-300 px-2 py-2 text-sm" defaultValue="hand">
                        <option value="hand">Served by hand</option>
                        <option value="mail">Served by mail</option>
                        <option value="courier">Served by courier</option>
                      </select>
                      <button type="submit" className={BTN_PRIMARY}>Record service</button>
                    </form>
                  )}

                  {served && (
                    <a href={tenantUrl} target="_blank" rel="noopener noreferrer" className={BTN_SECONDARY}>
                      View tenant page
                    </a>
                  )}

                  {n.status === "served" && !n.filed_document_id && (
                    <form action={fileN4ToVault}>
                      <input type="hidden" name="tenancy_id" value={tenancyId} />
                      <input type="hidden" name="notice_id" value={n.id} />
                      <button type="submit" className={BTN_SECONDARY}>File to vault</button>
                    </form>
                  )}
                  {n.filed_document_id && (
                    <span className="text-xs text-green-700">Filed to vault ✓</span>
                  )}

                  <form action={voidN4} className="ml-auto">
                    <input type="hidden" name="tenancy_id" value={tenancyId} />
                    <input type="hidden" name="notice_id" value={n.id} />
                    <button type="submit" className="text-xs text-gray-400 hover:text-red-600">Void</button>
                  </form>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {voidNotices.length > 0 && (
        <p className="text-xs text-gray-400">{voidNotices.length} voided notice{voidNotices.length > 1 ? "s" : ""} hidden.</p>
      )}
    </div>
  );
}
