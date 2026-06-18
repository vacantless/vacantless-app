import { SectionHeading, StatusChip } from "@/components/ui";
import { CopyLinkButton } from "@/components/copy-link-button";
import {
  diffSnapshots,
  tokensInBody,
  type ExecutedClauseRef,
} from "@/lib/clauses";
import {
  generateLease,
  deleteLeaseDocument,
  sendLeaseForSignature,
  withdrawLeaseSignature,
} from "@/app/dashboard/tenancies/[id]/lease-actions";

// Lease documents section on the tenancy detail page (lease vault #11, slices
// 2-4). Server component: a generate form, the list of generated drafts, the
// renewal diff (the differentiator), and — slice 4 — the homegrown ECA-2000
// signing rail: send a draft for signature, per-signer status + magic-links,
// withdraw-while-unsigned, and the certificate of completion once executed.

export type LeaseSignerView = {
  role: string;
  name: string | null;
  status: string;
  token: string;
};

export type LeaseDocView = {
  id: string;
  title: string;
  status: string;
  assembled_body: string | null;
  executed_clause_versions: ExecutedClauseRef[];
  created_at: string;
  signers: LeaseSignerView[];
};

const labelCls = "mb-1 block text-xs font-medium text-gray-600";
const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";

const STATUS_TONE: Record<string, "neutral" | "info" | "success" | "warn"> = {
  draft: "neutral",
  sent: "info",
  executed: "success",
  void: "warn",
};

export function TenancyLeaseSection({
  tenancyId,
  leaseDocs,
}: {
  tenancyId: string;
  leaseDocs: LeaseDocView[];
}) {
  // Renewal diff: newest [0] vs the one before it [1] (both newest-first).
  const diff =
    leaseDocs.length >= 2
      ? diffSnapshots(
          leaseDocs[1].executed_clause_versions,
          leaseDocs[0].executed_clause_versions,
        )
      : null;

  return (
    <>
      <SectionHeading>Lease document</SectionHeading>
      <div className="mb-8 space-y-5 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <p className="text-sm text-gray-600">
          Generate a lease from your{" "}
          <a
            href="/dashboard/settings?tab=clauses"
            className="font-medium text-brand hover:underline"
          >
            clause library
          </a>
          . Each lease records exactly which clause version was in force, so when
          you generate a renewal we can show what changed since the tenant last
          signed.
        </p>

        {/* Renewal diff (the differentiator) */}
        {diff && (
          <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Changes since the previous lease
              </span>
              {diff.identical && <StatusChip tone="success">No changes</StatusChip>}
            </div>
            {diff.identical ? (
              <p className="text-sm text-gray-600">
                The latest lease is identical to the previous one — same clauses,
                same versions.
              </p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {diff.changed.map((c) => (
                  <li key={`c-${c.key}`} className="flex items-center gap-2">
                    <StatusChip tone="warn">Changed</StatusChip>
                    <span className="text-gray-700">
                      {c.title}{" "}
                      <span className="text-xs text-gray-400">
                        v{c.from} → v{c.to}
                      </span>
                    </span>
                  </li>
                ))}
                {diff.added.map((c) => (
                  <li key={`a-${c.key}`} className="flex items-center gap-2">
                    <StatusChip tone="info">Added</StatusChip>
                    <span className="text-gray-700">{c.title}</span>
                  </li>
                ))}
                {diff.removed.map((c) => (
                  <li key={`r-${c.key}`} className="flex items-center gap-2">
                    <StatusChip tone="neutral">Removed</StatusChip>
                    <span className="text-gray-700">{c.title}</span>
                  </li>
                ))}
                {diff.unchanged.length > 0 && (
                  <li className="pt-1 text-xs text-gray-400">
                    {diff.unchanged.length} clause
                    {diff.unchanged.length === 1 ? "" : "s"} unchanged.
                  </li>
                )}
              </ul>
            )}
          </div>
        )}

        {/* Generated lease list */}
        {leaseDocs.length > 0 && (
          <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200">
            {leaseDocs.map((d, i) => {
              const owed = d.assembled_body ? tokensInBody(d.assembled_body) : [];
              const isDraft = d.status === "draft";
              const isSent = d.status === "sent";
              const isExecuted = d.status === "executed";
              const anySigned = d.signers.some((sg) => sg.status === "signed");
              const signedCount = d.signers.filter((sg) => sg.status === "signed").length;
              return (
                <li key={d.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="font-medium text-gray-900">{d.title}</span>
                      <StatusChip tone={STATUS_TONE[d.status] ?? "neutral"}>
                        {d.status}
                      </StatusChip>
                      {i === 0 && leaseDocs.length > 1 && (
                        <StatusChip tone="info">Latest</StatusChip>
                      )}
                      <span className="ml-1 block text-xs text-gray-400">
                        {d.executed_clause_versions.length} clause
                        {d.executed_clause_versions.length === 1 ? "" : "s"} ·{" "}
                        {new Date(d.created_at).toLocaleString()}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-wrap items-center gap-2">
                      <a
                        href={`/dashboard/tenancies/${tenancyId}/lease/${d.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      >
                        View / print
                      </a>
                      {isExecuted && (
                        <a
                          href={`/dashboard/tenancies/${tenancyId}/lease/${d.id}/certificate`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                        >
                          Certificate
                        </a>
                      )}
                      {isDraft && (
                        <form action={sendLeaseForSignature}>
                          <input type="hidden" name="tenancy_id" value={tenancyId} />
                          <input type="hidden" name="lease_id" value={d.id} />
                          <button
                            disabled={owed.length > 0}
                            title={
                              owed.length > 0
                                ? "Fill every value before sending for signature"
                                : undefined
                            }
                            className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                            style={{ background: "var(--brand-gradient, var(--brand-color))" }}
                          >
                            Send for signature
                          </button>
                        </form>
                      )}
                      {isSent && !anySigned && (
                        <form action={withdrawLeaseSignature}>
                          <input type="hidden" name="tenancy_id" value={tenancyId} />
                          <input type="hidden" name="lease_id" value={d.id} />
                          <button className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
                            Withdraw &amp; edit
                          </button>
                        </form>
                      )}
                      {isDraft && (
                        <form action={deleteLeaseDocument}>
                          <input type="hidden" name="tenancy_id" value={tenancyId} />
                          <input type="hidden" name="lease_id" value={d.id} />
                          <button className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50">
                            Delete
                          </button>
                        </form>
                      )}
                    </span>
                  </div>
                  {owed.length > 0 && (
                    <p className="mt-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
                      Values still to fill: {owed.map((t) => `{{${t}}}`).join(", ")}
                    </p>
                  )}

                  {/* Signing status (slice 4) — per-signer state + magic-links */}
                  {d.signers.length > 0 && (isSent || isExecuted) && (
                    <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50/60 p-3">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Signatures · {signedCount} of {d.signers.length} signed
                      </p>
                      <ul className="space-y-1.5">
                        {d.signers.map((sg) => (
                          <li
                            key={sg.token}
                            className="flex flex-wrap items-center justify-between gap-2 text-sm"
                          >
                            <span className="flex items-center gap-2">
                              <StatusChip tone={sg.status === "signed" ? "success" : "neutral"}>
                                {sg.status === "signed" ? "Signed" : "Pending"}
                              </StatusChip>
                              <span className="text-gray-700">
                                {sg.name || "(unnamed)"}{" "}
                                <span className="text-xs text-gray-400">
                                  · {sg.role}
                                </span>
                              </span>
                            </span>
                            {sg.status !== "signed" && isSent && (
                              <span className="flex items-center gap-2">
                                <a
                                  href={`/sign/${sg.token}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs font-medium text-brand hover:underline"
                                >
                                  Open
                                </a>
                                <CopyLinkButton path={`/sign/${sg.token}`} />
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {d.assembled_body && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs font-medium text-brand">
                        View assembled lease text
                      </summary>
                      <p className="mt-2 whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                        {d.assembled_body}
                      </p>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* Generate form */}
        <form action={generateLease} className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          <input type="hidden" name="tenancy_id" value={tenancyId} />
          <p className="text-sm font-medium text-gray-700">
            {leaseDocs.length > 0 ? "Generate a renewal / new draft" : "Generate the lease"}
          </p>
          <p className="text-xs text-gray-500">
            Property, tenant, rent and dates fill in automatically. The fields
            below cover the starter clauses; leave any blank and the value stays
            visible in the draft to fill later.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Parking spaces</label>
              <input name="parking_spaces" placeholder="e.g. 1" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Parking fee</label>
              <input name="parking_fee" placeholder="e.g. $50" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Utilities the tenant pays</label>
              <input name="tenant_utilities" placeholder="e.g. hydro" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Utilities included in rent</label>
              <input name="included_utilities" placeholder="e.g. water and heat" className={inputCls} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Storage provided</label>
              <input name="storage_description" placeholder="e.g. one locker" className={inputCls} />
            </div>
          </div>
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
            style={{ background: "var(--brand-gradient, var(--brand-color))" }}
          >
            Generate lease
          </button>
        </form>
      </div>
    </>
  );
}
