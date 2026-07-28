"use client";

import { useMemo, useState, useTransition } from "react";
import {
  groupAgentBookByOrg,
  AGENT_BOOK_PRIORITY,
  type AgentBookRow,
} from "@/lib/agent-book";
import { confirmRentForClient, marketUnitForClient } from "./agent-actions";

// Read-only cross-org agent book. Grouped by client (org), filterable by stage
// and by "needs action". No cross-org navigation yet — deep links into a chosen
// client's org are a later ticket (the org switcher + market-this-unit trigger).

function needsAction(row: AgentBookRow): boolean {
  return (
    row.priority <= AGENT_BOOK_PRIORITY.setupOrMarket ||
    row.flags.rentUnconfirmed
  );
}

// "Market this unit for [client]" (Tier 1 D): switches the active org to this
// row's client and routes into the Get-online wizard with the unit pre-staged.
// The server action re-validates membership + ownership, so this is a plain
// trigger. It does not publish the unit; the wizard's send-live stage does.
function MarketButton({ row }: { row: AgentBookRow }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(() => marketUnitForClient(row.orgId, row.propertyId))
      }
      className="rounded-lg border border-brand/40 bg-brand/5 px-2.5 py-1.5 text-xs font-semibold text-brand transition hover:bg-brand/10 disabled:opacity-50"
      title={`Switch to ${row.orgName} and open the Get online wizard for this unit`}
    >
      {pending ? "Opening…" : "Market →"}
    </button>
  );
}

function ConfirmRentButton({ row }: { row: AgentBookRow }) {
  const [pending, startTransition] = useTransition();
  const tenancyId = row.tenancyId;
  if (!tenancyId) return null;
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(() => confirmRentForClient(row.orgId, tenancyId))
      }
      className="rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-50"
      title={`Switch to ${row.orgName} and open the rent confirmation section`}
    >
      {pending ? "Opening…" : "Confirm rent →"}
    </button>
  );
}

function FlagChips({ row }: { row: AgentBookRow }) {
  const chips: { label: string; className: string }[] = [];
  if (row.flags.newLeadCount > 0)
    chips.push({
      label: `${row.flags.newLeadCount} new ${row.flags.newLeadCount === 1 ? "inquiry" : "inquiries"}`,
      className: "bg-red-50 text-red-700 border-red-200",
    });
  if (row.flags.needsOperatorCount > 0)
    chips.push({
      label: `${row.flags.needsOperatorCount} needs you`,
      className: "bg-amber-50 text-amber-800 border-amber-200",
    });
  if (row.flags.notLiveButShould)
    chips.push({
      label: "Ready — not live",
      className: "bg-blue-50 text-blue-700 border-blue-200",
    });
  if (row.flags.rentUnconfirmed)
    chips.push({
      label: "Confirm rent",
      className: "bg-indigo-50 text-indigo-700 border-indigo-200",
    });
  if (row.flags.photosMissing)
    chips.push({
      label: "No photos",
      className: "bg-gray-100 text-gray-600 border-gray-200",
    });
  if (chips.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <span
          key={c.label}
          className={`rounded-full border px-2 py-0.5 text-xs font-medium ${c.className}`}
        >
          {c.label}
        </span>
      ))}
    </span>
  );
}

export function AgentBookTable({ rows }: { rows: AgentBookRow[] }) {
  const [stage, setStage] = useState<string>("all");
  const [onlyNeedsAction, setOnlyNeedsAction] = useState(false);

  const stages = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) if (!seen.has(r.stageStep)) seen.set(r.stageStep, r.stage);
    return Array.from(seen.entries()).map(([step, label]) => ({ step, label }));
  }, [rows]);

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (stage === "all" || r.stageStep === stage) &&
          (!onlyNeedsAction || needsAction(r)),
      ),
    [rows, stage, onlyNeedsAction],
  );

  const groups = useMemo(() => groupAgentBookByOrg(filtered), [filtered]);
  const actionCount = useMemo(() => rows.filter(needsAction).length, [rows]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="text-sm text-gray-600">
          Stage
          <select
            value={stage}
            onChange={(e) => setStage(e.target.value)}
            className="ml-2 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="all">All stages</option>
            {stages.map((s) => (
              <option key={s.step} value={s.step}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={onlyNeedsAction}
            onChange={(e) => setOnlyNeedsAction(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300"
          />
          Needs action only ({actionCount})
        </label>
        <span className="ml-auto text-sm text-gray-400">
          {filtered.length} of {rows.length} units
        </span>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          No units match this filter.
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <div
              key={group.orgId}
              className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm"
            >
              <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-2.5">
                <span className="font-semibold text-gray-900">{group.orgName}</span>
                <span className="text-xs text-gray-500">
                  {group.rows.length} {group.rows.length === 1 ? "unit" : "units"}
                </span>
              </div>
              <ul className="divide-y divide-gray-100">
                {group.rows.map((row) => (
                  <li
                    key={row.propertyId}
                    className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-gray-900">{row.unitLabel}</div>
                      {row.unitLabel !== row.address && (
                        <div className="truncate text-xs text-gray-400">{row.address}</div>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                      <FlagChips row={row} />
                      <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-600">
                        {row.stage}
                      </span>
                      {row.nextAction && (
                        <span className="text-xs text-gray-500">{row.nextAction}</span>
                      )}
                      {row.flags.rentUnconfirmed && row.tenancyId && (
                        <ConfirmRentButton row={row} />
                      )}
                      <MarketButton row={row} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
