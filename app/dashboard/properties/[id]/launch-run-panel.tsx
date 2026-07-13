// Guided launch-run panel (S412 Slice 2). Server component. A saved, resumable
// posting session: pick channels -> work each as a checklist -> mark done +
// paste the live URL (which produces the tracked listing_posts row). Renders at
// the top of the Distribute tab, above the channel cards.

import Link from "next/link";
import { CopyLink } from "./copy-link";
import { CopilotPanel } from "./copilot-panel";
import {
  startDistributionRun,
  updateRunItem,
  addRunChannel,
  cancelDistributionRun,
  requestConciergePublish,
} from "../actions";
import {
  verifyPublicPage,
  verifyOrgFeedInclusion,
  recordItemProof,
} from "../distribution-actions";
import {
  verificationResultLabel,
  verificationResultTone,
} from "@/lib/distribution-verification";
import type { CopilotScript } from "@/lib/distribution-copilot";
import {
  type RunItemStatus,
  type RunStep,
  type RunProgress,
} from "@/lib/distribution-run";
import {
  PUBLISH_STATUSES,
  publishStatusLabel,
  publishModeLabel,
  type PublishMode,
  type PublishStatus,
  type PublishTone,
} from "@/lib/distribution-publish";

export type RunItemView = {
  id: string;
  channel: string;
  channelLabel: string;
  status: RunItemStatus;
  publishStatus: PublishStatus;
  statusLabel: string;
  statusTone: PublishTone;
  mode: PublishMode;
  modeLabel: string;
  blockers: string[];
  operatorActionUrl: string | null;
  auditMessage: string | null;
  errorMessage: string | null;
  externalUrl: string | null;
  trackedUrl: string | null;
  notes: string | null;
  steps: RunStep[];
  // S474b: this human-action item can be handed to the Vacantless publishing
  // desk ("Publish for me"). Computed with the operator's plan entitlement.
  canConcierge: boolean;
  // S480: honest transport + durable verification state + latest proof link.
  transport: string | null;
  verificationStatus: string | null;
  proofUrl: string | null;
  // S482: the honest browser co-pilot guided-posting script (copilot channels).
  copilotScript: CopilotScript | null;
};

export type PublishChannelChoiceView = {
  key: string;
  label: string;
  modeLabel: string;
  statusLabel: string;
  statusTone: PublishTone;
  description: string;
  blockers: string[];
  defaultSelected: boolean;
  // S480: pre-Publish channel setup readiness.
  readinessLabel: string;
  readinessTone: PublishTone;
  setupBlockers: string[];
};

const FIELD_CLASS =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";
const PRIMARY_BTN = "rounded-lg px-4 py-2 text-sm font-medium text-white";

const STATUS_CHIP: Record<PublishTone, string> = {
  positive: "bg-green-50 text-green-700",
  warning: "bg-amber-50 text-amber-700",
  danger: "bg-red-50 text-red-700",
  neutral: "bg-gray-100 text-gray-600",
};

export function LaunchRunPanel({
  propertyId,
  run,
  items,
  progress,
  selectable,
  startChannels,
}: {
  propertyId: string;
  run: { id: string } | null;
  items: RunItemView[];
  progress: RunProgress;
  // Channels not yet in the run (for "add another channel").
  selectable: PublishChannelChoiceView[];
  // All channels offered when STARTING a run.
  startChannels: PublishChannelChoiceView[];
}) {
  // No active run: offer to start one.
  if (!run) {
    return (
      <div className="mb-4 rounded-2xl border border-brand/30 bg-brand/5 p-5">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-gray-900">Publish</h3>
          <Link
            href="/dashboard/settings?tab=distribution"
            className="text-xs font-medium text-brand underline"
          >
            Channel setup
          </Link>
        </div>
        <p className="mb-3 text-xs text-gray-600">
          Pick the channels, then Vacantless creates one tracked run. Automatic
          steps happen where the app can really do them; login, payment, broker,
          and final-review steps stay explicit.
        </p>
        <form action={startDistributionRun}>
          <input type="hidden" name="property_id" value={propertyId} />
          <div className="mb-3 grid gap-2 md:grid-cols-2">
            {startChannels.map((c) => (
              <label
                key={c.key}
                className="cursor-pointer rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-700"
              >
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    name="channels"
                    value={c.key}
                    defaultChecked={c.defaultSelected}
                    className="mt-1"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-gray-900">{c.label}</span>
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                        {c.modeLabel}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_CHIP[c.statusTone]}`}
                      >
                        {c.statusLabel}
                      </span>
                      <span
                        title="Channel setup readiness"
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_CHIP[c.readinessTone]}`}
                      >
                        Setup: {c.readinessLabel}
                      </span>
                    </span>
                    <span className="mt-1 block text-xs text-gray-500">
                      {c.description}
                    </span>
                    {c.blockers.length > 0 && (
                      <span className="mt-2 block rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
                        {c.blockers[0]}
                      </span>
                    )}
                  </span>
                </div>
              </label>
            ))}
          </div>
          <button
            type="submit"
            className={PRIMARY_BTN}
            style={{ backgroundColor: "var(--brand-color)" }}
          >
            Publish
          </button>
        </form>
      </div>
    );
  }

  // Active run: progress + per-channel checklists.
  return (
    <div className="mb-4 rounded-2xl border border-brand/30 bg-brand/5 p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">Publish run</h3>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/dashboard/settings?tab=distribution"
            className="text-xs font-medium text-brand underline"
          >
            Channel setup
          </Link>
          <span className="text-xs font-medium text-gray-600">
            {progress.resolved} of {progress.total} channels resolved
          </span>
        </div>
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
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                {publishModeLabel(item.mode)}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_CHIP[item.statusTone]}`}
              >
                {item.statusLabel}
              </span>
              {item.verificationStatus && (
                <span
                  title="Verification"
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_CHIP[verificationResultTone(item.verificationStatus)]}`}
                >
                  {verificationResultLabel(item.verificationStatus)}
                </span>
              )}
            </div>

            {(item.auditMessage || item.errorMessage || item.blockers.length > 0) && (
              <div className="mb-3 space-y-2">
                {item.auditMessage && (
                  <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                    {item.auditMessage}
                  </p>
                )}
                {item.errorMessage && (
                  <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    {item.errorMessage}
                  </p>
                )}
                {item.blockers.length > 0 && (
                  <ul className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    {item.blockers.map((blocker) => (
                      <li key={blocker}>{blocker}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Co-pilot channels get the guided panel instead of the flat
                step list; everything else keeps the plain checklist. */}
            {!item.copilotScript && (
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
            )}
            {item.copilotScript && (
              <CopilotPanel
                propertyId={propertyId}
                itemId={item.id}
                script={item.copilotScript}
              />
            )}

            {item.trackedUrl && (
              <div className="mb-3">
                <p className="mb-1 text-xs font-medium text-gray-500">
                  Tracked inquiry link for this post
                </p>
                <CopyLink url={item.trackedUrl} />
              </div>
            )}
            {item.operatorActionUrl && (
              <a
                href={item.operatorActionUrl}
                target="_blank"
                rel="noreferrer"
                className="mb-3 inline-flex rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Open next action
              </a>
            )}
            {item.canConcierge && (
              <form action={requestConciergePublish} className="mb-3">
                <input type="hidden" name="property_id" value={propertyId} />
                <input type="hidden" name="item_id" value={item.id} />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1 rounded-lg border border-brand/40 bg-brand/5 px-3 py-2 text-xs font-medium text-brand hover:bg-brand/10"
                >
                  Publish for me
                </button>
                <span className="ml-2 text-[11px] text-gray-500">
                  Vacantless posts this for you and marks it live.
                </span>
              </form>
            )}

            {(item.channel === "vacantless" || item.channel === "org_feed") && (
              <form
                action={
                  item.channel === "vacantless"
                    ? verifyPublicPage
                    : verifyOrgFeedInclusion
                }
                className="mb-3"
              >
                <input type="hidden" name="property_id" value={propertyId} />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  {item.channel === "vacantless"
                    ? "Verify public page"
                    : "Verify feed inclusion"}
                </button>
                <span className="ml-2 text-[11px] text-gray-500">
                  Records durable proof of this channel&apos;s state.
                </span>
              </form>
            )}
            {item.proofUrl && (
              <p className="mb-3 truncate text-xs text-gray-500">
                Proof:{" "}
                <a
                  href={item.proofUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-brand underline"
                >
                  {item.proofUrl}
                </a>
              </p>
            )}
            <details className="mb-3">
              <summary className="cursor-pointer text-xs font-medium text-gray-600">
                Record proof / update verification
              </summary>
              <form
                action={recordItemProof}
                className="mt-2 flex flex-wrap items-end gap-2"
              >
                <input type="hidden" name="item_id" value={item.id} />
                <div className="w-56">
                  <label className="mb-1 block text-[11px] font-medium text-gray-500">
                    Live URL (if any)
                  </label>
                  <input
                    name="external_url"
                    placeholder="https://..."
                    className={FIELD_CLASS}
                  />
                </div>
                <div className="w-40">
                  <label className="mb-1 block text-[11px] font-medium text-gray-500">
                    Result
                  </label>
                  <select
                    name="result"
                    defaultValue="verified_live"
                    className={FIELD_CLASS}
                  >
                    {(
                      [
                        "verified_live",
                        "needs_login",
                        "needs_payment",
                        "proof_unavailable",
                        "stale",
                      ] as const
                    ).map((r) => (
                      <option key={r} value={r}>
                        {verificationResultLabel(r)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="min-w-[10rem] flex-1">
                  <label className="mb-1 block text-[11px] font-medium text-gray-500">
                    Note
                  </label>
                  <input
                    name="note"
                    placeholder="e.g. posted on Kijiji; screenshot on file"
                    className={FIELD_CLASS}
                  />
                </div>
                <button
                  type="submit"
                  className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  Save proof
                </button>
              </form>
            </details>

            {/* Co-pilot channels complete ONLY via the co-pilot panel above,
                which records proof + a browser_copilot attempt and never marks
                live without a real URL. Hide the generic status form for them so
                it can't bypass that path (Codex S482 P1). */}
            {!item.copilotScript && (
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
                    name="publish_status"
                    defaultValue={item.publishStatus}
                    className={FIELD_CLASS}
                  >
                    {PUBLISH_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {publishStatusLabel(s)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="min-w-[14rem] flex-1">
                  <label
                    htmlFor={`run-${item.id}-url`}
                    className="mb-1 block text-xs font-medium text-gray-600"
                  >
                    Live URL (required before marking an external post Live)
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
            )}
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
                    {c.label} - {c.modeLabel}
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
