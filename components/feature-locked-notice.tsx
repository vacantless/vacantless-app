import Link from "next/link";
import { TIERS, type TierKey } from "@/lib/billing";

// Reusable "this feature needs a higher plan" upsell notice. Drop it in wherever
// a capability is gated (e.g. the tenant-comms composer when SMS is locked, the
// rent-collection card on Starter). Pure presentational server component — the
// ENFORCEMENT always lives server-side in the action; this only explains the
// lock and points at billing. Keep the copy short; the gate, not the notice, is
// the security boundary.
//
// S220: introduced alongside the feature × tier entitlement matrix in lib/billing.
export function FeatureLockedNotice({
  title,
  description,
  unlockTier,
  ctaHref = "/dashboard/billing",
  ctaLabel,
}: {
  title: string;
  description: string;
  // The lowest tier that unlocks the feature, used to name the upgrade target.
  unlockTier?: TierKey;
  ctaHref?: string;
  ctaLabel?: string;
}) {
  const tierName = unlockTier ? TIERS[unlockTier].name : null;
  const label =
    ctaLabel ?? (tierName ? `Upgrade to ${tierName}` : "See plans");
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700"
        >
          {/* simple lock glyph */}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-900">{title}</p>
          <p className="mt-0.5 text-sm text-amber-800">{description}</p>
          <Link
            href={ctaHref}
            className="mt-2 inline-block rounded-lg bg-amber-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
          >
            {label}
          </Link>
        </div>
      </div>
    </div>
  );
}
