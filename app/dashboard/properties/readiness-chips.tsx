import type { ReadinessSignal, ReadinessTone } from "@/lib/rental-readiness";

// Tone -> chip styling. ok = green (ready), warn = amber (actionable gap),
// muted = gray (intentional state, e.g. a leased link or a not-live feed row).
const TONE_CLASS: Record<ReadinessTone, string> = {
  ok: "border-green-200 bg-green-50 text-green-700",
  warn: "border-amber-200 bg-amber-50 text-amber-700",
  muted: "border-gray-200 bg-gray-50 text-gray-500",
};

const DOT_CLASS: Record<ReadinessTone, string> = {
  ok: "bg-green-500",
  warn: "bg-amber-500",
  muted: "bg-gray-300",
};

function compactList(labels: string[]) {
  if (labels.length === 1) return labels[0] ?? "";
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.length} things`;
}

function describeSignals(signals: ReadinessSignal[]) {
  return signals.map((s) => `${s.label}: ${s.detail}. ${s.hint}`).join(" ");
}

function visibleNeedLabel(signal: ReadinessSignal) {
  if (signal.key === "viewings") return "viewing times";
  return signal.label.toLowerCase();
}

/**
 * The per-rental readiness strip on the Rentals list. The old four-chip strip
 * leaked implementation detail ("Link not live / Feed not live") into a launch
 * page. Keep the exact signals for titles/a11y, but group the visible surface
 * into proof + needs so the list stays scan-friendly.
 */
export function ReadinessChips({ signals }: { signals: ReadinessSignal[] }) {
  const actionable = signals.filter((s) => s.tone === "warn");
  const allReady = signals.every((s) => s.ok);
  const link = signals.find((s) => s.key === "link");
  const feed = signals.find((s) => s.key === "feed");
  const closed = signals.find(
    (s) => s.detail === "leased" || s.detail === "paused",
  )?.detail;
  const launchText = closed
    ? closed === "leased"
      ? "Closed to inquiries"
      : "Paused"
    : "Get online to launch";

  return (
    <ul className="mt-2 flex flex-wrap items-center gap-1.5">
      {allReady ? (
        <li>
          <span
            title={describeSignals(signals)}
            aria-label={`Ready online. ${describeSignals(signals)}`}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${TONE_CLASS.ok}`}
          >
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 rounded-full ${DOT_CLASS.ok}`}
            />
            <span>Ready online</span>
          </span>
        </li>
      ) : null}
      {!allReady && link?.ok ? (
        <li>
          <span
            title={link.hint}
            aria-label={`${link.label}: ${link.detail}. ${link.hint}`}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${TONE_CLASS.ok}`}
          >
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 rounded-full ${DOT_CLASS.ok}`}
            />
            <span>Link live</span>
          </span>
        </li>
      ) : null}
      {actionable.length > 0 ? (
        <li>
          <span
            title={describeSignals(actionable)}
            aria-label={`Needs ${actionable
              .map((s) => s.label.toLowerCase())
              .join(", ")}. ${describeSignals(actionable)}`}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${TONE_CLASS.warn}`}
          >
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 rounded-full ${DOT_CLASS.warn}`}
            />
            <span>
              Needs{" "}
              {compactList(actionable.map(visibleNeedLabel))}
            </span>
          </span>
        </li>
      ) : null}
      {!allReady && actionable.length === 0 && feed?.ok ? (
        <li>
          <span
            title={feed.hint}
            aria-label={`${feed.label}: ${feed.detail}. ${feed.hint}`}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${TONE_CLASS.ok}`}
          >
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 rounded-full ${DOT_CLASS.ok}`}
            />
            <span>Feed ready</span>
          </span>
        </li>
      ) : null}
      {!allReady && actionable.length === 0 && !link?.ok && !feed?.ok ? (
        <li>
          <span
            title={describeSignals(signals)}
            aria-label={`${launchText}. ${describeSignals(signals)}`}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium ${TONE_CLASS.muted}`}
          >
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 rounded-full ${DOT_CLASS.muted}`}
            />
            <span>{launchText}</span>
          </span>
        </li>
      ) : null}
    </ul>
  );
}
