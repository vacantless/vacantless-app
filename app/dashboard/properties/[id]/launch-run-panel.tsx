// Guided launch-run panel (S412 Slice 2). Server component. A saved, resumable
// posting session: pick channels -> work each as a checklist -> mark done +
// paste the live URL (which produces the tracked listing_posts row). Renders at
// the top of the Distribute tab, above the channel cards.

import { CopyLink } from "./copy-link";
import {
  startDistributionRun,
  updateRunItem,
  addRunChannel,
  cancelDistributionRun,
} from "../actions";
import {
  runItemStatusLabel,
  RUN_ITEM_STATUSES,
  type RunItemStatus,
  type RunStep,
  type RunProgress,
} from "@/lib/distribution-run";

export type RunItemView = {
  id: string;
  channel: string;
  channelLabel: string;
  status: RunItemStatus;
  externalUrl: string | null;
  trackedUrl: string | null;
  notes: string | null;
  steps: RunStep[];
};

const FIELD_CLASS =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";
const PRIMARY_BTN = "rounded-lg px-4 py-2 text-sm font-medium text-white";

const STATUS_CHIP: Record<RunItemStatus, string> = {
  pending: "bg-gray-100 text-gray-600",
  in_progress: "bg-blue-50 text-blue-700",
  done: "bg-green-50 text-green-700",
  skipped: "bg-amber-50 text-amber-700",
};

export function LaunchRunPanel({
  propertyId,
  linkIsLive,
  run,
  items,
  progress,
  selectable,
  startChannels,
}: {
  propertyId: string;
  linkIsLive: boolean;
  run: { id: string } | null;
  items: RunItemView[];
  progress: RunProgress;
  // Channels not yet in the run (for "add another channel").
  selectable: Array<{ key: string; label: string }>;
  // All channels offered when STARTING a run (matrix + other).
  startChannels: Array<{ key: string; label: string }>;
}) {
  // No active run: offer to start one.
  if (!run) {
    return (
      <div className="mb-4 rounded-2xl border border-brand/30 bg-brand/5 p-5">
        <h3 className="mb-1 text-sm font-semibold text-gray-900">
          Run a guided launch
        </h3>
        <p className="mb-3 text-xs text-gray-600">
          Pick the channels you want to post to and Vacantless walks you through
          each one as a checklist - copy, fields, gotchas, then paste the live
          link. Your progress saves so you can stop and resume.
        </p>
        {linkIsLive ? (
          <form action={startDistributionRun}>
            <input type="hidden" name="property_id" value={propertyId} />
            <div className="mb-3 flex flex-wrap gap-2">
              {startChannels.map((c) => (
                <label
                  key={c.key}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700"
                >
                  <input type="checkbox" name="channels" value={c.key} />
                  {c.label}
                </label>
              ))}
            </div>
            <button
              type="submit"
              className={PRIMARY_BTN}
              style={{ backgroundColor: "var(--brand-color)" }}
            >
              Start launch run
            </button>
          </form>
        ) : (
          <p className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-500">
            Set this rental Live to run a guided launch.
          </p>
        )}
      </div>
    );
  }

  // Active run: progress + per-channel checklists.
  return (
    <div className="mb-4 rounded-2xl border border-brand/30 bg-brand/5 p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">Launch run</h3>
        <span className="text-xs font-medium text-gray-600">
          {progress.resolved} of {progress.total} channels done
        </span>
      </div>
      <div className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
        <div
          className="h-full rounded-full bg-brand"
          style={{ width: `${progress.pct}%` }}
        />
      </div>

      <ul className="space-y-3">
        {items.map((item) => (
          <li
            key={item.id}
            className="rounded-xl border border-gray-200 bg-white p-4"
          >
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-gray-900">
                {item.channelLabel}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_CHIP[item.status]}`}
              >
                {runItemStatusLabel(item.status)}
              </span>
            </div>

            <ol className="mb-3 space-y-1.5">
              {item.steps.map((s, i) => (
                <li key={s.key} className="flex gap-2 text-xs text-gray-600">
                  <span className="font-semibold text-gray-400">{i + 1}.</span>
                  <span>
                    <span className="font-medium text-gray-800">{s.label}</span>
                    {s.detail && (
                      <span className="mt-0.5 block text-gray-500">{s.detail}</span>
                    )}
                  </span>
                </li>
              ))}
            </ol>

            {item.trackedUrl && (
              <div className="mb-3">
                <p className="mb-1 text-xs font-medium text-gray-500">
                  Tracked inquiry link for this post
                </p>
                <CopyLink url={item.trackedUrl} />
              </div>
            )}

            <form
              action={updateRunItem}
              className="space-y-3 border-t border-gray-100 pt-3"
            >
              <input type="hidden" name="property_id" value={propertyId} />
              <input type="hidden" name="item_id" value={item.id} />
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-40">
                  <label
                    htmlFor={`run-${item.id}-status`}
                    className="mb-1 block text-xs font-medium text-gray-600"
                  >
                    Status
                  </label>
                  <select
                    id={`run-${item.id}-status`}
                    name="status"
                    defaultValue={item.status}
                    className={FIELD_CLASS}
                  >
                    {RUN_ITEM_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {runItemStatusLabel(s)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="min-w-[14rem] flex-1">
                  <label
                    htmlFor={`run-${item.id}-url`}
                    className="mb-1 block text-xs font-medium text-gray-600"
                  >
                    Live ad URL (to finish + track)
                  </label>
                  <input
                    id={`run-${item.id}-url`}
                    name="external_url"
                    defaultValue={item.externalUrl ?? ""}
                    placeholder="https://..."
                    className={FIELD_CLASS}
                  />
                </div>
              </div>
              <div>
                <label
                  htmlFor={`run-${item.id}-notes`}
                  className="mb-1 block text-xs font-medium text-gray-600"
                >
                  Notes
                </label>
                <input
                  id={`run-${item.id}-notes`}
                  name="notes"
                  defaultValue={item.notes ?? ""}
                  className={FIELD_CLASS}
                />
              </div>
              <button
                type="submit"
                className={PRIMARY_BTN}
                style={{ backgroundColor: "var(--brand-color)" }}
              >
                Save
              </button>
            </form>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-gray-100 pt-3">
        {selectable.length > 0 && (
          <form action={addRunChannel} className="flex items-end gap-2">
            <input type="hidden" name="property_id" value={propertyId} />
            <input type="hidden" name="run_id" value={run.id} />
            <div>
              <label
                htmlFor="run-add-channel"
                className="mb-1 block text-xs font-medium text-gray-600"
              >
                Add a channel
              </label>
              <select
                id="run-add-channel"
                name="channel"
                className={FIELD_CLASS}
                defaultValue={selectable[0].key}
              >
                {selectable.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Add
            </button>
          </form>
        )}
        <form action={cancelDistributionRun}>
          <input type="hidden" name="property_id" value={propertyId} />
          <input type="hidden" name="run_id" value={run.id} />
          <button
            type="submit"
            className="text-xs font-medium text-red-600 hover:text-red-700"
          >
            Cancel this run
          </button>
        </form>
      </div>
    </div>
  );
}
