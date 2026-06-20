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
  ordinalDay,
  parseISODate,
  PRORATION_TOKENS,
  type ProrationMethod,
} from "@/lib/proration";

// "Start from my last signed lease" seed (REAL-WORLD-INTAKE item J). The page
// resolves the org's most recently SIGNED lease into the current-library
// clauseIds to pre-select (seedSelectionFromSnapshot), plus the source label so
// the operator knows what they're seeding from. Null when the org has no signed
// lease yet (the affordance is hidden).
export type LeaseSeedInfo = {
  // current-library clauseIds to pre-select when the seed button is clicked.
  clauseIds: string[];
  // how many clauses from that lease no longer exist in the library (deleted).
  missingCount: number;
  // address of the unit that lease was for (may be this tenancy or another).
  sourceAddress: string | null;
  // when it was signed (ISO) — for the source caption.
  signedAt: string;
};

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
  { key: "acWindowOnRequest", label: "Seasonal AC supplied on request (window or portable)" },
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
  seed = null,
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
  // The org's last signed lease, resolved to current-library clauseIds, or null
  // if the org hasn't signed one yet. Drives the "Start from last signed" button.
  seed?: LeaseSeedInfo | null;
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

  // How rent recurs. "first_of_month" (the default) prorates a mid-month first
  // month; "anniversary" means rent runs from the start day each month, so no
  // proration is needed (the operator's edge case — e.g. a 17th-to-17th cycle).
  const [rentCycle, setRentCycle] = useState<"first_of_month" | "anniversary">(
    "first_of_month",
  );

  // The raw proration math (independent of the chosen cycle). `applicable` is
  // true only for a valid rent + a mid-month start — i.e. proration is possible.
  const rawProration = useMemo(
    () => computeProration(rentCents, startDate),
    [rentCents, startDate],
  );
  const prorationPossible = rawProration?.applicable ?? false;
  // The start day-of-month, for the anniversary-cycle label.
  const startDay = useMemo(() => parseISODate(startDate ?? "")?.day ?? null, [startDate]);

  // The ACTIVE suggestion: only offered on the first-of-month cycle. Switching to
  // an anniversary cycle suppresses the banner + chips (no proration needed).
  const proration =
    rentCycle === "first_of_month" && prorationPossible ? rawProration : null;

  // The prorated-rent clause id, so toggling the cycle can include/drop it.
  const proratedClauseId = useMemo(
    () => residential.find((c) => c.key === "prorated_rent")?.clauseId ?? null,
    [residential],
  );

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

  // The seed (org's last signed lease), intersected with the residential library
  // actually rendered here — a commercial-only or since-deleted clause can't be
  // pre-checked. Empty when there's nothing to seed from.
  const seedClauseIds = useMemo(() => {
    if (!seed) return [];
    const have = new Set(residential.map((c) => c.clauseId));
    return seed.clauseIds.filter((id) => have.has(id));
  }, [seed, residential]);
  // The " (2419 Mercer Street, signed 6/18/2026)" source aside — built in JS so a
  // missing address or date never leaves a stray comma/paren in the caption.
  const seedSource = useMemo(() => {
    if (!seed) return "";
    const parts: string[] = [];
    if (seed.sourceAddress) parts.push(seed.sourceAddress);
    parts.push(`signed ${new Date(seed.signedAt).toLocaleDateString()}`);
    return ` (${parts.join(", ")})`;
  }, [seed]);

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
  // Replace the selection with exactly the clauses from the org's last signed
  // lease (current versions). "Start from" = replace, like Select recommended.
  function startFromLastSigned() {
    setIncluded(new Set(seedClauseIds));
  }
  function setVar(token: string, value: string) {
    setVars((v) => ({ ...v, [token]: value }));
  }
  // Switching to an anniversary cycle means no proration: drop the prorated-rent
  // clause + fact; switching back to first-of-month re-adds them. Only the
  // prorated clause is touched — every other selection stays as the operator set it.
  function changeRentCycle(next: "first_of_month" | "anniversary") {
    setRentCycle(next);
    const anniversary = next === "anniversary";
    setFacts((f) => ({ ...f, hasProratedRent: !anniversary }));
    if (proratedClauseId) {
      setIncluded((prev) => {
        const s = new Set(prev);
        if (anniversary) s.delete(proratedClauseId);
        else s.add(proratedClauseId);
        return s;
      });
    }
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
          href="/dashboard/tenants/lease-clauses"
          className="font-medium underline"
        >
          Tenants → Lease clauses
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

      {/* Rent cycle — only relevant when the lease starts mid-month. Lets the
          operator say rent runs from the 1st (prorate) vs. the start day (no
          proration), which collapses the proration suggestion below. */}
      {prorationPossible && startDay != null && (
        <fieldset className="rounded-lg border border-gray-200 p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Rent cycle
          </legend>
          <div className="space-y-1.5">
            <label className="flex items-start gap-2 text-sm text-gray-700">
              <input
                type="radio"
                name="rent_cycle_ui"
                checked={rentCycle === "first_of_month"}
                onChange={() => changeRentCycle("first_of_month")}
                className="mt-0.5 h-4 w-4 border-gray-300"
              />
              <span>
                Full rent on the 1st of each month
                <span className="block text-xs text-gray-500">
                  Prorate the partial first month.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-gray-700">
              <input
                type="radio"
                name="rent_cycle_ui"
                checked={rentCycle === "anniversary"}
                onChange={() => changeRentCycle("anniversary")}
                className="mt-0.5 h-4 w-4 border-gray-300"
              />
              <span>
                Rent runs from the {ordinalDay(startDay)} of each month
                <span className="block text-xs text-gray-500">
                  No proration needed — full cycles from the {ordinalDay(startDay)}.
                </span>
              </span>
            </label>
          </div>
        </fieldset>
      )}

      <form action={generateAction} className="space-y-5">
        <input type="hidden" name="tenancy_id" value={tenancyId} />

        {/* Step 2 — clause selection, grouped by category */}
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Clauses · {selectedCount} selected
            </span>
            <span className="flex flex-wrap items-center gap-2">
              {seedClauseIds.length > 0 && (
                <button
                  type="button"
                  onClick={startFromLastSigned}
                  className="rounded-lg border border-brand/40 bg-brand/5 px-2.5 py-1 text-xs font-medium text-brand hover:bg-brand/10"
                >
                  Start from last signed lease ({seedClauseIds.length})
                </button>
              )}
              <button
                type="button"
                onClick={selectRecommended}
                className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Select recommended ({recommendedClauseIds.length})
              </button>
            </span>
          </div>
          {seedClauseIds.length > 0 && seed && (
            <p className="mb-2 text-xs text-gray-500">
              Reuse the exact clauses from your last signed lease{seedSource} at
              their current versions.
              {seed.missingCount > 0 &&
                ` ${seed.missingCount} clause${seed.missingCount === 1 ? "" : "s"} from that lease ${seed.missingCount === 1 ? "is" : "are"} no longer in your library and won't be added.`}
            </p>
          )}

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
