import type { CopyCheckLinks } from "@/lib/copy-check";

/**
 * S777 (PLAN-S775 Phase 5): "Check for copies". Three searches the landlord
 * opens in their own browser; Vacantless never searches the sites itself
 * (lib/copy-check.ts says why).
 */
export function CopyCheckCard({ links }: { links: CopyCheckLinks }) {
  const buttons = [
    { href: links.lens, label: "Search my cover photo", note: "with Google Lens" },
    { href: links.kijiji, label: "Kijiji near my price", note: links.city ? `in ${links.city}` : undefined },
    { href: links.marketplace, label: "Marketplace near my price", note: links.marketplaceCity ? `in ${links.marketplaceCity}` : "where your Marketplace is set" },
  ].filter((b): b is { href: string; label: string; note: string | undefined } => Boolean(b.href));
  if (buttons.length === 0) return null;
  return (
    <div id="copy-check" className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-sm font-semibold text-gray-900">Check for copies of your ad</p>
      <p className="mt-1 text-xs text-gray-600">
        Scammers copy real ads at a lower price to take deposits. Every week or two, open these
        searches. Look for your photos under someone else&apos;s name.
        {links.priceLabel ? ` We search ${links.priceLabel}.` : ""} Found one? Report that ad on the site.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {buttons.map((b) => (
          <a
            key={b.label}
            href={b.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
          >
            {b.label}
            {b.note ? <span className="ml-1 font-normal text-gray-500">{b.note}</span> : null}
          </a>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-gray-500">
        These open in your browser. Vacantless does not search these sites for you. Their rules do not allow it.
      </p>
    </div>
  );
}
