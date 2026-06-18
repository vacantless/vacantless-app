import { IconTile, StatusChip, type ChipTone } from "@/components/ui";
import { Icons } from "@/components/icons";
import {
  CLAUSE_APPLICABILITIES,
  CLAUSE_CATEGORIES,
  RISK_LEVELS,
  JURISDICTIONS,
  categoryOrder,
  type ClauseApplicability,
  type RiskLevel,
  type Jurisdiction,
} from "@/lib/clauses";
import {
  saveClause,
  saveClauseVersion,
  setCurrentClauseVersion,
  deleteClause,
} from "@/app/dashboard/settings/clause-actions";

// Clause library editor (lease vault #11, slices 2 + 6). A server component —
// every control is a form posting to a redirect-based server action in
// clause-actions.ts. Per-clause expansion uses the native <details> disclosure
// so no client JS is needed. Slice 6 (Noam's clause review) adds the
// landlord-facing depth: a visible RISK badge + caution/legal-review warning, the
// JURISDICTION, a plain-English landlord NOTE, and grouping by the six practical
// categories. The durable differentiator (clause-level versioning) is still the
// version history + "make current" + "add version" controls inside each clause.

export type ClauseVersionView = {
  id: string;
  version: number;
  is_current: boolean;
  body: string;
  note: string | null;
};
export type ClauseView = {
  id: string;
  key: string;
  title: string;
  category: string;
  applicable_to: ClauseApplicability;
  risk_level: RiskLevel;
  jurisdiction: Jurisdiction;
  notes_for_landlord: string | null;
  versions: ClauseVersionView[]; // newest version first
};

const APPLICABLE_LABEL: Record<ClauseApplicability, string> = {
  residential: "Residential",
  commercial: "Commercial",
  both: "Both",
};

const RISK_LABEL: Record<RiskLevel, string> = {
  standard: "Standard",
  caution: "Caution",
  legal_review: "Legal review",
};
const RISK_TONE: Record<RiskLevel, ChipTone> = {
  standard: "neutral",
  caution: "warn",
  legal_review: "danger",
};
// Per-clause warning line shown beneath a caution / legal-review clause.
const RISK_WARNING: Partial<Record<RiskLevel, string>> = {
  caution:
    "This clause can be valid but needs careful wording. Make sure it doesn't remove a tenant right under the RTA.",
  legal_review:
    "Review recommended. This clause may affect legal rights or obligations — consider legal advice before using it.",
};

const JURISDICTION_LABEL: Record<Jurisdiction, string> = {
  ontario: "Ontario",
  canada: "Canada",
  custom: "Custom",
};

const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";
const labelCls = "mb-1 block text-xs font-medium text-gray-600";

function ApplicableSelect({ defaultValue }: { defaultValue?: ClauseApplicability }) {
  return (
    <select name="applicable_to" defaultValue={defaultValue ?? "both"} className={inputCls}>
      {CLAUSE_APPLICABILITIES.map((a) => (
        <option key={a} value={a}>
          {APPLICABLE_LABEL[a]}
        </option>
      ))}
    </select>
  );
}

function RiskSelect({ defaultValue }: { defaultValue?: RiskLevel }) {
  return (
    <select name="risk_level" defaultValue={defaultValue ?? "standard"} className={inputCls}>
      {RISK_LEVELS.map((r) => (
        <option key={r} value={r}>
          {RISK_LABEL[r]}
        </option>
      ))}
    </select>
  );
}

function JurisdictionSelect({ defaultValue }: { defaultValue?: Jurisdiction }) {
  return (
    <select name="jurisdiction" defaultValue={defaultValue ?? "ontario"} className={inputCls}>
      {JURISDICTIONS.map((j) => (
        <option key={j} value={j}>
          {JURISDICTION_LABEL[j]}
        </option>
      ))}
    </select>
  );
}

// Category as a free-text input with the six practical suggestions (the DB keeps
// category free text, so an org can still add its own grouping).
function CategoryInput({ defaultValue }: { defaultValue?: string }) {
  return (
    <>
      <input
        name="category"
        defaultValue={defaultValue ?? ""}
        list="clause-category-suggestions"
        placeholder="e.g. Use of Unit"
        className={inputCls}
      />
      <datalist id="clause-category-suggestions">
        {CLAUSE_CATEGORIES.map((cat) => (
          <option key={cat} value={cat} />
        ))}
      </datalist>
    </>
  );
}

function ClauseCard({ c }: { c: ClauseView }) {
  const current = c.versions.find((v) => v.is_current) ?? null;
  const warning = RISK_WARNING[c.risk_level];
  return (
    <li className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
      <details className="group">
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-5 py-4 hover:bg-gray-50">
          <span className="min-w-0">
            <span className="font-medium text-gray-900">{c.title}</span>
            <span className="ml-2 inline-flex flex-wrap items-center gap-1.5 align-middle">
              <StatusChip tone={RISK_TONE[c.risk_level]}>{RISK_LABEL[c.risk_level]}</StatusChip>
              <StatusChip tone="neutral">{c.key}</StatusChip>
              <StatusChip tone="info">{APPLICABLE_LABEL[c.applicable_to]}</StatusChip>
              {current ? (
                <StatusChip tone="success">v{current.version}</StatusChip>
              ) : (
                <StatusChip tone="warn">no current version</StatusChip>
              )}
            </span>
            <span className="ml-1 block text-xs text-gray-400">
              {c.category} · {JURISDICTION_LABEL[c.jurisdiction]} · {c.versions.length} version
              {c.versions.length === 1 ? "" : "s"}
            </span>
          </span>
          <span className="text-xs font-medium text-brand group-open:hidden">Manage →</span>
        </summary>

        <div className="space-y-5 border-t border-gray-100 px-5 py-5">
          {/* Plain-English landlord note */}
          {c.notes_for_landlord && (
            <p className="text-sm text-gray-600">{c.notes_for_landlord}</p>
          )}

          {/* Risk warning for caution / legal-review clauses */}
          {warning && (
            <div
              className={`rounded-lg border p-3 text-xs ${
                c.risk_level === "legal_review"
                  ? "border-red-200 bg-red-50 text-red-700"
                  : "border-amber-200 bg-amber-50 text-amber-700"
              }`}
            >
              {warning}
            </div>
          )}

          {/* Current version preview */}
          {current && (
            <div>
              <p className={labelCls}>Current wording (v{current.version})</p>
              <p className="whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                {current.body}
              </p>
            </div>
          )}

          {/* Version history */}
          {c.versions.length > 0 && (
            <div>
              <p className={labelCls}>Version history</p>
              <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200">
                {c.versions.map((v) => (
                  <li
                    key={v.id}
                    className="flex flex-wrap items-start justify-between gap-2 px-3 py-2.5 text-sm"
                  >
                    <span className="min-w-0">
                      <span className="font-medium text-gray-800">v{v.version}</span>
                      {v.is_current && <StatusChip tone="success">Current</StatusChip>}
                      {v.note && <span className="ml-2 text-xs text-gray-400">{v.note}</span>}
                      <span className="mt-0.5 block line-clamp-2 text-xs text-gray-500">
                        {v.body}
                      </span>
                    </span>
                    {!v.is_current && (
                      <form action={setCurrentClauseVersion} className="shrink-0">
                        <input type="hidden" name="clause_id" value={c.id} />
                        <input type="hidden" name="version_id" value={v.id} />
                        <button className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
                          Make current
                        </button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Add a new version */}
          <form action={saveClauseVersion} className="space-y-2">
            <input type="hidden" name="clause_id" value={c.id} />
            <label className={labelCls}>New version wording (becomes the current version)</label>
            <textarea
              name="body"
              rows={4}
              required
              placeholder="Updated clause text…"
              className={inputCls}
            />
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[12rem] flex-1">
                <label className={labelCls}>Change note (optional)</label>
                <input name="note" placeholder="e.g. Bill 60 update" className={inputCls} />
              </div>
              <button
                className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
                style={{ background: "var(--brand-gradient, var(--brand-color))" }}
              >
                Save new version
              </button>
            </div>
          </form>

          {/* Edit metadata + delete */}
          <div className="border-t border-gray-100 pt-4">
            <form action={saveClause} className="space-y-3">
              <input type="hidden" name="id" value={c.id} />
              <input type="hidden" name="key" value={c.key} />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className={labelCls}>Title</label>
                  <input name="title" defaultValue={c.title} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Category</label>
                  <CategoryInput defaultValue={c.category} />
                </div>
                <div>
                  <label className={labelCls}>Applies to</label>
                  <ApplicableSelect defaultValue={c.applicable_to} />
                </div>
                <div>
                  <label className={labelCls}>Risk level</label>
                  <RiskSelect defaultValue={c.risk_level} />
                </div>
                <div>
                  <label className={labelCls}>Jurisdiction</label>
                  <JurisdictionSelect defaultValue={c.jurisdiction} />
                </div>
              </div>
              <div>
                <label className={labelCls}>Note for landlord (plain-English explanation)</label>
                <input
                  name="notes_for_landlord"
                  defaultValue={c.notes_for_landlord ?? ""}
                  placeholder="e.g. Use when parking is included."
                  className={inputCls}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <button className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                  Save details
                </button>
              </div>
            </form>
            <form action={deleteClause} className="mt-2">
              <input type="hidden" name="id" value={c.id} />
              <button className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50">
                Delete clause
              </button>
            </form>
          </div>
        </div>
      </details>
    </li>
  );
}

export function ClauseLibrary({ clauses }: { clauses: ClauseView[] }) {
  // Group by the six practical categories (in order), with anything unrecognized
  // collected under a trailing "Other" group.
  const groupsMap = new Map<string, ClauseView[]>();
  for (const c of clauses) {
    const known = categoryOrder(c.category) < CLAUSE_CATEGORIES.length;
    const label = known ? c.category : "Other";
    const arr = groupsMap.get(label) ?? [];
    arr.push(c);
    groupsMap.set(label, arr);
  }
  const orderedGroups = [...groupsMap.entries()].sort((a, b) => {
    const ao = a[0] === "Other" ? Number.MAX_SAFE_INTEGER : categoryOrder(a[0]);
    const bo = b[0] === "Other" ? Number.MAX_SAFE_INTEGER : categoryOrder(b[0]);
    return ao - bo;
  });

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="mb-2 flex items-center gap-2.5">
          <IconTile size="sm">
            <Icons.list className="h-4 w-4" />
          </IconTile>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
            Lease clause library
          </h3>
        </div>
        <p className="text-sm text-gray-600">
          Reusable clauses for the leases you generate. Each clause keeps a full
          version history — when you change wording, the old version is preserved
          and every executed lease records exactly which version the tenant
          signed, so a renewal can show what changed. Use{" "}
          <code className="rounded bg-gray-100 px-1 text-xs">{"{{token}}"}</code>{" "}
          placeholders (e.g.{" "}
          <code className="rounded bg-gray-100 px-1 text-xs">{"{{parking_fee}}"}</code>) for
          values filled in per tenancy when the lease is generated.
        </p>
      </div>

      {/* Ontario guardrail banner */}
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <strong className="font-semibold">Ontario reminder:</strong> Additional terms
        cannot remove tenant rights under the Residential Tenancies Act or the Ontario
        Standard Lease. For sensitive or unusual clauses (marked Caution or Legal review),
        get legal advice. Vacantless helps organize lease details — it does not replace
        legal advice.
      </div>

      {/* Existing clauses, grouped by category */}
      {clauses.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-sm text-gray-500">
          No clauses yet. Add your first clause below — new accounts start with a
          residential starter set automatically.
        </div>
      ) : (
        <div className="space-y-6">
          {orderedGroups.map(([label, items]) => (
            <div key={label}>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
                {label}
              </h4>
              <ul className="space-y-3">
                {items.map((c) => (
                  <ClauseCard key={c.id} c={c} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* Add a new clause */}
      <form
        action={saveClause}
        className="space-y-3 rounded-2xl border border-gray-200 bg-white p-5"
      >
        <div className="flex items-center gap-2.5">
          <IconTile size="sm">
            <Icons.bolt className="h-4 w-4" />
          </IconTile>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
            Add a clause
          </h3>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className={labelCls}>Key (stable id)</label>
            <input name="key" required placeholder="e.g. pets" className={inputCls} />
            <span className="mt-1 block text-xs text-gray-400">
              Lowercase letters, numbers, underscores. Can&apos;t change later.
            </span>
          </div>
          <div>
            <label className={labelCls}>Title</label>
            <input name="title" required placeholder="e.g. Pets" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Category</label>
            <CategoryInput />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className={labelCls}>Applies to</label>
            <ApplicableSelect />
          </div>
          <div>
            <label className={labelCls}>Risk level</label>
            <RiskSelect />
          </div>
          <div>
            <label className={labelCls}>Jurisdiction</label>
            <JurisdictionSelect />
          </div>
        </div>
        <div>
          <label className={labelCls}>Note for landlord (optional)</label>
          <input
            name="notes_for_landlord"
            placeholder="Plain-English explanation of when to use this clause."
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Clause wording (version 1)</label>
          <textarea
            name="body"
            rows={4}
            required
            placeholder="The clause text. Use {{token}} placeholders for per-tenancy values."
            className={inputCls}
          />
        </div>
        <button
          className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
          style={{ background: "var(--brand-gradient, var(--brand-color))" }}
        >
          Add clause
        </button>
      </form>
    </div>
  );
}
