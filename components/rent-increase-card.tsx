import Link from "next/link";
import { Card, StatusChip } from "@/components/ui";
import { formatRentCents } from "@/lib/tenancy";
import type { RentIncrease, RentIncreaseStatus } from "@/lib/rent-increase";

// ============================================================================
// Rent-increase surface (N1 v1, S282) — presentational only.
//
// Two views over the SAME `deriveRentIncrease` result so the per-tenancy card
// and the Overview rollup never drift:
//   * RentIncreaseCard — full card for the tenancy page (act-on-one-lease).
//   * RentIncreaseRow  — compact row for the cross-unit Overview rollup.
//
// The official LTB N1 form (pre-fill is a later slice) lives at:
export const N1_FORM_URL =
  "https://tribunalsontario.ca/ltb/forms-filing-and-fees/";

const STATUS_CHIP: Record<
  RentIncreaseStatus,
  { tone: "neutral" | "info" | "warn" | "danger"; label: string }
> = {
  exempt: { tone: "neutral", label: "Exempt" },
  scheduled: { tone: "info", label: "Scheduled" },
  serve_window: { tone: "warn", label: "Serve now" },
  serve_late: { tone: "warn", label: "Serve now · late" },
  overdue: { tone: "danger", label: "Overdue" },
};

function rentLine(r: RentIncrease): string | null {
  if (r.newRentCents == null || r.increaseCents == null) return null;
  return `${formatRentCents(r.currentRentCents)} → ${formatRentCents(
    r.newRentCents,
  )}/mo (+${formatRentCents(r.increaseCents)}${
    r.guidelinePercent != null ? ` · ${r.guidelinePercent}%` : ""
  })`;
}

/** Full card — for the tenancy page's rent area. */
export function RentIncreaseCard({ result }: { result: RentIncrease }) {
  const chip = STATUS_CHIP[result.status];
  const rent = rentLine(result);
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-gray-700">{result.note}</p>
        <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
      </div>

      {result.status !== "exempt" && (
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-gray-500">Eligible</dt>
            <dd className="font-medium text-gray-900">
              {result.earliestEffectiveDate}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Serve N1 by</dt>
            <dd className="font-medium text-gray-900">{result.serveByDate}</dd>
          </div>
          {rent && (
            <div className="col-span-2 sm:col-span-1">
              <dt className="text-gray-500">New rent</dt>
              <dd className="font-medium text-gray-900">{rent}</dd>
            </div>
          )}
        </dl>
      )}

      {result.status !== "exempt" && (
        <div className="mt-4">
          <Link
            href={N1_FORM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-brand hover:underline"
          >
            Get the Ontario N1 form →
          </Link>
        </div>
      )}
    </Card>
  );
}

/** Compact row — for the cross-unit Overview rollup. Links to the tenancy. */
export function RentIncreaseRow({
  result,
  label,
  href,
}: {
  result: RentIncrease;
  label: string;
  href: string;
}) {
  const chip = STATUS_CHIP[result.status];
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="min-w-0">
        <p className="truncate font-medium text-gray-900">{label}</p>
        <p className="truncate text-sm text-gray-500">{result.note}</p>
      </div>
      <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
    </Link>
  );
}
