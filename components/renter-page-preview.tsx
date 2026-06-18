"use client";

import { useState } from "react";

// F2 fix (Settings usability audit, S225): the "View public renter page" link
// used to open only the NEWEST property. With multiple active listings an
// operator could never preview the others. This picker lets them choose any
// listing (or none, before any property exists) and open its real /r/{id} page.
//
// Pure client component: no data fetching here — the parent server component
// passes the org's properties + the absolute base URL so the opened tab points
// at the live renter page exactly as a renter would see it.

export type RenterPageProperty = { id: string; address: string };

export function RenterPagePreview({
  properties,
  baseUrl,
}: {
  properties: RenterPageProperty[];
  // Absolute origin (e.g. https://app.vacantless.com) or "" to use a relative
  // path. Matched to the same /r/{id} pattern the rest of the app builds.
  baseUrl: string;
}) {
  const [selectedId, setSelectedId] = useState(properties[0]?.id ?? "");

  if (properties.length === 0) {
    return (
      <span className="text-xs text-gray-400">
        Add a property to preview your public renter page.
      </span>
    );
  }

  const href = selectedId ? `${baseUrl}/r/${selectedId}` : "#";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {properties.length > 1 && (
        <select
          aria-label="Choose a listing to preview"
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="max-w-[15rem] rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-700"
        >
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.address}
            </option>
          ))}
        </select>
      )}
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
      >
        View public renter page ↗
      </a>
    </div>
  );
}
