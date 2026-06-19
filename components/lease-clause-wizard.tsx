"use client";

// The clause-selection conversion wizard on the tenancy detail page (lease vault
// #11, slice 7 — the direct follow-on to the slice-6 clause-library depth). It
// turns the static "assemble every clause" generate form into a guided step:
//
//   1. Answer a few facts about the unit/tenancy (parking, pets, storage…).
//   2. recommendClauses() flags which clauses to include and why (live).
//   3. Include/exclude any clause; each shows its risk level + landlord note.
//   4. Fill the placeholders the tenancy record can't supply (key deposit,
//      insurance amounts…); the canonical tokens (address, rent, dates) fill
//      automatically and are shown read-only.
//   5. Preview the assembled lease text, then generate.
//
// All the real logic is the PURE functions in lib/clauses (recommendClauses,
// annotateRecommendations, assembleClauses, selectClausesById, collectVarFields)
// — shared verbatim with the server action, which re-resolves + re-selects so
// this component is UX, not the trust boundary. State only.

import { useMemo, useState } from "react";
import { StatusChip } from "@/components/ui";
import {
  recommendClauses,
  annotateRecommendations,
  assembleClauses,
  tokensInBody,
  categoryOrder,
  isCanonicalLeaseToken,
  type RecommendationFacts,
  type RiskLevel,
  type ClauseApplicability,
} from "@/lib/clauses";
import {
  computeProration,
  prorationVarValues,
  PRORATION_TOKENS,
  type ProrationMethod,
} from "@/lib/proration";

// The library clause shape the wizard renders — a resolved current clause plus
// the slice-6 display metadata (category / risk / landlord note).
export type WizardClause = {
  clauseId: string;
  key: string;
  title: string;
  applicableTo: ClauseApplicability;
  versionId: string;
  version: number;
  body: string;
  category: string;
  riskLevel: RiskLevel;
  notesForLandlord: string | null;
};

const labelCls = "mb-1 block text-xs font-medium text-gray-600";
const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";

// The fact toggles, in display order, mapped to RecommendationFacts keys.
const FACT_FIELDS: { key: keyof RecommendationFacts; label: string }[] = [
  { key: "hasParking", label: "Parking is included" },
  { key: "parkingAtExtraCost", label: "Parking has a monthly fee" },
  { key: "tenantPaysHydro", label: "Tenant pays hydro" },
  { key: "gasFlatFee", label: "Flat gas amount folded into rent" },
  { key: "hasStorage", label: "Storage / locker provided" },
  { key: "hasOutdoorSpace", label: "Has balcony, terrace, or yard" },
  { key: "appliancesIncluded", label: "Appliances included" },
  { key: "petsRestricted", label: "Pets allowed with rules" },
  { key: "hasEarlyAccess", label: "Early access before lease start" },
  { key: "hasProratedRent", label: "Partial first month (prorated)" },
  { key: "propertySpecific", label: "Special property terms" },
];

const RISK_BADGE: Record<RiskLevel, { tone: "neutral" | "warn"; label: string }> = {
  standard: { tone: "neutral", label: "Standard" },
  caution: { tone: "warn", label: "Caution" },
  legal_review: { tone: "warn", label: "Review recommended" },
};

function humanizeToken(token: string): string {
  const s = token.replace(/_/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function LeaseClauseWizard({
  tenancyId,
  clauses,
  recordVars,
  recordSummary,
  proratedDefault = false,
  rentCents = null,
  startDate = null,
  isRenewal = false,
  generateAction,
}: {
  tenancyId: string;
  clauses: WizardClause[];
  // Canonical token -> value, derived from the tenancy record (used for the live
  // preview; the server re-derives them so they always reflect the true record).
  recordVars: Record<string, string>;
  // Human-readable "auto-filled from this tenancy" lines for the read-only panel.
  recordSummary: { label: string; value: string }[];
  // Seed the prorated-rent fact from the lease start date (day != 1).
  proratedDefault?: boolean;
  // Raw monthly rent (cents) + lease start date (YYYY-MM-DD) — used to suggest
  // the prorated-rent values so the operator validates instead of calculating.
  rentCents?: number | null;
  startDate?: string | null;
  isRenewal?: boolean;
  generateAction: (formData: FormData) => void | Promise<void>;
}) {
  // Residential lease — commercial-only clauses aren't offered here.
  const residential = useMemo(
    () => clauses.filter((c) => c.applicableTo !== "commercial"),
    [clauses],
  );

  const [facts, setFacts] = useState<RecommendationFacts>({
    hasProratedRent: proratedDefault,
  });

  const recommendations = useMemo(() => recommendClauses(facts), [facts]);
  const annotated = useMemo(
    () => annotateRecommendations(residential, recommendations),
    [residential, recommendations],
  );

  // Initial selection = the recommendations at first render (baseline facts).
  const [included, setIncluded] = useState<Set<string>>(() => {
    const recKeys = new Set(recommendClauses({ hasProratedRent: proratedDefault }).map((r) => r.key));
    return new Set(residential.filter((c) => recKeys.has(c.key)).map((c) => c.clauseId));
  });

  const [vars, setVars] = useState<Record<string, string>>({});

  const selected = useMemo(
    () => residential.filter((c) => included.has(c.clauseId)),
    [residential, included],
  );

  // Operator-fillable placeholders across the selected clauses (canonical tokens
  // are auto-filled and excluded), in first-appearance order.
  const placeholderTokens = useMemo(() => {
    const seen: string[] = [];
    for (const c of selected) {
      for (const t of tokensInBody(c.body)) {
        if (!isCanonicalLeaseToken(t) && !seen.includes(t)) seen.push(t);
      }
    }
    return seen;
  }, [selected]);

  // Live preview from the same pure assembler the server uses.
  const preview = useMemo(
    () =>
      assembleClauses(selected, {
        leaseType: "residential",
        vars: { ...vars, ...recordVars },
      }),
    [selected, vars, recordVars],
  );

  // Prorated-rent suggestion from the tenancy's rent + start date. Null when the
  // rent/date are missing or the lease starts on the 1st (no proration needed),
  // so the suggestion chips only appear when proration is actually in play.
  const proration = useMemo(() => {
    const comp = computeProration(rentCents, startDate);
    return comp && comp.applicable ? comp : null;
  }, [rentCents, startDate]);

  // Show the one-click banner only when a prorated-rent token is actually being
  // asked for (the prorated clause is selected) and we have a suggestion.
  const prorationTokenSet = useMemo(
    () => new Set(Object.values(PRORATION_TOKENS) as string[]),
    [],
  );
  const showProrationBanner =
    proration != null && placeholderTokens.some((t) => prorationTokenSet.has(t));

  const recommendedClauseIds = useMemo(() => {
    const recKeys = new Set(recommendations.map((r) => r.key));
    return residential.filter((c) => recKeys.has(c.key)).map((c) => c.clauseId);
  }, [residential, recommendations]);

  // Categories in the intended order, each with its clauses.
  const groups = useMemo(() => {
    const byCat = new Map<string, typeof annotated>();
    for (const c of annotated) {
      const arr = byCat.get(c.category) ?? [];
      arr.push(c);
      byCat.set(c.category, arr);
    }
    return Array.from(byCat.entries()).sort(
      (a, b) => categoryOrder(a[0]) - categoryOrder(b[0]),
    );
  }, [annotated]);

  function toggleFact(key: keyof RecommendationFacts) {
    setFacts((f) => ({ ...f, [key]: !f[key] }));
  }
  function toggleClause(id: string) {
    setIncluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function selectRecommended() {
    setIncluded(new Set(recommendedClauseIds));
  }
  function setVar(token: string, value: string) {
    setVars((v) => ({ ...v, [token]: value }));
  }
  // Fill all four prorated-rent inputs at once for the chosen method (the dates
  // are method-independent; only the amount differs between calendar/30-day).
  function applyProration(method: ProrationMethod) {
    if (!proration) return;
    setVars((v) => ({ ...v, ...prorationVarValues(proration, method) }));
  }
  // The suggestion chip(s) to show under a given placeholder input. Dates get a
  // single "use this" chip; the amount gets the calendar suggestion plus a
  // 30-day alternative only when the two methods actually differ.
  function prorationChipsFor(
    token: string,
  ): { label: string; value: string; title?: string }[] {
    if (!proration) return [];
    if (token === PRORATION_TOKENS.periodStart)
      return [{ label: `Use ${proration.periodStart}`, value: proration.periodStart }];
    if (token === PRORATION_TOKENS.periodEnd)
      return [{ label: `Use ${proration.periodEnd}`, value: proration.periodEnd }];
    if (token === PRORATION_TOKENS.fullRentStart)
      return [{ label: `Use ${proration.fullRentStart}`, value: proration.fullRentStart }];
    if (token === PRORATION_TOKENS.amount) {
      const chips = [
        {
          label: `Suggest ${proration.calendar.formatted}`,
          value: proration.calendar.formatted,
          title: `Calendar method: ${proration.calendar.daysCharged} of ${proration.daysInMonth} days`,
        },
      ];
      if (!proration.methodsAgree) {
        chips.push({
          label: `${proration.thirtyDay.formatted} · 30-day`,
          value: proration.thirtyDay.formatted,
          title: `Flat 30-day method: ${proration.thirtyDay.daysCharged} of 30 days`,
        });
      }
      return chips;
    }
    return [];
  }

  if (residential.length === 0) {
    return (
      <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Add at least one clause in{" "}
        <a
          href="/dashboard/settings?tab=clauses"
          className="font-medium underline"
        >
          Settings → Lease Clauses
        </a>{" "}
        before generating a lease.
      </p>
    );
  }

  const selectedCount = selected.length;

  return (
    <div className="space-y-5 rounded-xl border border-gray-200 bg-white p-4">
      <div>
        <p className="text-sm font-medium text-gray-700">
          {isRenewal ? "Generate a renewal / new draft" : "Generate the lease"}
        </p>
        <p className="text-xs text-gray-500">
          Tell us about this tenancy and we&apos;ll recommend the clauses to
          include. You stay in control — include or exclude any clause below.
        </p>
      </div>

      {/* Step 1 — facts about the tenancy (drive the recommendations live) */}
      <fieldset className="rounded-lg border border-gray-200 p-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
          About this tenancy
        </legend>
        <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
          {FACT_FIELDS.map((f) => (
            <label
              key={f.key}
              className="flex items-center gap-2 text-sm text-gray-700"
            >
              <input
                type="checkbox"
                checked={!!facts[f.key]}
                onChange={() => toggleFact(f.key)}
                className="h-4 w-4 rounded border-gray-300"
              />
              {f.label}
            </label>
          ))}
        </div>
      </fieldset>

      <form action={generateAction} className="space-y-5">
        <input type="hidden" name="tenancy_id" value={tenancyId} />

        {/* Step 2 — clause selection, grouped by category */}
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Clauses · {selectedCount} selected
            </span>
            <button
              type="button"
              onClick={selectRecommended}
              className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              Select recommended ({recommendedClauseIds.length})
            </button>
          </div>

          <div className="space-y-4">
            {groups.map(([category, items]) => (
              <div key={category}>
                <p className="mb-1 text-xs font-semibold text-gray-500">
                  {category}
                </p>
                <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200">
                  {items.map((c) => {
                    const checked = included.has(c.clauseId);
                    const badge = RISK_BADGE[c.riskLevel];
                    return (
                      <li
                        key={c.clauseId}
                        className={
                          "px-3 py-2.5 " +
                          (c.recommended ? "bg-brand/5" : "bg-white")
                        }
                      >
                        <label className="flex cursor-pointer items-start gap-2.5">
                          <input
                            type="checkbox"
                            name="clause_id"
                            value={c.clauseId}
                            checked={checked}
                            onChange={() => toggleClause(c.clauseId)}
                            className="mt-0.5 h-4 w-4 rounded border-gray-300"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-gray-900">
                                {c.title}
                              </span>
                              <span className="text-xs text-gray-400">
                                v{c.version}
                              </span>
                              <StatusChip tone={badge.tone}>
                                {badge.label}
                              </StatusChip>
                              {c.recommended && (
                                <StatusChip tone="info">Recommended</StatusChip>
                              )}
                            </span>
                            {c.recommended && c.recommendReason && (
                              <span className="mt-0.5 block text-xs text-brand">
                                {c.recommendReason}
                              </span>
                            )}
                            {c.notesForLandlord && (
                              <span className="mt-0.5 block text-xs text-gray-500">
                                {c.notesForLandlord}
                              </span>
                            )}
                            {c.riskLevel === "legal_review" && (
                              <span className="mt-0.5 block text-xs text-amber-700">
                                Review this clause (or have it reviewed) before
                                relying on it.
                              </span>
                            )}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Auto-filled record values (read-only) */}
        {recordSummary.length > 0 && (
          <div className="rounded-lg border border-gray-100 bg-gray-50/60 p-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Filled automatically from this tenancy
            </p>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2">
              {recordSummary.map((r) => (
                <div key={r.label} className="flex gap-1">
                  <dt className="text-gray-500">{r.label}:</dt>
                  <dd className="font-medium text-gray-700">{r.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {/* Step 3 — placeholders the record can't supply */}
        {placeholderTokens.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Values to fill
            </p>

            {/* Prorated-rent one-click auto-fill (calendar method by default). */}
            {showProrationBanner && proration && (
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-brand/30 bg-brand/5 px-3 py-2">
                <span className="text-xs text-gray-700">
                  Lease starts {proration.startDate} — proration covers{" "}
                  {proration.calendar.daysCharged} of {proration.daysInMonth} days,
                  full rent from {proration.fullRentStart}.
                </span>
                <button
                  type="button"
                  onClick={() => applyProration("calendar")}
                  className="rounded-md bg-brand px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90"
                >
                  Auto-fill {proration.calendar.formatted}
                </button>
                {!proration.methodsAgree && (
                  <button
                    type="button"
                    onClick={() => applyProration("thirty_day")}
                    className="rounded-md border border-brand/40 bg-white px-2.5 py-1 text-xs font-medium text-brand hover:bg-brand/5"
                  >
                    Use 30-day ({proration.thirtyDay.formatted})
                  </button>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {placeholderTokens.map((token) => {
                const chips = prorationChipsFor(token);
                return (
                  <div key={token}>
                    <label className={labelCls}>{humanizeToken(token)}</label>
                    <input
                      name={`var_${token}`}
                      value={vars[token] ?? ""}
                      onChange={(e) => setVar(token, e.target.value)}
                      placeholder={`{{${token}}}`}
                      className={inputCls}
                    />
                    {chips.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {chips.map((c) => (
                          <button
                            key={c.value}
                            type="button"
                            title={c.title}
                            onClick={() => setVar(token, c.value)}
                            className="rounded-md border border-brand/40 bg-white px-2 py-0.5 text-xs font-medium text-brand hover:bg-brand/5"
                          >
                            {c.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="mt-1 text-xs text-gray-400">
              Leave any blank and the {"{{"}placeholder{"}}"} stays visible in the
              draft to fill before sending.
            </p>
          </div>
        )}

        {/* Step 4 — live preview */}
        {selectedCount > 0 && (
          <details className="rounded-lg border border-gray-200">
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-brand">
              Preview assembled lease text ({selectedCount} clause
              {selectedCount === 1 ? "" : "s"})
            </summary>
            <div className="border-t border-gray-100 px-3 py-2">
              {preview.unresolved.length > 0 && (
                <p className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
                  Still to fill:{" "}
                  {preview.unresolved.map((t) => `{{${t}}}`).join(", ")}
                </p>
              )}
              <p className="whitespace-pre-wrap text-sm text-gray-700">
                {preview.text || "Select a clause to preview the lease text."}
              </p>
            </div>
          </details>
        )}

        <button
          type="submit"
          disabled={selectedCount === 0}
          className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: "var(--brand-gradient, var(--brand-color))" }}
        >
          Generate lease
        </button>
      </form>
    </div>
  );
}
